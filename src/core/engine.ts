import * as ort from 'onnxruntime-web/wasm';
import { modelFile } from './cache.ts';
import { getModel } from './model.ts';
import { argmax, normalizeText, parseVocabulary, tokensToWords, type Token } from './text.ts';
import { audioChunks, SAMPLE_RATE, validateAudio } from './audio.ts';
import type { LoadOptions, Progress, Quantization, Transcript, Word } from './types.ts';

const dispose = (values: Record<string, ort.Tensor>) =>
  Object.values(values).forEach((t) => t.dispose());
function integer(type: string, values: number[], dimensions: number[]): ort.Tensor {
  return type === 'int32'
    ? new ort.Tensor('int32', Int32Array.from(values), dimensions)
    : new ort.Tensor('int64', BigInt64Array.from(values.map(BigInt)), dimensions);
}
export class Engine {
  private constructor(
    private encoder: ort.InferenceSession,
    private decoder: ort.InferenceSession,
    private preprocessor: ort.InferenceSession,
    private vocabulary: string[],
    readonly quantization: Quantization,
    private model: ReturnType<typeof getModel>,
  ) {}

  static async load(
    options: Omit<LoadOptions, 'signal' | 'onProgress'>,
    progress: (p: Progress) => void,
  ): Promise<Engine> {
    const model = getModel(options.modelId);
    const quantization = options.quantization ?? 'int8';
    const threads = options.threads ?? Math.min(4, navigator.hardwareConcurrency || 1);
    if (!Number.isInteger(threads) || threads < 1 || threads > 8)
      throw new Error('Thread count must be between 1 and 8.');
    if (!options.runtimeBaseUrl) throw new Error('ONNX Runtime path is missing.');
    ort.env.wasm.wasmPaths = options.runtimeBaseUrl;
    ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? threads : 1;
    ort.env.wasm.proxy = false;
    ort.env.logLevel = 'error';
    const files: File[] = [];
    for (const asset of model.assets(quantization))
      files.push(
        await modelFile(
          asset,
          options.modelBaseUrl ?? model.baseUrl,
          progress,
          model.cacheDirectory,
        ),
      );
    const sessions: ort.InferenceSession[] = [];
    try {
      for (let i = 0; i < 3; i++) {
        progress({ phase: 'load', fraction: i / 3 });
        // URL loading lets ORT own the large model buffer; release every blob URL immediately.
        const url = URL.createObjectURL(files[i]!);
        try {
          sessions.push(
            await ort.InferenceSession.create(url, {
              executionProviders: ['wasm'],
              graphOptimizationLevel: 'all',
              executionMode: 'sequential',
            }),
          );
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      const vocabulary = parseVocabulary(await files[3]!.text());
      return new Engine(sessions[0]!, sessions[1]!, sessions[2]!, vocabulary, quantization, model);
    } catch (error) {
      await Promise.allSettled(sessions.map((s) => s.release()));
      throw error;
    }
  }

  private async chunk(audio: Float32Array): Promise<Word[]> {
    const waveforms = new ort.Tensor('float32', audio, [1, audio.length]);
    const waveforms_lens = new ort.Tensor('int64', BigInt64Array.of(BigInt(audio.length)), [1]);
    let features: Record<string, ort.Tensor> = {};
    let encoded: Record<string, ort.Tensor> = {};
    try {
      features = await this.preprocessor.run({ waveforms, waveforms_lens });
      encoded = await this.encoder.run({
        audio_signal: features.features!,
        length: features.features_lens!,
      });
      const output = encoded.outputs!;
      const [batch, channels, frames] = output.dims;
      const length = Number(encoded.encoded_lengths!.data[0]);
      if (batch !== 1 || !channels || !frames || length > frames || length < 1)
        throw new Error('Unexpected model output shape.');
      const tokens = await this.decode(output.data as Float32Array, channels, frames, length);
      return tokensToWords(tokens, this.vocabulary, audio.length / SAMPLE_RATE);
    } finally {
      waveforms.dispose();
      waveforms_lens.dispose();
      dispose(features);
      dispose(encoded);
    }
  }

  private async decode(
    encoded: Float32Array,
    channels: number,
    frames: number,
    length: number,
  ): Promise<Token[]> {
    const blank = this.vocabulary.length - 1;
    const metadata = (name: string) => {
      const value = this.decoder.inputMetadata[this.decoder.inputNames.indexOf(name)];
      if (!value?.isTensor) throw new Error('Unexpected decoder structure.');
      return value;
    };
    const shape = metadata('input_states_1').shape;
    const layers = Number(shape[0]),
      hidden = Number(shape[2]);
    if (!Number.isInteger(layers) || !Number.isInteger(hidden))
      throw new Error('Unexpected decoder structure.');
    let state1: ort.Tensor = new ort.Tensor('float32', new Float32Array(layers * hidden), [
      layers,
      1,
      hidden,
    ]);
    let state2: ort.Tensor = new ort.Tensor('float32', new Float32Array(layers * hidden), [
      layers,
      1,
      hidden,
    ]);
    const frame = new Float32Array(channels);
    const encoder_outputs = new ort.Tensor('float32', frame, [1, channels, 1]);
    const target_length = integer(metadata('target_length').type, [1], [1]);
    const tokens: Token[] = [];
    let t = 0,
      emitted = 0,
      previous = blank;
    try {
      while (t < length) {
        for (let d = 0; d < channels; d++) frame[d] = encoded[d * frames + t]!;
        const targets = integer(metadata('targets').type, [previous], [1, 1]);
        let outputs: Record<string, ort.Tensor> = {};
        try {
          outputs = await this.decoder.run({
            encoder_outputs,
            targets,
            target_length,
            input_states_1: state1,
            input_states_2: state2,
          });
          const logits = outputs.outputs!.data as Float32Array;
          if (logits.length !== this.vocabulary.length + this.model.durationBins)
            throw new Error('Unexpected TDT vocabulary or duration output.');
          const token = argmax(logits, 0, this.vocabulary.length);
          const step = argmax(logits, this.vocabulary.length);
          if (token !== blank) {
            state1.dispose();
            state2.dispose();
            state1 = outputs.output_states_1!;
            state2 = outputs.output_states_2!;
            delete outputs.output_states_1;
            delete outputs.output_states_2;
            previous = token;
            tokens.push({ id: token, frame: t, duration: step });
            emitted++;
          }
          if (step > 0) {
            t += step;
            emitted = 0;
          } else if (token === blank || emitted === 10) {
            t++;
            emitted = 0;
          }
        } finally {
          targets.dispose();
          dispose(outputs);
        }
      }
      return tokens;
    } finally {
      state1.dispose();
      state2.dispose();
      encoder_outputs.dispose();
      target_length.dispose();
    }
  }

  async transcribe(
    audio: Float32Array,
    progress: (p: Progress) => void,
    singleWindow = false,
  ): Promise<Transcript> {
    validateAudio(audio);
    const started = performance.now();
    const words: Word[] = [];
    const chunks = singleWindow
      ? [{ start: 0, end: audio.length, keepStart: 0, keepEnd: audio.length }]
      : audioChunks(audio.length);
    for (const chunk of chunks) {
      const output = await this.chunk(audio.slice(chunk.start, chunk.end));
      for (const word of output) {
        const offset = chunk.start / SAMPLE_RATE;
        const start = word.start + offset,
          end = word.end + offset;
        // A late punctuation token can move a word's end across the boundary.
        // Its acoustic onset determines ownership in both overlapping windows.
        const onset = Math.round(start * SAMPLE_RATE);
        if (onset >= chunk.keepStart && (onset < chunk.keepEnd || chunk.keepEnd === audio.length)) {
          words.push({ text: word.text, start, end });
        }
      }
      progress({
        phase: 'transcribe',
        fraction: chunk.keepEnd / audio.length,
        text: normalizeText(words.map((w) => w.text).join(' ')),
      });
    }
    return {
      text: normalizeText(words.map((w) => w.text).join(' ')),
      words,
      duration: audio.length / SAMPLE_RATE,
      processingSeconds: (performance.now() - started) / 1000,
      model: this.model.repo,
      language: this.model.language,
      revision: this.model.revision,
      quantization: this.quantization,
    };
  }
}
