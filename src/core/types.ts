export type Quantization = 'int8' | 'int4';
export interface Word {
  text: string;
  start: number;
  end: number;
}
export interface LiveUpdate {
  words: Word[];
  draft: Word[];
  processed: number;
  elapsed: number;
  processingSeconds: number;
}
export interface Transcript {
  text: string;
  words: Word[];
  duration: number;
  processingSeconds: number;
  model: string;
  language?: string;
  revision: string;
  quantization: Quantization;
}
export interface Progress {
  phase: 'download' | 'verify' | 'load' | 'transcribe';
  fraction: number;
  file?: string;
  text?: string;
  duration?: number;
}
export interface LoadOptions {
  modelId?: string;
  quantization?: Quantization;
  threads?: number;
  /** Directory containing the bundled ONNX .mjs and .wasm runtime. */
  runtimeBaseUrl?: string;
  /** Optional self-hosted mirror of the exact pinned model files. Hash verification remains mandatory. */
  modelBaseUrl?: string;
  onProgress?: (progress: Progress) => void;
  signal?: AbortSignal;
}
export type Request =
  | { id: number; type: 'load'; options: Omit<LoadOptions, 'signal' | 'onProgress'> }
  | { id: number; type: 'transcribe'; audio: Float32Array }
  | { id: number; type: 'window'; audio: Float32Array }
  | { id: number; type: 'clear' };
export type Response =
  | { id: number; type: 'progress'; progress: Progress }
  | { id: number; type: 'done'; result?: Transcript }
  | { id: number; type: 'error'; message: string };
