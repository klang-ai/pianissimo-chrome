/* Audio capture only. Inference runs in a separate worker. No fixed 128-frame assumption. */
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(1600);
    this.used = 0;
    this.active = true;
    this.port.onmessage = (event) => {
      if (event.data === 'stop') {
        this.flush();
        this.active = false;
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }
  flush() {
    if (!this.used) return;
    const data = this.buffer.slice(0, this.used);
    this.port.postMessage({ type: 'audio', data }, [data.buffer]);
    this.used = 0;
  }
  process(inputs) {
    if (!this.active) return false;
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] || 0;
      this.buffer[this.used++] = Math.max(-1, Math.min(1, value / channels.length));
      if (this.used === this.buffer.length) this.flush();
    }
    return true;
  }
}
registerProcessor('pianissimo-capture', PcmCapture);
