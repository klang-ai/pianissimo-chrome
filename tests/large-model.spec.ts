import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { open, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { normalize, wordDistance } from './helpers.ts';
import type { Transcript } from '../src/core/types.ts';

test('two-hour file: real inference across boundaries, memory samples, cancel and retry', async ({
  page,
  context,
}) => {
  test.skip(!process.env.ENDURANCE, 'Run npm run test:endurance.');
  test.setTimeout(1200000);
  const duration = 7210,
    rate = 16000,
    positions = [0, 28, 1798, 3598, 7198];
  const source = await readFile('tests/fixtures/swedish.wav');
  const pcm = source.subarray(source.indexOf(Buffer.from('data')) + 8);
  const bytes = duration * rate * 2,
    header = Buffer.alloc(44);
  header.write('RIFF');
  header.writeUInt32LE(bytes + 36, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(bytes, 40);
  await mkdir('test-results', { recursive: true });
  const path = resolve('test-results/two-hour-speech.wav'),
    file = await open(path, 'w');
  try {
    await file.write(header);
    await file.truncate(bytes + 44);
    for (const position of positions)
      await file.write(pcm, 0, pcm.length, 44 + position * rate * 2);
  } finally {
    await file.close();
  }
  const server = createServer((req, res) => {
    const name = req.url!.slice(1);
    if (!/^[a-zA-Z0-9_.-]+$/u.test(name)) {
      res.writeHead(404).end();
      return;
    }
    const path = resolve('.models', name);
    res.writeHead(200, {
      'content-length': statSync(path).size,
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
    });
    createReadStream(path).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(4174, '127.0.0.1', resolve));
  const memory: { usedSize: number; backingStorageSize: number }[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    await context.route('https://huggingface.co/**', (route) =>
      route.fulfill({
        status: 302,
        headers: {
          location: `http://127.0.0.1:4174/${new URL(route.request().url()).pathname.split('/').at(-1)}`,
          'access-control-allow-origin': '*',
          'cross-origin-resource-policy': 'cross-origin',
        },
      }),
    );
    await page.goto('/');
    await page.locator('#load').click();
    await expect(page.locator('#record')).toBeEnabled({ timeout: 240000 });
    // The demo's worker/runtime assets are served locally; block the external model
    // network while keeping those local assets available for cancellation/reload.
    await context.unroute('https://huggingface.co/**');
    await context.route('https://**', (route) => route.abort('internetdisconnected'));
    const cdp = await context.newCDPSession(page);
    timer = setInterval(() => {
      void cdp.send('Runtime.getHeapUsage').then(
        (value) => memory.push(value),
        () => {},
      );
    }, 2000);
    const start = Date.now();
    await page.locator('#file-tab').click();
    await page.locator('#file').setInputFiles(path);
    await expect(page.locator('#cancel')).toBeVisible();
    await expect(page.locator('#status')).toHaveText('Done.', { timeout: 900000 });
    clearInterval(timer);
    timer = undefined;
    const wallSeconds = (Date.now() - start) / 1000;
    await expect(page.locator('#error')).toBeHidden();
    await page.locator('#format').selectOption('json');
    const pendingDownload = page.waitForEvent('download');
    await page.locator('#save').click();
    const result = JSON.parse(
      await readFile((await (await pendingDownload).path())!, 'utf8'),
    ) as Transcript;
    const reference = JSON.parse(await readFile('tests/fixtures/reference-int8.json', 'utf8'))[
      'swedish.wav'
    ].text;
    const expected = Array(positions.length).fill(reference).join(' ');
    const wer = wordDistance(expected, result.text) / normalize(expected).split(' ').length;
    expect(result.duration).toBe(duration);
    expect(wer).toBeLessThanOrEqual(0.05);
    expect(result.text.match(/Schengenområdet/gu)).toHaveLength(positions.length);
    expect(result.text.match(/avseende/gu)).toHaveLength(positions.length);
    expect(
      result.words.every(
        (w, i, all) =>
          w.start >= 0 &&
          w.end >= w.start &&
          w.end <= duration &&
          (!i || w.start >= all[i - 1]!.start),
      ),
    ).toBe(true);
    expect(result.words.at(-1)!.end).toBeGreaterThan(7200);
    expect(Math.max(...memory.map((m) => m.usedSize + m.backingStorageSize))).toBeLessThan(
      256 * 1024 * 1024,
    );
    const evidence = {
      duration,
      bytes: bytes + 44,
      positions,
      wallSeconds,
      wer,
      rendererMemoryScope:
        'Main renderer JS heap and backing stores; excludes inference worker and native decoder allocations',
      maxRendererBytes: Math.max(...memory.map((m) => m.usedSize + m.backingStorageSize)),
      memory,
      result,
      externalNetworkBlocked: true,
      retry: false,
    };
    await writeFile(
      test.info().outputPath('two-hour-transcription.json'),
      JSON.stringify(evidence, null, 2),
    );
    console.log('TWO HOURS TRANSCRIBED', {
      wallSeconds,
      wer,
      maxRendererBytes: evidence.maxRendererBytes,
    });
    // Cancel real file work, reload the model from cache, and process a new file.
    await page.locator('#file').setInputFiles(path);
    await expect(page.locator('#cancel')).toBeVisible();
    await expect(page.locator('#draft')).toContainText('avseende', { timeout: 30000 });
    const cancelStart = Date.now();
    await page.locator('#cancel').click();
    await expect(page.locator('#load')).toBeEnabled();
    const cancelMs = Date.now() - cancelStart;
    expect(cancelMs).toBeLessThan(3000);
    await page.locator('#load').click();
    await expect(page.locator('#record')).toBeEnabled({ timeout: 240000 });
    await page.locator('#file').setInputFiles('tests/fixtures/swedish.wav');
    await expect(page.locator('#source-name')).toHaveText('swedish.wav');
    await expect(page.locator('#status')).toHaveText('Done.');
    await expect(page.locator('#transcript')).toHaveText(reference);
    await writeFile(
      test.info().outputPath('two-hour-transcription.json'),
      JSON.stringify({ ...evidence, cancelMs, retry: true }, null, 2),
    );
    console.log('TWO HOURS', {
      wallSeconds,
      wer,
      cancelMs,
      maxRendererBytes: Math.max(...memory.map((m) => m.usedSize + m.backingStorageSize)),
    });
  } finally {
    if (timer) clearInterval(timer);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
