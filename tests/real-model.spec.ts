import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { writeFile, readFile } from 'node:fs/promises';
import type { Transcript } from '../src/core/types.ts';
import { normalize, wordDistance } from './helpers.ts';
test.skip(!process.env.REAL_MODEL, 'Run npm run test:real with downloaded models.');
for (const quantization of ['int8', 'int4'] as const) {
  test(`real ${quantization}: reference parity, long audio, SDK, silence and offline cache`, async ({
    page,
    context,
  }) => {
    test.setTimeout(600000);
    const errors: string[] = [],
      downloads: string[] = [],
      evidence: Record<string, Transcript> = {};
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') console.log('BROWSER', message.text());
    });
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
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      await context.route('https://huggingface.co/**', async (route) => {
        const name = new URL(route.request().url()).pathname.split('/').at(-1)!;
        downloads.push(name);
        await route.fulfill({
          status: 302,
          headers: {
            location: `http://127.0.0.1:${port}/${name}`,
            'access-control-allow-origin': '*',
            'cross-origin-resource-policy': 'cross-origin',
          },
        });
      });
      await page.goto('/');
      await page.locator('#settings-open').click();
      await page.locator('#quantization').selectOption(quantization);
      await page.locator('#settings-close').click();
      await page.locator('#load').click();
      await expect(page.locator('#record')).toBeEnabled({ timeout: 240000 });
      await expect(page.locator('#error')).toBeHidden();
      if (quantization === 'int8') {
        await page.setViewportSize({ width: 420, height: 590 });
        await page.locator('#file-tab').click();
        await page.locator('#file').setInputFiles('tests/fixtures/long.wav');
        await expect(page.locator('#file-summary')).toContainText('long.wav');
        await expect(page.locator('#drop-zone')).toBeHidden();
        await expect(page.locator('#cancel')).toBeVisible();
        await expect(page.locator('#change-file')).toBeHidden();
        await expect(page.locator('#draft')).toContainText('Människor', { timeout: 30000 });
        await page.screenshot({ path: test.info().outputPath('file-transcribing.png') });
        await expect(page.locator('#status')).toContainText('Done.', { timeout: 30000 });
        await expect(page.locator('#change-file')).toBeEnabled();
        await page.screenshot({ path: test.info().outputPath('file-complete.png') });
        await page.setViewportSize({ width: 1280, height: 720 });
      }
      const humanReferences = JSON.parse(await readFile('tests/fixtures/fleurs.json', 'utf8')) as {
        file: string;
        text: string;
      }[];
      const references = JSON.parse(
        await readFile(`tests/fixtures/reference-${quantization}.json`, 'utf8'),
      ) as Record<string, { text: string }>;
      for (const [fixture, reference] of Object.entries(references)) {
        await page.locator('#file-tab').click();
        await page.locator('#file').setInputFiles(`tests/fixtures/${fixture}`);
        await expect(page.locator('#source-name')).toHaveText(fixture);

        await expect(page.locator('#status')).toHaveText(/Done\.|No speech detected\./u, {
          timeout: 180000,
        });
        const text = await page.locator('#transcript').innerText();
        console.log(quantization, fixture, await page.locator('#metrics').innerText(), text);
        const human = humanReferences.find((row) => row.file === fixture);
        expect(normalize(text)).toBe(normalize(reference.text));
        if (human)
          expect(wordDistance(human.text, text)).toBeLessThanOrEqual(
            wordDistance(human.text, reference.text),
          );
        await page.locator('#format').selectOption('json');
        const downloadPromise = page.waitForEvent('download');
        await page.locator('#save').click();
        const download = await downloadPromise;
        const path = await download.path();
        const transcript = JSON.parse(await readFile(path!, 'utf8')) as Transcript;
        evidence[fixture] = transcript;
        expect(
          transcript.words.every(
            (w) =>
              Number.isFinite(w.start) &&
              w.start >= 0 &&
              w.end >= w.start &&
              w.end <= transcript.duration,
          ),
        ).toBe(true);
        expect(transcript.words.every((w, i, arr) => !i || w.start >= arr[i - 1]!.start)).toBe(
          true,
        );
      }
      if (quantization === 'int8') {
        const cycle = humanReferences.map((row) => references[row.file]!.text).join(' ');
        const expected = `${cycle} ${cycle}`;
        for (const fixture of ['long.mp3', 'long.m4a', 'long.webm']) {
          await page.locator('#file').setInputFiles(`tests/fixtures/formats/${fixture}`);
          await expect(page.locator('#source-name')).toHaveText(fixture);
          await expect(page.locator('#status')).toHaveText('Done.', { timeout: 60000 });
          const text = await page.locator('#transcript').innerText();
          for (const marker of ['Människor', 'Bieber', 'Schengenområdet'])
            expect(text.match(new RegExp(marker, 'giu'))).toHaveLength(2);
          expect(
            wordDistance(expected, text) / normalize(expected).split(' ').length,
          ).toBeLessThanOrEqual(0.05);
        }
      }
      await page.screenshot({
        path: test.info().outputPath(`${quantization}-transcript.png`),
        fullPage: true,
      });
      expect(downloads).toHaveLength(4);
      await page.locator('#settings-open').click();
      await page.locator('#unload').click();
      await context.unroute('https://huggingface.co/**');
      await context.route('https://**', (route) => route.abort('internetdisconnected'));
      // Public SDK bundle, offline model cache, and a real cross-chunk 38.7-second recording.
      const wav = await readFile('tests/fixtures/long.wav');
      const comparison = (await page.evaluate(
        async ({ bytes, quantization }) => {
          const modulePath = '/sdk/pianissimo.js';
          const { Pianissimo } = await import(modulePath);
          const client = new Pianissimo();
          try {
            await client.load({ quantization, threads: quantization === 'int4' ? 1 : 4 });
            // Independent canonical PCM reference for this mono 16 kHz PCM16 fixture.
            // Chrome decodeAudioData scales positive integers differently, so it
            // cannot be used for bit-exact cross-API inference comparison.
            const view = new DataView(new Uint8Array(bytes).buffer);
            const pcm = new Float32Array((bytes.length - 44) / 2);
            for (let i = 0; i < pcm.length; i++) pcm[i] = view.getInt16(44 + i * 2, true) / 32768;
            const direct = await client.transcribe(pcm);
            const streamed = await client.transcribeFile(
              new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }),
            );
            return { direct, streamed };
          } finally {
            client.dispose();
          }
        },
        { bytes: Array.from(wav), quantization },
      )) as { direct: Transcript; streamed: Transcript };
      const long = comparison.streamed;
      expect(long.words).toEqual(comparison.direct.words);
      expect(long.text).toBe(comparison.direct.text);
      const expectedLong = humanReferences.map((row) => references[row.file]!.text).join(' ');
      expect(
        wordDistance(expectedLong, long.text) / normalize(expectedLong).split(' ').length,
      ).toBeLessThanOrEqual(0.04);
      for (const marker of ['Människor', 'Bieber', 'Schengenområdet'])
        expect(long.text.match(new RegExp(marker, 'giu'))).toHaveLength(1);
      expect(
        long.words.every(
          (w, i, arr) =>
            w.start >= 0 && w.end <= long.duration && (!i || w.start >= arr[i - 1]!.start),
        ),
      ).toBe(true);
      evidence['long.wav'] = long;
      expect(errors).toEqual([]);
      await writeFile(
        test.info().outputPath(`${quantization}.json`),
        JSON.stringify(
          { transcripts: evidence, downloads, errors, sdk: true, offlineLoad: true },
          null,
          2,
        ),
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}
