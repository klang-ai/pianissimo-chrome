import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pianissimo } from '../../src/core/client.ts';
import type { Request, Response } from '../../src/core/types.ts';
class ControlledWorker {
  static instances: ControlledWorker[] = [];
  onmessage?: (event: { data: Response }) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  messages: Request[] = [];
  terminated = false;
  constructor() {
    ControlledWorker.instances.push(this);
  }
  postMessage(message: Request) {
    this.messages.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  done() {
    this.onmessage?.({ data: { id: this.messages.at(-1)!.id, type: 'done' } });
  }
}
globalThis.Worker = ControlledWorker as unknown as typeof Worker;
const latest = () => ControlledWorker.instances.at(-1)!;
test('a second concurrent load cannot terminate the first load', async () => {
  const client = new Pianissimo();
  const first = client.load();
  const worker = latest();
  await assert.rejects(client.load(), /operation/u);
  assert.equal(worker.terminated, false);
  worker.done();
  await first;
  assert.equal(client.isLoaded, true);
  client.dispose();
  assert.equal(worker.terminated, true);
});
test('aborting a load terminates the worker, rejects the request and permits retry', async () => {
  const client = new Pianissimo(),
    controller = new AbortController();
  const promise = client.load({ signal: controller.signal });
  const worker = latest();
  controller.abort();
  await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(worker.terminated, true);
  assert.equal(client.isLoaded, false);
  const retry = client.load();
  assert.notEqual(latest(), worker);
  latest().done();
  await retry;
  assert.equal(client.isLoaded, true);
  client.dispose();
});
test('a crashed worker releases pending work and resets loaded state', async () => {
  const client = new Pianissimo();
  const promise = client.load();
  const worker = latest();
  worker.onerror?.();
  await assert.rejects(promise, /unexpectedly/u);
  assert.equal(worker.terminated, true);
  assert.equal(client.isLoaded, false);
});
test('pre-aborted operation does not start a worker', async () => {
  const count = ControlledWorker.instances.length,
    client = new Pianissimo();
  await assert.rejects(client.load({ signal: AbortSignal.abort() }), { name: 'AbortError' });
  assert.equal(ControlledWorker.instances.length, count);
});
test('immediate retry survives the cancelled load continuation and stale worker errors', async () => {
  const client = new Pianissimo();
  const first = client.load();
  const oldWorker = latest();
  const cancelled = assert.rejects(first, { name: 'AbortError' });
  client.dispose();
  const retry = client.load();
  const newWorker = latest();
  oldWorker.onerror?.();
  oldWorker.onmessageerror?.();
  await cancelled;
  assert.equal(newWorker.terminated, false);
  newWorker.done();
  await retry;
  assert.equal(client.isLoaded, true);
  client.dispose();
});
test('dispose between worker completion and load continuation cannot resurrect loaded state', async () => {
  const client = new Pianissimo();
  const loading = client.load();
  latest().done();
  client.dispose();
  await assert.rejects(loading, { name: 'AbortError' });
  assert.equal(client.isLoaded, false);
});
test('cancelled cache deletion cannot dispose an immediate new load', async () => {
  const client = new Pianissimo();
  const clearing = client.clearCache();
  const cancelled = assert.rejects(clearing, { name: 'AbortError' });
  client.dispose();
  const loading = client.load();
  const worker = latest();
  await cancelled;
  assert.equal(worker.terminated, false);
  worker.done();
  await loading;
  assert.equal(client.isLoaded, true);
  client.dispose();
});
test('cache deletion retains the operation lock until public completion', async () => {
  const client = new Pianissimo();
  const clearing = client.clearCache();
  latest().done();
  await assert.rejects(client.load(), /operation/u);
  await clearing;
  const loading = client.load();
  latest().done();
  await loading;
  assert.equal(client.isLoaded, true);
  client.dispose();
});
test('load retains the operation lock between worker completion and public completion', async () => {
  const client = new Pianissimo();
  const first = client.load();
  const worker = latest();
  worker.done();
  await assert.rejects(client.load(), /operation/u);
  await first;
  assert.equal(worker.terminated, false);
  assert.equal(client.isLoaded, true);
  client.dispose();
});
function audioFile(samples = 1600) {
  const bytes = new Uint8Array(44 + samples * 2),
    view = new DataView(bytes.buffer);
  for (const [offset, text] of [
    [0, 'RIFF'],
    [8, 'WAVEfmt '],
    [36, 'data'],
  ] as const)
    bytes.set(new TextEncoder().encode(text), offset);
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, samples * 2, true);
  return new Blob([bytes]);
}
for (const fraction of [0, 1])
  test(`file progress cancellation at ${fraction} cannot affect an immediate replacement load`, async () => {
    const client = new Pianissimo(),
      controller = new AbortController();
    const loaded = client.load();
    latest().done();
    await loaded;
    const original = latest();
    let replacement: Promise<void> | undefined;
    const file = client.transcribeFile(audioFile(), {
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.fraction === fraction && !replacement) {
          controller.abort();
          replacement = client.load();
        }
      },
    });
    const cancelled = assert.rejects(file, { name: 'AbortError' });
    for (let i = 0; i < 100 && !replacement; i++) {
      await new Promise((resolve) => setImmediate(resolve));
      const request = original.messages.at(-1)!;
      if (request.type === 'window')
        original.onmessage?.({
          data: {
            id: request.id,
            type: 'done',
            result: {
              text: '',
              words: [],
              duration: 0.1,
              processingSeconds: 0,
              model: 'test',
              revision: 'test',
              quantization: 'int8',
            },
          },
        });
    }
    await cancelled;
    assert.ok(replacement);
    assert.notEqual(latest(), original);
    assert.equal(latest().terminated, false);
    latest().done();
    await replacement;
    assert.equal(client.isLoaded, true);
    client.dispose();
  });
