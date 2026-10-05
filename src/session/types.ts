import type { Quantization, Transcript } from '../core/types.ts';
export type Phase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'decoding'
  | 'transcribing'
  | 'requesting-mic'
  | 'recording'
  | 'stopping'
  | 'clearing';
export interface SessionState {
  instance: string;
  version: number;
  phase: Phase;
  source: 'live' | 'file';
  modelId: string;
  quantization: Quantization;
  loaded: boolean;
  status: string;
  error: string;
  needsPermission: boolean;
  progress: number | null;
  committed: string;
  draft: string;
  result?: Transcript;
  fileName: string;
  elapsed: number;
  level: number;
  lag: number;
}
export type Command =
  | { type: 'snapshot' }
  | { type: 'select-model'; modelId: string }
  | { type: 'load'; modelId: string; quantization: Quantization }
  | { type: 'unload' | 'clear-cache' | 'cancel' | 'start' | 'stop' | 'reset' }
  | { type: 'file'; file: File };
export interface SessionConnection {
  command(command: Command): Promise<void>;
  close(): void;
}
export const BUS = 'pianissimo-session-v2';
export function initialState(): SessionState {
  return {
    instance: crypto.randomUUID(),
    version: 0,
    phase: 'idle',
    source: 'live',
    modelId: 'pianissimo-sv',
    quantization: 'int8',
    loaded: false,
    status: 'Load a model to begin.',
    error: '',
    needsPermission: false,
    progress: null,
    committed: '',
    draft: '',
    fileName: '',
    elapsed: 0,
    level: 0,
    lag: 0,
  };
}
export const isBusy = (phase: Phase) => !['idle', 'ready'].includes(phase);
