import { test, expect, chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { normalize, wordDistance } from './helpers.ts';
import type { Transcript } from '../src/core/types.ts';
import { openPopup as popup, observeHost } from './popup.ts';
test('actual toolbar popup, offscreen host, CSP, expansion and reattachment', async () => {
  const extension = resolve('dist');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const background = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const page = await popup(context, background);
    const host = await observeHost(context);
    const violations = page.errors;

    expect(await page.evaluate('!document.querySelector("#load").disabled')).toBe(true);
    expect(await page.evaluate('crossOriginIsolated')).toBe(true);
    await page.click('#settings-open');
    await page.click('#clear-cache');
    await expect.poll(() => page.text('#status')).toContain('Downloaded models deleted.');
    await page.close();
    const reopened = await popup(context, background);
    await expect.poll(() => reopened.text('#status')).toContain('Downloaded models deleted.');
    const expandedPromise = context.waitForEvent('page');
    await reopened.click('#expand');
    const expanded = await expandedPromise;
    await expect(expanded.locator('#status')).toContainText('Downloaded models deleted.');
    expect(
      await background.evaluate(
        async () =>
          (
            await chrome.runtime.getContexts({
              contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
            })
          ).length,
      ),
    ).toBe(1);
    expect([...violations, ...host.errors]).toEqual([]);
  } finally {
    await context.close();
  }
});
test('real popup: download survives close, live text, reopen, expand, flush and offline file inference', async () => {
  test.skip(!process.env.REAL_EXTENSION, 'Run npm run test:extension:real.');
  test.setTimeout(600000);
  const manualPermission = !!process.env.NATIVE_PERMISSION;
  const extension = resolve('dist');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: !manualPermission,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${resolve('tests/fixtures/long.wav')}`,
    ],
  });
  try {
    const background = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    let page = await popup(context, background);
    const host = await observeHost(context);
    const popupErrors: string[] = [];
    const errors: string[] = [];
    context.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));
    await page.click('#load');
    await expect.poll(() => page.evaluate('!document.querySelector("#cancel").hidden')).toBe(true);
    popupErrors.push(...page.errors);
    await page.close();
    page = await popup(context, background);
    await expect
      .poll(() => page.evaluate('!document.querySelector("#record").disabled'), { timeout: 300000 })
      .toBe(true);
    const permissionCdp = await context.browser()!.newBrowserCDPSession();
    const extensionOrigin = `chrome-extension://${new URL(background.url()).hostname}`;
    // Chrome treats extension origins specially; set permissions on the explicit extension origin.
    if (!manualPermission)
      await permissionCdp.send('Browser.setPermission', {
        permission: { name: 'microphone' },
        setting: 'denied',
        origin: extensionOrigin,
      });
    await page.click('#record');
    await expect.poll(() => page.text('#error')).toContain('Allow microphone access');
    const permissionPromise = context.waitForEvent('page');
    await page.click('#permission');
    const permissionPage = await permissionPromise;
    if (!manualPermission) {
      await permissionPage.locator('#allow').click();
      await expect(permissionPage.locator('#permission-status')).toContainText('was not allowed');
      await permissionCdp.send('Browser.setPermission', {
        permission: { name: 'microphone' },
        setting: 'granted',
        origin: extensionOrigin,
      });
    }
    await context.setOffline(true);
    const start = Date.now();
    await permissionPage.locator('#allow').click();
    await expect(permissionPage.locator('#allow')).toContainText('Stop recording', {
      timeout: manualPermission ? 120000 : 10000,
    });
    await expect(permissionPage.locator('#permission-status')).toContainText(
      'Keep this window open',
    );
    await page.close();
    page = await popup(context, background);
    await expect.poll(() => page.text('#record')).toContain('Stop recording');
    await expect.poll(() => page.text('#transcript'), { timeout: 20000 }).toMatch(/\S/u);
    const firstTextMs = Date.now() - start;
    popupErrors.push(...page.errors);
    await page.close();
    // Recorder must advance while no view is open.
    await new Promise((resolve) => setTimeout(resolve, 3500));
    page = await popup(context, background);
    await expect.poll(() => page.text('#record')).toContain('Stop recording');
    await expect.poll(() => page.text('#status'), { timeout: 12000 }).toMatch(/0:(0[89]|[1-5]\d)/u);
    const expandedPromise = context.waitForEvent('page');
    await page.click('#expand');
    const expanded = await expandedPromise;
    await expect(expanded.locator('#record')).toContainText('Stop recording');
    await expect(expanded.locator('#status')).toContainText(/0:4[12]/u, { timeout: 45000 });
    await expanded.locator('#record').click();
    await expect(expanded.locator('#status')).toContainText('Done.', { timeout: 120000 });
    await expect(expanded.locator('#error')).toBeHidden();
    await expect(permissionPage.locator('#permission-status')).toContainText('Recording finished');
    const liveText = await expanded.locator('#transcript').innerText();
    const references = JSON.parse(await readFile('tests/fixtures/reference-int8.json', 'utf8'));
    const fixtures = JSON.parse(await readFile('tests/fixtures/fleurs.json', 'utf8')) as {
      file: string;
    }[];
    const expected = fixtures.map((row) => references[row.file].text).join(' ');
    const complete = liveText.slice(0, liveText.indexOf('avseende.') + 'avseende.'.length);
    for (const marker of ['Människor', 'Bieber', 'Schengenområdet'])
      expect(complete.match(new RegExp(marker, 'giu'))).toHaveLength(1);
    const wordErrorRate = wordDistance(expected, complete) / normalize(expected).split(' ').length;
    expect(wordErrorRate).toBeLessThanOrEqual(0.05);
    await expanded.locator('#format').selectOption('json');
    const downloadPromise = expanded.waitForEvent('download');
    await expanded.locator('#save').click();
    const download = await downloadPromise;
    await download.saveAs(test.info().outputPath('live-transcript.json'));
    const transcript = JSON.parse(
      await readFile(test.info().outputPath('live-transcript.json'), 'utf8'),
    ) as Transcript;
    expect(
      transcript.words.every(
        (w, i, arr) =>
          Number.isFinite(w.start) &&
          w.start >= 0 &&
          w.end >= w.start &&
          w.end <= transcript.duration &&
          (!i || w.start >= arr[i - 1]!.start),
      ),
    ).toBe(true);
    await expanded.screenshot({ path: test.info().outputPath('expanded-live.png') });
    await expanded.locator('#file-tab').click();
    await expanded.locator('#file').setInputFiles('tests/fixtures/formats/speech.m4a');
    await expect(expanded.locator('#source-name')).toHaveText('speech.m4a');
    await expect(expanded.locator('#status')).toContainText('Done.', { timeout: 120000 });
    expect(normalize(await expanded.locator('#transcript').innerText())).toBe(
      normalize(references['swedish.wav'].text),
    );
    await expect(expanded.locator('#metrics')).toHaveText('0:07 · 10 words');
    // Closing the permission owner ends only its recording, retaining completed audio.
    await permissionPage.locator('#allow').click();
    await expect(permissionPage.locator('#allow')).toContainText('Stop recording', {
      timeout: manualPermission ? 120000 : 10000,
    });
    await expect(expanded.locator('#status')).toContainText(/0:0[23]/u);
    await permissionPage.close();
    await expect(expanded.locator('#status')).toHaveText(/Done\.|No speech detected\./u, {
      timeout: 20000,
    });
    await expect(expanded.locator('#record')).toContainText('Start recording');
    await expanded.locator('#file-tab').click();
    await expanded.locator('#file').setInputFiles('tests/fixtures/swedish.wav');
    await expect(expanded.locator('#source-name')).toHaveText('swedish.wav');
    await expect(expanded.locator('#status')).toContainText('Done.', { timeout: 20000 });
    await expect(expanded.locator('#drop-zone')).toBeHidden();
    await expect(expanded.locator('#file-summary')).toContainText('swedish.wav');
    // The offscreen session survives termination and restart of the event service worker.
    const cdp = await context.newCDPSession(expanded);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    page = await popup(context, expanded);
    await expect
      .poll(() =>
        page.evaluate('document.querySelector("#file-tab").getAttribute("aria-selected")'),
      )
      .toBe('true');
    await expect.poll(() => page.text('#transcript')).toBe(references['swedish.wav'].text);
    await expect.poll(() => page.text('#metrics')).toBe('0:07 · 10 words');
    await page.screenshot(test.info().outputPath('popup-transcript.png'));
    errors.push(...popupErrors, ...page.errors, ...host.errors);
    expect(errors).toEqual([]);
    await writeFile(
      test.info().outputPath('popup-live.json'),
      JSON.stringify(
        {
          firstTextMs,
          liveText,
          wordErrorRate,
          duration: transcript.duration,
          errors,
          serviceWorkerRestart: true,
          permissionDenialRetry: true,
          permissionAnchorLifecycle: true,
          manualPromptTest: manualPermission,
          nativePermissionChoice: null,
          downloadSurvivedClose: true,
          recordingSurvivedClose: true,
          expansionPreservedRecording: true,
          offlineFile: true,
        },
        null,
        2,
      ),
    );
    console.log('LIVE', firstTextMs, liveText);
  } finally {
    await context.close();
  }
});

