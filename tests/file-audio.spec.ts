import { test, expect } from '@playwright/test';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

for (const fixture of [
  'stereo.wav',
  'speech.m4a',
  'speech.mp3',
  'speech.webm',
  'speech.ogg',
  'speech.flac',
  'long.mp3',
  'long.m4a',
  'long.webm',
  'delayed.m4a',
  '../long.wav',
]) {
  test(`incremental decoding: ${fixture}`, async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.type = 'file';
      input.id = 'decode-file';
      document.body.append(input);
    });
    await page.locator('#decode-file').setInputFiles(`tests/fixtures/formats/${fixture}`);
    const result = await page.evaluate(async () => {
      const path = '/sdk/pianissimo.js';
      const { decodeAudioChunks, decodeAudio } = await import(path);
      const file = (document.querySelector('#decode-file') as HTMLInputElement).files![0]!;
      const reference = await decodeAudio(file);
      const chunks: { error: number; start: number; end: number }[] = [];
      // This known fixture is a 44-byte-header mono PCM16 WAV at 16 kHz.
      // Web Audio uses asymmetric positive/negative normalization; compare the
      // streaming decoder exactly against independently parsed canonical PCM.
      const raw = file.name === 'long.wav' ? new DataView(await file.arrayBuffer()) : undefined;
      let canonicalMismatches = 0,
        chromeMismatches = 0,
        positive = 0,
        negative = 0;
      let duration = 0,
        lag = 0;
      for await (const chunk of decodeAudioChunks(file)) {
        const audio = chunk.audio as Float32Array;
        duration = chunk.duration;
        if (!chunks.length && file.name.endsWith('.mp3')) {
          // WebCodecs retains MP3 encoder priming that decodeAudioData trims.
          // Determine one global offset, then require it to match every decoded window.
          let best = Infinity;
          for (let offset = -1600; offset <= 1600; offset++) {
            let error = 0;
            for (let i = 4000; i < Math.min(40000, audio.length - 1600); i += 8)
              error += (audio[i + offset]! - reference[i]!) ** 2;
            if (error < best) {
              best = error;
              lag = offset;
            }
          }
        }
        let energy = 0,
          delta = 0;
        const from = Math.max(1600, chunk.keepStart - chunk.start);
        const to = Math.min(
          audio.length - 1600,
          chunk.keepEnd - chunk.start,
          reference.length - chunk.start - 1600,
        );
        for (let i = from; i < to; i++) {
          energy += reference[chunk.start + i]! ** 2;
          delta += (reference[chunk.start + i]! - audio[i + lag]!) ** 2;
        }
        if (raw)
          for (let i = 0; i < audio.length; i++) {
            const value = raw.getInt16(44 + (chunk.start + i) * 2, true);
            if (audio[i] !== value / 32768) canonicalMismatches++;
            const chromeValue = Math.fround(value * Math.fround(1 / (value < 0 ? 32768 : 32767)));
            if (reference[chunk.start + i] !== chromeValue) chromeMismatches++;
            if (value > 0) positive++;
            else if (value < 0) negative++;
          }
        chunks.push({ error: delta / energy, start: chunk.keepStart, end: chunk.keepEnd });
      }
      return {
        duration,
        referenceDuration: reference.length / 16000,
        lag,
        chunks,
        canonicalMismatches,
        chromeMismatches,
        positive,
        negative,
      };
    });
    console.log(fixture, result);
    expect(result.chunks.length).toBe(Math.ceil(result.duration / 30));
    if (fixture === '../long.wav') {
      expect(result.canonicalMismatches).toBe(0);
      expect(result.chromeMismatches).toBe(0);
      expect(result.positive).toBeGreaterThan(0);
      expect(result.negative).toBeGreaterThan(0);
    }
    expect(Math.abs(result.duration - result.referenceDuration)).toBeLessThan(0.1);
    expect(Math.abs(result.lag)).toBeLessThan(1600);
    for (const chunk of result.chunks) expect(chunk.error).toBeLessThan(0.03);
  });
}