test('disposing during file metadata decoding cannot affect an immediate replacement load', async () => {
  const client = new Pianissimo();
  const loaded = client.load();
  latest().done();
  await loaded;
  const file = client.transcribeFile(audioFile());
  const cancelled = assert.rejects(file, { name: 'AbortError' });
  client.dispose();
  const replacement = client.load();
  const worker = latest();
  await cancelled;
  assert.equal(worker.terminated, false);
  worker.done();
  await replacement;
  client.dispose();
});

test('a throwing progress callback rejects the operation and releases its worker', async () => {
  const client = new Pianissimo();
  const failure = new Error('Progress consumer failed');
  const loading = client.load({
    onProgress: () => {
      throw failure;
    },
  });
  const worker = latest();
  const rejected = assert.rejects(loading, (error) => error === failure);
  assert.doesNotThrow(() =>
    worker.onmessage?.({
      data: {
        id: worker.messages[0]!.id,
        type: 'progress',
        progress: { phase: 'download', fraction: 0.5 },
      },
    }),
  );
  await rejected;
  assert.equal(worker.terminated, true);
  assert.equal(client.isLoaded, false);
  const retry = client.load();
  latest().done();
  await retry;
  client.dispose();
});

test('disposing after an inference reply still cancels its unfinished public operation', async () => {
  const client = new Pianissimo();
  const loading = client.load();
  latest().done();
  await loading;
  const result = client.transcribe(new Float32Array(1600));
  latest().done();
  client.dispose();
  await assert.rejects(result, { name: 'AbortError' });
});

test('file overlap does not duplicate a word whose punctuation crosses the boundary', async () => {
  const client = new Pianissimo();
  const loading = client.load();
  const worker = latest();
  worker.done();
  await loading;
  let windows = 0;
  worker.postMessage = (request) => {
    worker.messages.push(request);
    assert.equal(request.type, 'window');
    const words =
      windows++ === 0
        ? [{ text: 'familj.', start: 29.12, end: 29.92 }]
        : [
            { text: 'familj.', start: 1.12, end: 3.76 },
            { text: 'Nästa', start: 3.84, end: 4.32 },
          ];
    queueMicrotask(() =>
      worker.onmessage?.({
        data: {
          id: request.id,
          type: 'done',
          result: {
            text: words.map((word) => word.text).join(' '),
            words,
            duration: 32,
            processingSeconds: 0,
            model: 'test',
            revision: 'test',
            quantization: 'int8',
          },
        },
      }),
    );
  };
  try {
    const result = await client.transcribeFile(audioFile(39 * 16000));
    assert.equal(windows, 2);
    assert.equal(result.text, 'familj. Nästa');
    assert.deepEqual(
      result.words.map((word) => word.start),
      [29.12, 31.84],
    );
  } finally {
    client.dispose();
  }
});
