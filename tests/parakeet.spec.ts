import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { normalize, wordDistance } from './helpers.ts';
import type { Transcript } from '../src/core/types.ts';

test('Parakeet: native parity, long audio, model switching, offline caches and deletion', async ({
  page,
  context,
}) => {
  test.skip(!process.env.REAL_PARAKEET, 'Run npm run test:parakeet with both downloaded models.');
  test.setTimeout(600000);
  const errors: string[] = [],
    downloads: string[] = [],
    evidence: Record<string, Transcript> = {};
  page.on('pageerror', (error) => errors.push(error.message));
  const server = createServer((req, res) => {
    const match = /^\/(sv|multi)\/([a-zA-Z0-9_.-]+)$/u.exec(req.url ?? '');
    if (!match) {
      res.writeHead(404).end();
      return;
    }
    const path = resolve(match[1] === 'sv' ? '.models' : '.models/parakeet-tdt-v3', match[2]!);
    res.writeHead(200, {
      'content-length': statSync(path).size,
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
    });
    createReadStream(path).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await context.route('https://huggingface.co/**', (route) => {
      const url = route.request().url(),
        name = new URL(url).pathname.split('/').at(-1)!;
      const kind = url.includes('/istupakov/') ? 'multi' : 'sv';
      downloads.push(`${kind}/${name}`);
      return route.fulfill({
        status: 302,
        headers: {
          location: `http://127.0.0.1:${port}/${kind}/${name}`,
          'access-control-allow-origin': '*',
          'cross-origin-resource-policy': 'cross-origin',
        },
      });
    });
    await page.goto('/');
    await page.locator('#language').selectOption('parakeet-tdt-v3');
    await page.locator('#load').click();
    await expect(page.locator('#record')).toBeEnabled({ timeout: 240000 });
    const references = JSON.parse(
      await readFile('tests/fixtures/multilingual/reference-parakeet.json', 'utf8'),
    ) as Record<string, { text: string }>;
    const human = JSON.parse(await readFile('tests/fixtures/multilingual/fleurs.json', 'utf8'))
      .rows as { file: string; text: string; language: string }[];
    await page.locator('#file-tab').click();
    for (const [file, reference] of Object.entries(references)) {
      await page.locator('#file').setInputFiles(`tests/fixtures/multilingual/${file}`);
      await expect(page.locator('#source-name')).toHaveText(file.split('/').at(-1)!);
      await expect(page.locator('#status')).toHaveText(/Done\.|No speech detected\./u, {
        timeout: 120000,
      });
      const text = await page.locator('#transcript').innerText();
      const row = human.find((row) => row.file === file);
      // Native and WASM predictions differ on some fixtures (for example, Kowloon).
      // Compare both against the human transcript so a corrected word is not a regression.
      if (row)
        expect(wordDistance(row.text, text)).toBeLessThanOrEqual(
          wordDistance(row.text, reference.text),
        );
      else expect(text).toBe('');
      await page.locator('#format').selectOption('json');
      const download = page.waitForEvent('download');
      await page.locator('#save').click();
      const result = JSON.parse(
        await readFile((await (await download).path())!, 'utf8'),
      ) as Transcript;
      expect(result.model).toBe('istupakov/parakeet-tdt-0.6b-v3-onnx');
      expect(result.language).toBeUndefined();
      expect(
        result.words.every(
          (word, i, all) =>
            word.start >= 0 &&
            word.end >= word.start &&
            word.end <= result.duration &&
            (!i || word.start >= all[i - 1]!.start),
        ),
      ).toBe(true);
      evidence[file] = result;
      console.log('PARAKEET', row?.language ?? 'silence', text);
    }
    await page.locator('#file').setInputFiles('tests/fixtures/multilingual/long-en.wav');
    await expect(page.locator('#status')).toHaveText('Done.', { timeout: 120000 });
    const longText = await page.locator('#transcript').innerText();
    const english = human.find((row) => row.language === 'en_us')!;
    const expected = Array(5).fill(references[english.file]!.text).join(' ');
    expect(longText.match(/However/gu)).toHaveLength(5);
    expect(
      wordDistance(expected, longText) / normalize(expected).split(' ').length,
    ).toBeLessThanOrEqual(0.05);
    await page.setViewportSize({ width: 420, height: 590 });
    await page.screenshot({ path: test.info().outputPath('parakeet-transcript.png') });
    // Switching releases the current worker and retains each model in its own cache.
    await page.locator('#language').selectOption('pianissimo-sv');
    await expect(page.locator('#load')).toBeEnabled();
    await page.locator('#load').click();
    await expect(page.locator('#file')).toBeEnabled({ timeout: 240000 });
    await page.locator('#file').setInputFiles('tests/fixtures/swedish.wav');
    await expect(page.locator('#status')).toHaveText('Done.');
    const swedish = JSON.parse(await readFile('tests/fixtures/reference-int8.json', 'utf8'))[
      'swedish.wav'
    ].text;
    await expect(page.locator('#transcript')).toHaveText(swedish);
    expect(downloads).toHaveLength(8);
    await context.unroute('https://huggingface.co/**');
    await context.route('https://**', (route) => route.abort('internetdisconnected'));
    for (const [id, file, text] of [
      ['parakeet-tdt-v3', `multilingual/${english.file}`, references[english.file]!.text],
      ['pianissimo-sv', 'swedish.wav', swedish],
    ]) {
      await page.locator('#language').selectOption(id!);
      await page.locator('#load').click();
      await expect(page.locator('#file')).toBeEnabled({ timeout: 240000 });
      await page.locator('#file').setInputFiles(`tests/fixtures/${file}`);
      await expect(page.locator('#status')).toHaveText('Done.');
      await expect(page.locator('#transcript')).toHaveText(text!);
    }
    const directories = () =>
      page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const names: string[] = [];
        for await (const name of root.keys())
          if (/^(pianissimo|parakeet)-/u.test(name)) names.push(name);
        return names;
      });
    expect(await directories()).toHaveLength(2);
    await page.locator('#settings-open').click();
    await page.locator('#clear-cache').click();
    await expect(page.locator('#status')).toHaveText('Downloaded models deleted.');
    expect(await directories()).toEqual([]);
    expect(errors).toEqual([]);
    await writeFile(
      test.info().outputPath('parakeet.json'),
      JSON.stringify(
        {
          transcripts: evidence,
          quality: human.map((row) => ({
            language: row.language,
            referenceWords: normalize(row.text).split(' ').length,
            nativeWordErrors: wordDistance(row.text, references[row.file]!.text),
            browserWordErrors: wordDistance(row.text, evidence[row.file]!.text),
          })),
          longText,
          downloads,
          errors,
          externalNetworkBlockedOnReload: true,
          cacheRoundTrip: true,
          cacheDeletion: true,
        },
        null,
        2,
      ),
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
