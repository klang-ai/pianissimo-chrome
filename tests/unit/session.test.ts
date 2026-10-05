import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionController } from '../../src/session/controller.ts';
import { MicrophoneCapture } from '../../src/session/capture.ts';
import type { Request, Response } from '../../src/core/types.ts';
class ControlledWorker {
  static latest: ControlledWorker;
  onmessage?: (event: { data: Response }) => void;
  onerror?: () => void;
  request?: Request;
  constructor() {
    ControlledWorker.latest = this;
  }
  postMessage(request: Request) {
    this.request = request;
  }
  terminate() {}
  done() {
    this.onmessage?.({ data: { id: this.request!.id, type: 'done' } });
  }
}
globalThis.Worker = ControlledWorker as unknown as typeof Worker;
Object.defineProperty(globalThis, 'location', { value: { href: 'https://example.test/' } });
const tick = () => new Promise((resolve) => setImmediate(resolve));
test('idle worker failure restores model loading and allows recovery', async () => {
  const session = new SessionController();
  const load = { type: 'load', modelId: 'pianissimo-sv', quantization: 'int8' } as const;
  session.command(load);
  ControlledWorker.latest.done();
  await tick();
  assert.equal(session.state.loaded, true);
  ControlledWorker.latest.onerror?.();
  assert.equal(session.state.loaded, false);
  assert.equal(session.state.phase, 'idle');
  assert.match(session.state.error, /unexpectedly/u);
  session.command(load);
  ControlledWorker.latest.done();
  await tick();
  assert.equal(session.state.loaded, true);
  assert.equal(session.state.error, '');
  session.cancel();
});
test('worker crash during file decoding restores idle state instead of swallowing the failure as cancellation', async () => {
  const session = new SessionController();
  session.command({ type: 'load', modelId: 'pianissimo-sv', quantization: 'int8' });
  ControlledWorker.latest.done();
  await tick();
  session.command({ type: 'file', file: new File(['pending decode'], 'pending.wav') });
  assert.equal(session.state.phase, 'decoding');
  ControlledWorker.latest.onerror?.();
  await tick();
  assert.equal(session.state.loaded, false);
  assert.equal(session.state.phase, 'idle');
  assert.match(session.state.error, /unexpectedly/u);
  session.cancel();
});

test('changing language unloads the old worker and selects an available precision', async () => {
  const session = new SessionController();
  session.command({ type: 'load', modelId: 'pianissimo-sv', quantization: 'int4' });
  ControlledWorker.latest.done();
  await tick();
  const oldWorker = ControlledWorker.latest;
  assert.throws(() => session.command({ type: 'select-model', modelId: 'unknown' }));
  assert.equal(session.state.loaded, true);
  session.command({ type: 'select-model', modelId: 'parakeet-tdt-v3' });
  assert.equal(session.state.loaded, false);
  assert.equal(session.state.phase, 'idle');
  assert.equal(session.state.modelId, 'parakeet-tdt-v3');
  assert.equal(session.state.quantization, 'int8');
  assert.throws(
    () => session.command({ type: 'load', modelId: 'parakeet-tdt-v3', quantization: 'int4' }),
    /INT8/u,
  );
  session.command({ type: 'load', modelId: 'parakeet-tdt-v3', quantization: 'int8' });
  assert.throws(
    () => session.command({ type: 'select-model', modelId: 'pianissimo-sv' }),
    /in progress/u,
  );
  oldWorker.onerror?.();
  ControlledWorker.latest.done();
  await tick();
  assert.equal(session.state.loaded, true);
  assert.equal(session.state.error, '');
  session.command({ type: 'select-model', modelId: 'pianissimo-sv' });
  assert.equal(session.state.loaded, false);
  assert.equal(session.state.modelId, 'pianissimo-sv');
  session.cancel();
});

for (const waitingForPermission of [false, true])
  test(`worker crash releases live capture while ${waitingForPermission ? 'requesting permission' : 'waiting for audio'}`, async (t) => {
    let cancelled = false;
    t.mock.method(MicrophoneCapture.prototype, 'start', () =>
      waitingForPermission ? new Promise<void>(() => {}) : Promise.resolve(),
    );
    t.mock.method(MicrophoneCapture.prototype, 'cancel', () => {
      cancelled = true;
    });
    const session = new SessionController();
    session.command({ type: 'load', modelId: 'pianissimo-sv', quantization: 'int8' });
    ControlledWorker.latest.done();
    await tick();
    session.startAnchored('permission-window');
    await tick();
    assert.equal(session.state.phase, waitingForPermission ? 'requesting-mic' : 'recording');
    ControlledWorker.latest.onerror?.();
    await tick();
    assert.equal(cancelled, true);
    assert.equal(session.ownsCapture('permission-window'), false);
    assert.equal(session.state.loaded, false);
    assert.equal(session.state.phase, 'idle');
    assert.match(session.state.error, /unexpectedly/u);
    session.cancel();
  });
