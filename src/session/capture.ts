export class MicrophoneCapture {
  private context?: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;
  private gain?: GainNode;
  private stopped?: () => void;
  private generation = 0;
  async start(
    onAudio: (audio: Float32Array) => void,
    onEnd: (error: Error) => void,
  ): Promise<void> {
    const generation = ++this.generation;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    if (generation !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      throw new DOMException('Cancelled', 'AbortError');
    }
    this.stream = stream;
    try {
      const context = new AudioContext({ sampleRate: 16000 });
      this.context = context;
      await context.audioWorklet.addModule(new URL('./capture-worklet.js', location.href).href);
      if (generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
      if (context.sampleRate !== 16000)
        throw new Error('This device cannot capture audio at 16 kHz.');
      const node = new AudioWorkletNode(context, 'pianissimo-capture');
      this.node = node;
      node.port.onmessage = (event) => {
        if (generation !== this.generation) return;
        if (event.data.type === 'audio') onAudio(event.data.data);
        else if (event.data.type === 'stopped') this.stopped?.();
      };
      node.onprocessorerror = () => onEnd(new Error('Audio capture stopped unexpectedly.'));
      const source = context.createMediaStreamSource(stream);
      this.source = source;
      const gain = context.createGain();
      gain.gain.value = 0;
      this.gain = gain;
      source.connect(node).connect(gain).connect(context.destination);
      stream.getTracks().forEach((t) => {
        t.onended = () => onEnd(new Error('The microphone disconnected.'));
      });
      await context.resume();
      if (generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
    } catch (error) {
      this.cancel();
      throw error;
    }
  }
  async stop(): Promise<void> {
    try {
      if (this.node) {
        if (this.context?.state !== 'running')
          throw new Error(
            'Audio capture was interrupted. The last fraction of a second may be missing.',
          );
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () =>
              reject(
                new Error(
                  'The microphone did not finish cleanly. The last fraction of a second may be missing.',
                ),
              ),
            1500,
          );
          this.stopped = () => {
            clearTimeout(timeout);
            resolve();
          };
          this.node!.port.postMessage('stop');
        });
      }
    } finally {
      this.cancel();
    }
  }
  cancel(): void {
    this.generation++;
    this.stopped?.();
    this.stopped = undefined;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.source?.disconnect();
    this.node?.disconnect();
    this.gain?.disconnect();
    if (this.node) this.node.port.close();
    this.node = undefined;
    void this.context?.close().catch(() => {});
    this.context = undefined;
  }
}