test('large file decoding remains bounded beyond two hours, supports cancellation and rejects invalid media', async ({
  page,
}) => {
  test.setTimeout(180000);
  const duration = 2 * 3600 + 10,
    sampleRate = 16000;
  const bytes = duration * sampleRate * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF');
  header.writeUInt32LE(bytes + 36, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(bytes, 40);
  await mkdir('test-results', { recursive: true });
  const path = resolve('test-results/large-audio.wav');
  const file = await open(path, 'w');
  try {
    await file.write(header);
    // One reusable second containing a deterministic ramp, including across every window boundary.
    const second = Buffer.alloc(sampleRate * 2);
    for (let i = 0; i < sampleRate; i++) second.writeInt16LE((i % 100) * 100, i * 2);
    for (let i = 0; i < duration; i++) await file.write(second);
  } finally {
    await file.close();
  }
  await page.goto('/');
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'decode-file';
    document.body.append(input);
  });
  await page.locator('#decode-file').setInputFiles(path);
  const cdp = await page.context().newCDPSession(page);
  // Measure retained memory consistently across Chrome's platform-specific GC schedules.
  await page.exposeFunction('measureRenderer', async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    return cdp.send('Runtime.getHeapUsage');
  });
  const result = await page.evaluate(async () => {
    const path = '/sdk/pianissimo.js';
    const { decodeAudioChunks } = await import(path);
    const file = (document.querySelector('#decode-file') as HTMLInputElement).files![0]!;
    // A whole-file read is always a regression, irrespective of available RAM.
    let maxBlobRead = 0;
    const read = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function () {
      maxBlobRead = Math.max(maxBlobRead, this.size);
      if (this.size > 8 * 1024 * 1024) throw new Error('Oversized contiguous blob read');
      return read.call(this);
    };
    let windows = 0,
      samples = 0,
      maxWindow = 0,
      error = 0;
    const memory: { usedSize: number; backingStorageSize: number }[] = [];
    for await (const chunk of decodeAudioChunks(file)) {
      windows++;
      samples += chunk.keepEnd - chunk.keepStart;
      maxWindow = Math.max(maxWindow, chunk.audio.byteLength);
      for (const i of [0, 15999, chunk.audio.length - 1]) {
        const expected = (((chunk.start + i) % 100) * 100) / 32768;
        error = Math.max(error, Math.abs(chunk.audio[i] - expected));
      }
      if (windows % 30 === 0)
        memory.push(
          await (
            window as unknown as {
              measureRenderer: () => Promise<{ usedSize: number; backingStorageSize: number }>;
            }
          ).measureRenderer(),
        );
    }
    const abort = new AbortController();
    const iterator = decodeAudioChunks(file, abort.signal);
    await iterator.next();
    const start = performance.now();
    abort.abort();
    let cancelled = false;
    try {
      await iterator.next();
    } catch (e) {
      cancelled = (e as Error).name === 'AbortError';
    }
    const cancelMs = performance.now() - start;
    let invalid = false;
    try {
      for await (const _chunk of decodeAudioChunks(new Blob(['not audio']))) {
      }
    } catch {
      invalid = true;
    }
    return {
      bytes: file.size,
      windows,
      samples,
      maxWindow,
      error,
      maxBlobRead,
      memory,
      cancelled,
      cancelMs,
      invalid,
    };
  });
  expect(result.bytes).toBeGreaterThan(100 * 1024 * 1024);
  expect(result.samples).toBe(duration * sampleRate);
  expect(result.windows).toBe(Math.ceil(duration / 30));
  expect(result.maxWindow).toBeLessThanOrEqual(34 * 16000 * 4);
  expect(result.error).toBe(0);
  expect(result.cancelled).toBe(true);
  expect(result.cancelMs).toBeLessThan(1000);
  expect(result.invalid).toBe(true);
  expect(Math.max(...result.memory.map((m) => m.usedSize + m.backingStorageSize))).toBeLessThan(
    192 * 1024 * 1024,
  );
  await writeFile(
    test.info().outputPath('large-file-decode.json'),
    JSON.stringify(
      {
        duration,
        memoryScope:
          'Retained main renderer JS heap plus backing stores after GC; excludes native decoder allocations and model worker',
        ...result,
      },
      null,
      2,
    ),
  );
});

test('in-flight file decoding responds to AbortSignal', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'decode-file';
    document.body.append(input);
  });
  await page.locator('#decode-file').setInputFiles('tests/fixtures/formats/long.m4a');
  const result = await page.evaluate(async () => {
    const path = '/sdk/pianissimo.js',
      { decodeAudioChunks } = await import(path);
    const file = (document.querySelector('#decode-file') as HTMLInputElement).files![0]!;
    const controller = new AbortController(),
      iterator = decodeAudioChunks(file, controller.signal);
    const pending = iterator.next();
    // Abort after asynchronous reading has started, before any PCM window was yielded.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const start = performance.now();
    controller.abort();
    try {
      await pending;
      return { cancelled: false, ms: performance.now() - start };
    } catch (error) {
      return { cancelled: (error as Error).name === 'AbortError', ms: performance.now() - start };
    } finally {
      await iterator.return();
    }
  });
  expect(result.cancelled).toBe(true);
  expect(result.ms).toBeLessThan(1000);
});

test('two-hour MP3: continuous decoding and renderer memory', async ({ page }) => {
  test.skip(!process.env.LARGE_MP3, 'Set LARGE_MP3 to the path of a two-hour MP3 fixture.');
  test.setTimeout(180000);
  await page.goto('/');
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'decode-file';
    document.body.append(input);
  });
  await page.locator('#decode-file').setInputFiles(process.env.LARGE_MP3!);
  const cdp = await page.context().newCDPSession(page);
  // Measure retained memory consistently across Chrome's platform-specific GC schedules.
  await page.exposeFunction('measureRenderer', async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    return cdp.send('Runtime.getHeapUsage');
  });
  const result = await page.evaluate(async () => {
    const path = '/sdk/pianissimo.js',
      { decodeAudioChunks } = await import(path);
    const file = (document.querySelector('#decode-file') as HTMLInputElement).files![0]!;
    let samples = 0,
      windows = 0,
      duration = 0;
    const memory: { usedSize: number; backingStorageSize: number }[] = [];
    for await (const chunk of decodeAudioChunks(file)) {
      if (chunk.keepStart !== samples) throw new Error('Discontinuous ownership');
      samples = chunk.keepEnd;
      duration = chunk.duration;
      windows++;
      if (windows % 30 === 0)
        memory.push(
          await (
            window as unknown as {
              measureRenderer: () => Promise<{ usedSize: number; backingStorageSize: number }>;
            }
          ).measureRenderer(),
        );
    }
    return { bytes: file.size, duration, samples, windows, memory };
  });
  expect(result.duration).toBeGreaterThan(7200);
  expect(result.bytes).toBeGreaterThan(100 * 1024 * 1024);
  expect(result.samples).toBe(Math.round(result.duration * 16000));
  expect(Math.max(...result.memory.map((m) => m.usedSize + m.backingStorageSize))).toBeLessThan(
    256 * 1024 * 1024,
  );
  await writeFile(
    test.info().outputPath('large-mp3-decode.json'),
    JSON.stringify(
      {
        memoryScope:
          'Retained main renderer JS heap and backing stores after GC; excludes native decoder allocations',
        ...result,
      },
      null,
      2,
    ),
  );
});
