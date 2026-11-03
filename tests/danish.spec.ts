import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { wordDistance } from './helpers.ts';
import type { Transcript } from '../src/core/types.ts';

test('Danish: human reference, silence, model switching and offline cache', async ({
  page,
  context,
}) => {
  test.skip(!process.env.REAL_DANISH, 'Run npm run test:danish with Danish and Swedish models.');
  test.setTimeout(600000);
  const errors: string[] = [],
    downloads: string[] = [],
    evidence: Record<string, Transcript> = {};
  page.on('pageerror', (error) => errors.push(error.message));
  const server = createServer((req, res) => {
    const match = /^\/(sv|da)\/([a-zA-Z0-9_.-]+)$/u.exec(req.url ?? '');
    if (!match) {
      res.writeHead(404).end();
      return;
    }
    const path = resolve(match[1] === 'sv' ? '.models' : '.models/pianissimo-da', match[2]!);
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
      const kind = url.includes('/KlangAI/pianissimo-da-onnx/') ? 'da' : 'sv';
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
    const human = JSON.parse(await readFile('tests/fixtures/multilingual/fleurs.json', 'utf8'))
      .rows as { file: string; text: string; language: string }[];
    const danish = human.find((row) => row.language === 'da_dk')!;
    const parakeet = JSON.parse(
      await readFile('tests/fixtures/multilingual/reference-parakeet.json', 'utf8'),
    )[danish.file].text as string;
    await page.goto('/');
    for (const quantization of ['int8', 'int4'] as const) {
      await page.locator('#language').selectOption('pianissimo-da');
      await page.locator('#settings-open').click();
      await page.locator('#quantization').selectOption(quantization);
      await page.locator('#settings-close').click();
      await page.locator('#load').click();
      await expect(page.locator('#record')).toBeEnabled({ timeout: 240000 });
      await expect(page.locator('#error')).toBeHidden();
      await page.locator('#file-tab').click();
      await page.locator('#file').setInputFiles(`tests/fixtures/multilingual/${danish.file}`);
      await expect(page.locator('#status')).toHaveText('Done.', { timeout: 120000 });
      const text = await page.locator('#transcript').innerText();
      console.log('DANISH', quantization, text);
      // The Danish model should do at least as well as multilingual Parakeet on Danish speech.
      expect(wordDistance(danish.text, text)).toBeLessThanOrEqual(
        wordDistance(danish.text, parakeet),
      );
      await page.locator('#format').selectOption('json');
      const download = page.waitForEvent('download');
      await page.locator('#save').click();
      const result = JSON.parse(
        await readFile((await (await download).path())!, 'utf8'),
      ) as Transcript;
      expect(result.model).toBe('KlangAI/pianissimo-da-onnx');
      expect(result.language).toBe('da');
      expect(result.quantization).toBe(quantization);
      evidence[quantization] = result;
      await page.locator('#file').setInputFiles('tests/fixtures/silence.wav');
      await expect(page.locator('#status')).toHaveText(/Done\.|No speech detected\./u, {
        timeout: 120000,
      });
      await expect(page.locator('#transcript')).toBeHidden();
      await page.locator('#settings-open').click();
      await page.locator('#unload').click();
      await expect(page.locator('#load')).toBeEnabled();
      await page.locator('#live-tab').click();
    }
    await page.locator('#language').selectOption('pianissimo-sv');
    await page.locator('#settings-open').click();
    await page.locator('#quantization').selectOption('int8');
    await page.locator('#settings-close').click();
    await page.locator('#load').click();
    await expect(page.locator('#file')).toBeEnabled({ timeout: 240000 });
    await page.locator('#file-tab').click();
    await page.locator('#file').setInputFiles('tests/fixtures/swedish.wav');
    await expect(page.locator('#status')).toHaveText('Done.');
    const swedish = JSON.parse(await readFile('tests/fixtures/reference-int8.json', 'utf8'))[
      'swedish.wav'
    ].text;
    await expect(page.locator('#transcript')).toHaveText(swedish);
    expect(downloads).toHaveLength(10);
    await context.unroute('https://huggingface.co/**');
    await context.route('https://**', (route) => route.abort('internetdisconnected'));
    await page.locator('#language').selectOption('pianissimo-da');
    await page.locator('#load').click();
    await expect(page.locator('#file')).toBeEnabled({ timeout: 240000 });
    await page.locator('#file').setInputFiles(`tests/fixtures/multilingual/${danish.file}`);
    await expect(page.locator('#status')).toHaveText('Done.');
    await expect(page.locator('#transcript')).toHaveText(evidence.int8!.text);
    expect(errors).toEqual([]);
    await writeFile(
      test.info().outputPath('danish.json'),
      JSON.stringify(
        {
          transcripts: evidence,
          reference: danish.text,
          parakeetWordErrors: wordDistance(danish.text, parakeet),
          wordErrors: Object.fromEntries(
            Object.entries(evidence).map(([key, value]) => [
              key,
              wordDistance(danish.text, value.text),
            ]),
          ),
          downloads,
          errors,
          externalNetworkBlockedOnReload: true,
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