test('Parakeet in production extension: live English, offline files and cached reload', async () => {
  test.skip(!process.env.REAL_PARAKEET_EXTENSION, 'Run npm run test:parakeet:extension.');
  test.setTimeout(600000);
  const extension = resolve('dist');
  const fixture = 'en_us-1003119935936341070.wav';
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${resolve('tests/fixtures/multilingual', fixture)}`,
    ],
  });
  try {
    const background = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    let toolbar = await popup(context, background);
    const host = await observeHost(context);
    await toolbar.evaluate(
      `document.querySelector('#language').value = 'parakeet-tdt-v3'; document.querySelector('#language').dispatchEvent(new Event('change'))`,
    );
    await expect.poll(() => toolbar.text('#download-size')).toBe('671 MB on first download');
    await toolbar.click('#load');
    await toolbar.close();
    toolbar = await popup(context, background);
    await expect
      .poll(() => toolbar.evaluate('!document.querySelector("#record").disabled'), {
        timeout: 300000,
      })
      .toBe(true);
    await expect
      .poll(() => toolbar.evaluate('document.querySelector("#language").value'))
      .toBe('parakeet-tdt-v3');
    const expandedPromise = context.waitForEvent('page');
    await toolbar.click('#expand');
    const expanded = await expandedPromise;
    const errors: string[] = [];
    expanded.on('pageerror', (error) => errors.push(error.message));
    const cdp = await context.browser()!.newBrowserCDPSession();
    await cdp.send('Browser.setPermission', {
      permission: { name: 'microphone' },
      setting: 'granted',
      origin: `chrome-extension://${new URL(background.url()).hostname}`,
    });
    await context.setOffline(true);
    await expanded.locator('#record').click();
    await expect(expanded.locator('#language')).toBeDisabled();
    await expect(expanded.locator('#transcript')).toContainText('However', { timeout: 30000 });
    await expect(expanded.locator('#status')).toContainText(/0:2[45]/u, { timeout: 40000 });
    await expanded.locator('#record').click();
    await expect(expanded.locator('#status')).toHaveText('Done.', { timeout: 120000 });
    await expect(expanded.locator('#error')).toBeHidden();
    const liveText = await expanded.locator('#transcript').innerText();
    expect(liveText.match(/However/gu)!.length).toBeGreaterThanOrEqual(2);
    const references = JSON.parse(
      await readFile('tests/fixtures/multilingual/reference-parakeet.json', 'utf8'),
    );
    await expanded.locator('#file-tab').click();
    await expanded.locator('#file').setInputFiles(`tests/fixtures/multilingual/${fixture}`);
    await expect(expanded.locator('#status')).toHaveText('Done.', { timeout: 120000 });
    await expect(expanded.locator('#transcript')).toHaveText(references[fixture].text);
    await expanded.locator('#language').selectOption('pianissimo-sv');
    await expect(expanded.locator('#load')).toBeEnabled();
    await expanded.locator('#language').selectOption('parakeet-tdt-v3');
    await expanded.locator('#load').click();
    await expect(expanded.locator('#file')).toBeEnabled({ timeout: 240000 });
    await expanded.locator('#file').setInputFiles(`tests/fixtures/multilingual/${fixture}`);
    await expect(expanded.locator('#status')).toHaveText('Done.', { timeout: 120000 });
    await expect(expanded.locator('#transcript')).toHaveText(references[fixture].text);
    await expanded.screenshot({ path: test.info().outputPath('parakeet-extension.png') });
    expect([...errors, ...host.errors]).toEqual([]);
    await writeFile(
      test.info().outputPath('parakeet-extension.json'),
      JSON.stringify(
        {
          liveText,
          offline: true,
          offlineCachedReload: true,
          downloadSurvivedPopupClose: true,
          modelSelectionSurvivedPopupClose: true,
          errors: [...errors, ...host.errors],
          controlledMicrophoneGrant: true,
          physicalMicrophoneTested: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await context.close();
  }
});
