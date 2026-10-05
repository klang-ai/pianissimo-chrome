import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveTranscriber, LiveOverloadError } from '../../src/core/live.ts';
import type { Transcript } from '../../src/core/types.ts';
import type { LiveUpdate } from '../../src/core/types.ts';
const pcm = (start: number, duration: number) =>
  Float32Array.from({ length: Math.round(duration * 16000) }, (_, i) => start + i / 16000);
function result(audio: Float32Array): Transcript {
  const start = audio[0]!,
    end = start + audio.length / 16000;
  const words = [];
  for (let second = Math.ceil(start); second + 0.5 <= end + 0.001; second++)
    words.push({ text: `word${second}`, start: second + 0.1 - start, end: second + 0.5 - start });
  return {
    text: words.map((w) => w.text).join(' '),
    words,
    duration: audio.length / 16000,
    processingSeconds: 0.01,
    model: 'test',
    revision: 'test',
    quantization: 'int8',
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
test('live previews retain right context; final flush owns every word once across windows', async () => {
  const updates: LiveUpdate[] = [];
  const live = new LiveTranscriber(
    async (audio) => result(audio),
    (update) => updates.push(update),
    (error) => {
      throw error;
    },
  );
  for (let i = 0; i < 28; i++) {
    live.push(pcm(i, 1));
    await tick();
  }
  assert.ok(updates.some((u) => u.words.length === 12 && u.draft.length === 2));
  assert.ok(updates.some((u) => !u.words.length && u.draft.length > 0));
  live.push(pcm(28, 0.6));
  const final = await live.finish();
  assert.equal(final?.duration, 28.6);
  assert.deepEqual(
    final?.words.map((w) => w.text),
    Array.from({ length: 29 }, (_, i) => `word${i}`),
  );
  assert.ok(
    final?.words.every(
      (w, i, arr) => w.start >= 0 && w.end <= final.duration && (!i || w.start >= arr[i - 1]!.end),
    ),
  );
});
test('slow inference remains single-flight, detects overload and finishes captured audio', async () => {
  let release!: () => void,
    calls = 0;
  const failure: Error[] = [];
  const live = new LiveTranscriber(
    async (audio) => {
      if (++calls === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return result(audio);
    },
    () => {},
    (error) => failure.push(error),
  );
  live.push(pcm(0, 2));
  live.push(pcm(2, 23));
  assert.equal(calls, 1);
  assert.ok(failure[0] instanceof LiveOverloadError);
  const finishing = live.finish();
  release();
  const final = await finishing;
  assert.equal(final?.duration, 25);
  assert.deepEqual(
    final?.words.map((w) => w.text),
    Array.from({ length: 25 }, (_, i) => `word${i}`),
  );
});
test('cancelled in-flight inference cannot publish stale text', async () => {
  let release!: () => void;
  const updates: LiveUpdate[] = [];
  const live = new LiveTranscriber(
    async (audio) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return result(audio);
    },
    (update) => updates.push(update),
    (error) => {
      throw error;
    },
  );
  live.push(pcm(0, 2));
  live.cancel();
  release();
  assert.equal(await live.finish(), undefined);
  assert.deepEqual(updates, []);
});
test('sub-100ms tail is padded for inference without extending duration', async () => {
  let size = 0;
  const live = new LiveTranscriber(
    async (audio) => {
      size = audio.length;
      return result(audio);
    },
    () => {},
    (error) => {
      throw error;
    },
  );
  live.push(pcm(0, 0.025));
  const final = await live.finish();
  assert.equal(size, 1600);
  assert.equal(final?.duration, 0.025);
});
test('live capture passes two hours without a duration cap or growing audio windows', async () => {
  let largest = 0;
  const failures: Error[] = [];
  const live = new LiveTranscriber(
    async (audio) => {
      largest = Math.max(largest, audio.length);
      return {
        text: '',
        words: [],
        duration: audio.length / 16000,
        processingSeconds: 0,
        model: 'test',
        revision: 'test',
        quantization: 'int8',
      };
    },
    () => {},
    (error) => failures.push(error),
  );
  const second = new Float32Array(16000);
  for (let i = 0; i < 7210; i++) {
    live.push(second);
    await tick();
  }
  const final = await live.finish();
  assert.equal(final?.duration, 7210);
  assert.deepEqual(failures, []);
  assert.ok(largest <= 16 * 16000);
});

test('late punctuation cannot move a committed live word into the next window', async () => {
  let calls = 0;
  const live = new LiveTranscriber(
    async (audio) => ({
      ...result(audio),
      words:
        calls++ === 0
          ? [{ text: 'klart.', start: 11.2, end: 11.9 }]
          : [
              { text: 'klart.', start: 1.2, end: 3.5 },
              { text: 'Nästa', start: 3.6, end: 4 },
            ],
    }),
    () => {},
    (error) => {
      throw error;
    },
  );
  live.push(pcm(0, 14));
  await tick();
  live.push(pcm(14, 1));
  const final = await live.finish();
  assert.deepEqual(
    final?.words.map((word) => word.text),
    ['klart.', 'Nästa'],
  );
});
