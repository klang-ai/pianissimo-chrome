import { SAMPLE_RATE } from './audio.ts';
import type { LiveUpdate, Transcript, Word } from './types.ts';
const STRIDE = 12 * SAMPLE_RATE;
const CONTEXT = 2 * SAMPLE_RATE;
const UPDATE = 1.2 * SAMPLE_RATE;
const MAX_BACKLOG = 24 * SAMPLE_RATE;
export class LiveOverloadError extends Error {
  constructor() {
    super('Recording stopped because transcription fell behind. Finishing captured audio.');
  }
}
/** Capture never waits for inference. There is one in-flight window and no queue of stale jobs. */
export class LiveTranscriber {
  private pieces: { start: number; data: Float32Array }[] = [];
  private total = 0;
  private ownedStart = 0;
  private lastProcessed = 0;
  private inFlight?: Promise<void>;
  private stopped = false;
  private cancelled = false;
  private words: Word[] = [];
  private computeSeconds = 0;
  private result?: Transcript;
  private failure?: Error;
  private infer: (audio: Float32Array) => Promise<Transcript>;
  private update: (result: LiveUpdate) => void;
  private failed: (error: Error) => void;
  constructor(
    infer: (audio: Float32Array) => Promise<Transcript>,
    update: (result: LiveUpdate) => void,
    failed: (error: Error) => void,
  ) {
    this.infer = infer;
    this.update = update;
    this.failed = failed;
  }
  push(audio: Float32Array): void {
    if (this.stopped || this.cancelled || this.failure) return;
    this.pieces.push({ start: this.total, data: audio });
    this.total += audio.length;
    if (this.total - this.lastProcessed > MAX_BACKLOG) {
      this.failed(new LiveOverloadError());
      return;
    }
    this.schedule();
  }
  private read(start: number, end: number): Float32Array {
    const output = new Float32Array(end - start);
    for (const piece of this.pieces) {
      const from = Math.max(start, piece.start),
        to = Math.min(end, piece.start + piece.data.length);
      if (to > from)
        output.set(piece.data.subarray(from - piece.start, to - piece.start), from - start);
    }
    return output;
  }
  private schedule(): void {
    if (this.inFlight || this.cancelled || this.failure) return;
    const available = this.total - this.lastProcessed;
    if (!this.stopped && available < UPDATE) return;
    if (this.total <= this.ownedStart) return;
    this.inFlight = this.step()
      .catch((error) => {
        if (this.cancelled) return;
        this.failure = error instanceof Error ? error : new Error(String(error));
        this.failed(this.failure);
      })
      .finally(() => {
        this.inFlight = undefined;
        if (!this.stopped) this.schedule();
      });
  }
  private async step(): Promise<void> {
    const start = Math.max(0, this.ownedStart - CONTEXT);
    const end = Math.min(this.total, this.ownedStart + STRIDE + CONTEXT);
    const finalWindow = this.stopped && end === this.total;
    const canCommit = end >= this.ownedStart + STRIDE + CONTEXT || finalWindow;
    const ownedEnd = finalWindow ? end : this.ownedStart + STRIDE;
    // Very short tails are padded, preserving their original duration in the merged result.
    const audio = this.read(start, end);
    const input = audio.length >= 1600 ? audio : new Float32Array(1600);
    if (audio.length < 1600) input.set(audio);
    const result = await this.infer(input);
    if (this.cancelled) return;
    this.computeSeconds += result.processingSeconds;
    this.result = result;
    const output = result.words
      .map((w) => ({
        ...w,
        start: w.start + start / SAMPLE_RATE,
        end: Math.min(end / SAMPLE_RATE, w.end + start / SAMPLE_RATE),
      }))
      .filter(
        (w) => Math.round(w.start * SAMPLE_RATE) >= this.ownedStart && w.start < end / SAMPLE_RATE,
      );
    this.lastProcessed = end;
    if (canCommit) {
      this.words.push(
        ...output.filter((w) => finalWindow || Math.round(w.start * SAMPLE_RATE) < ownedEnd),
      );
      this.ownedStart = ownedEnd;
      const retain = Math.max(0, ownedEnd - CONTEXT);
      this.pieces = this.pieces.filter((p) => p.start + p.data.length > retain);
    }
    this.update({
      words: [...this.words],
      draft: canCommit
        ? output.filter((w) => !finalWindow && Math.round(w.start * SAMPLE_RATE) >= ownedEnd)
        : output,
      processed: end / SAMPLE_RATE,
      elapsed: this.total / SAMPLE_RATE,
      processingSeconds: this.computeSeconds,
    });
  }
  async finish(): Promise<Transcript | undefined> {
    this.stopped = true;
    await this.inFlight;
    if (this.failure) throw this.failure;
    while (!this.cancelled && this.ownedStart < this.total) await this.step();
    if (this.cancelled || !this.result) return;
    return {
      ...this.result,
      text: this.words.map((w) => w.text).join(' '),
      words: this.words,
      duration: this.total / SAMPLE_RATE,
      processingSeconds: this.computeSeconds,
    };
  }
  cancel(): void {
    this.cancelled = true;
    this.pieces = [];
  }
}
