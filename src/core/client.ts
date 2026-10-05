import { SAMPLE_RATE, validateAudio } from './audio.ts';
import { decodeAudioChunks } from './file-audio.ts';
import { normalizeText } from './text.ts';
import type { LoadOptions, Progress, Request, Response, Transcript, Word } from './types.ts';
export type { LoadOptions, Progress, Quantization, Transcript, Word } from './types.ts';
export { decodeAudio } from './audio.ts';
export { decodeAudioChunks } from './file-audio.ts';
interface Pending {
  resolve: (result?: Transcript) => void;
  reject: (error: Error) => void;
  progress?: (p: Progress) => void;
  cleanup: () => void;
}
/** One worker owns one model. dispose()/AbortSignal terminate inference and release WASM memory. */
export class Pianissimo {
  private worker?: Worker;
  private sequence = 0;
  private generation = 0;
  private pending = new Map<number, Pending>();
  private loaded = false;
  private operating = false;
  private fileAbort?: AbortController;
  private readonly onWorkerError?: (error: Error) => void;
  constructor(onWorkerError?: (error: Error) => void) {
    this.onWorkerError = onWorkerError;
  }
  private workerFailed(error: Error) {
    this.dispose(error);
    this.onWorkerError?.(error);
  }
  private ensureWorker(): Worker {
    if (!this.worker) {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<Response>) => {
        if (this.worker !== worker) return;
        const message = event.data,
          pending = this.pending.get(message.id);
        if (!pending) return;
        if (message.type === 'progress') {
          try {
            pending.progress?.(message.progress);
          } catch (error) {
            if (this.worker === worker)
              this.dispose(error instanceof Error ? error : new Error(String(error)));
          }
          return;
        }
        this.pending.delete(message.id);
        pending.cleanup();
        if (message.type === 'error') pending.reject(new Error(message.message));
        else pending.resolve(message.result);
      };
      worker.onerror = () => {
        if (this.worker === worker)
          this.workerFailed(
            new Error('Transcription stopped unexpectedly. Close other tabs and reload the model.'),
          );
      };
      worker.onmessageerror = () => {
        if (this.worker === worker)
          this.workerFailed(new Error('Could not read the transcription response.'));
      };
    }
    return this.worker;
  }
  private request(
    request: Request,
    progress?: (p: Progress) => void,
    signal?: AbortSignal,
    transfer: Transferable[] = [],
  ): Promise<Transcript | undefined> {
    if (signal?.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
    if (this.pending.size) return Promise.reject(new Error('Another operation is in progress.'));
    return new Promise((resolve, reject) => {
      const abort = () => this.dispose(new DOMException('Cancelled', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(request.id, {
        resolve,
        reject,
        progress,
        cleanup: () => signal?.removeEventListener('abort', abort),
      });
      try {
        this.ensureWorker().postMessage(request, transfer);
      } catch (error) {
        this.dispose(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  get isLoaded(): boolean {
    return this.loaded;
  }
  async load(options: LoadOptions = {}): Promise<void> {
    if (this.operating) throw new Error('Another operation is in progress.');
    if (this.loaded) throw new Error('Unload the model before switching variants.');
    const { signal, onProgress, ...config } = options;
    const generation = this.generation;
    this.operating = true;
    try {
      await this.request(
        {
          id: ++this.sequence,
          type: 'load',
          options: {
            ...config,
            runtimeBaseUrl:
              config.runtimeBaseUrl ??
              new URL(/* @vite-ignore */ './runtime/', import.meta.url).href,
          },
        },
        onProgress,
        signal,
      );
      if (generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
      this.loaded = true;
    } catch (error) {
      if (generation === this.generation) this.dispose();
      throw error;
    } finally {
      if (generation === this.generation) this.operating = false;
    }
  }
  async transcribe(
    audio: Float32Array,
    options: Pick<LoadOptions, 'signal' | 'onProgress'> = {},
  ): Promise<Transcript> {
    if (this.operating) throw new Error('Another operation is in progress.');
    if (!this.loaded) throw new Error('Load a model first.');
    validateAudio(audio);
    // Do not detach the caller's audio; they may need it for playback or retry.
    const copy = audio.slice();
    const generation = this.generation;
    this.operating = true;
    try {
      const result = await this.request(
        { id: ++this.sequence, type: 'transcribe', audio: copy },
        options.onProgress,
        options.signal,
        [copy.buffer],
      );
      if (generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
      return result!;
    } finally {
      if (generation === this.generation) this.operating = false;
    }
  }
  async clearCache(): Promise<void> {
    this.dispose();
    const generation = this.generation;
    this.operating = true;
    try {
      await this.request({ id: ++this.sequence, type: 'clear' });
    } finally {
      if (generation === this.generation) this.dispose();
    }
  }
  /** Incrementally decode a local file; only one overlapping audio window is sent to inference at a time. */
  async transcribeFile(
    file: Blob,
    options: Pick<LoadOptions, 'signal' | 'onProgress'> = {},
  ): Promise<Transcript> {
    if (this.operating) throw new Error('Another operation is in progress.');
    if (!this.loaded) throw new Error('Load a model first.');
    options.signal?.throwIfAborted();
    const generation = this.generation,
      started = performance.now();
    const controller = new AbortController();
    this.fileAbort = controller;
    const abort = () => this.dispose(new DOMException('Cancelled', 'AbortError'));
    options.signal?.addEventListener('abort', abort, { once: true });
    this.operating = true;
    const words: Word[] = [];
    let result: Transcript | undefined;
    try {
      for await (const chunk of decodeAudioChunks(file, controller.signal)) {
        controller.signal.throwIfAborted();
        options.onProgress?.({
          phase: 'transcribe',
          fraction: chunk.keepStart / (chunk.duration * SAMPLE_RATE),
          duration: chunk.duration,
        });
        controller.signal.throwIfAborted();
        validateAudio(chunk.audio);
        result = (await this.request(
          { id: ++this.sequence, type: 'window', audio: chunk.audio },
          undefined,
          undefined,
          [chunk.audio.buffer],
        ))!;
        controller.signal.throwIfAborted();
        for (const word of result.words) {
          const start = word.start + chunk.start / SAMPLE_RATE,
            end = word.end + chunk.start / SAMPLE_RATE;
          // A late punctuation token can move a word's end across the boundary.
          // Its acoustic onset determines ownership in both overlapping windows.
          const onset = Math.round(start * SAMPLE_RATE);
          if (
            onset >= chunk.keepStart &&
            (onset < chunk.keepEnd || chunk.keepEnd === Math.round(chunk.duration * SAMPLE_RATE))
          )
            words.push({ text: word.text, start, end });
        }
        result = {
          ...result,
          words,
          text: normalizeText(words.map((w) => w.text).join(' ')),
          duration: chunk.duration,
          processingSeconds: (performance.now() - started) / 1000,
        };
        options.onProgress?.({
          phase: 'transcribe',
          fraction: chunk.keepEnd / (chunk.duration * SAMPLE_RATE),
          text: result.text,
          duration: result.duration,
        });
        controller.signal.throwIfAborted();
      }
      controller.signal.throwIfAborted();
      if (!result) throw new Error('This file contains no decodable audio.');
      return result;
    } finally {
      options.signal?.removeEventListener('abort', abort);
      if (generation === this.generation) {
        this.fileAbort = undefined;
        this.operating = false;
      }
    }
  }
  dispose(error: Error = new DOMException('Cancelled', 'AbortError')): void {
    this.generation++;
    this.operating = false;
    const fileAbort = this.fileAbort;
    this.fileAbort = undefined;
    fileAbort?.abort(error);
    this.worker?.terminate();
    this.worker = undefined;
    this.loaded = false;
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
  }
}
