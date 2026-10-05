import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MicrophoneCapture } from '../../src/session/capture.ts';
let trackStopped = false,
  failConstruction = false;
const track = {
  stop() {
    trackStopped = true;
  },
  onended: null,
};
const stream = { getTracks: () => [track] };
const link = () => ({
  connect(target: unknown) {
    return target;
  },
  disconnect() {},
});
class Context {
  static latest: Context;
  state = 'running';
  sampleRate = 16000;
  audioWorklet = { addModule: async () => {} };
  destination = {};
  constructor() {
    if (failConstruction) throw new Error('No audio context');
    Context.latest = this;
  }
  createMediaStreamSource() {
    return link();
  }
  createGain() {
    return { ...link(), gain: { value: 1 } };
  }
  async resume() {}
  async close() {
    this.state = 'closed';
  }
}
class Worklet {
  port = {
    onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
    close() {},
    postMessage: () => {
      this.port.onmessage?.({ data: { type: 'audio', data: new Float32Array(12) } });
      this.port.onmessage?.({ data: { type: 'stopped' } });
    },
  };
  connect(target: unknown) {
    return target;
  }
  disconnect() {}
}
Object.defineProperty(globalThis, 'navigator', {
  value: { mediaDevices: { getUserMedia: async () => stream } },
  configurable: true,
});
Object.defineProperty(globalThis, 'location', { value: { href: 'https://example.test/' } });
globalThis.AudioContext = Context as unknown as typeof AudioContext;
globalThis.AudioWorkletNode = Worklet as unknown as typeof AudioWorkletNode;
test('stop flushes the final samples before releasing microphone tracks', async () => {
  trackStopped = false;
  const capture = new MicrophoneCapture();
  let samples = 0;
  await capture.start(
    (audio) => {
      samples += audio.length;
      assert.equal(trackStopped, false);
    },
    () => {},
  );
  await capture.stop();
  assert.equal(samples, 12);
  assert.equal(trackStopped, true);
});
test('suspended capture reports an incomplete flush and releases the microphone', async () => {
  trackStopped = false;
  const capture = new MicrophoneCapture();
  await capture.start(
    () => {},
    () => {},
  );
  Context.latest.state = 'suspended';
  await assert.rejects(capture.stop(), /interrupted/u);
  assert.equal(trackStopped, true);
  assert.equal(Context.latest.state, 'closed');
});
test('audio context construction failure cannot leak an acquired microphone', async () => {
  trackStopped = false;
  failConstruction = true;
  try {
    await assert.rejects(
      new MicrophoneCapture().start(
        () => {},
        () => {},
      ),
      /No audio context/u,
    );
  } finally {
    failConstruction = false;
  }
  assert.equal(trackStopped, true);
});
