import { Pianissimo, type Progress } from '../core/client.ts';
import { getModel } from '../core/model.ts';
import { LiveTranscriber } from '../core/live.ts';
import { MicrophoneCapture } from './capture.ts';
import { initialState, isBusy, type Command, type SessionState } from './types.ts';
export class SessionController {
  state = initialState();
  private client = new Pianissimo((error) => {
    // Live capture can be waiting for permission or between inference windows.
    // Release the microphone immediately even when no request is pending.
    if (['requesting-mic', 'recording'].includes(this.state.phase)) {
      this.generation++;
      this.capture?.cancel();
      this.live?.cancel();
      this.capture = undefined;
      this.live = undefined;
      this.fail(error, this.generation);
      return;
    }
    // Other pending operations handle their own rejection.
    if (!isBusy(this.state.phase)) this.fail(error, this.generation);
  });
  private generation = 0;
  private captureOwner?: string;
  private capture?: MicrophoneCapture;
  private live?: LiveTranscriber;
  private listeners = new Set<(state: SessionState) => void>();
  subscribe(listener: (state: SessionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }
  private set(change: Partial<SessionState>) {
    this.state = { ...this.state, ...change, version: this.state.version + 1 };
    for (const listener of this.listeners) listener(this.state);
  }
  private fail(error: unknown, generation: number) {
    if (
      generation !== this.generation ||
      (error instanceof DOMException && error.name === 'AbortError')
    )
      return;
    this.captureOwner = undefined;
    const needsPermission =
      error instanceof DOMException &&
      (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError');
    const message = needsPermission
      ? 'Allow microphone access to record.'
      : error instanceof Error
        ? error.message
        : String(error);
    this.set({
      phase: this.client.isLoaded ? 'ready' : 'idle',
      loaded: this.client.isLoaded,
      error: message,
      needsPermission,
      progress: null,
      level: 0,
      status: 'Stopped.',
    });
  }
  private progress = (generation: number) => (progress: Progress) => {
    if (generation !== this.generation) return;
    const percent = Math.round(progress.fraction * 100);
    const status =
      progress.phase === 'download'
        ? `Downloading model · ${percent}%`
        : progress.phase === 'verify'
          ? `Checking model · ${percent}%`
          : progress.phase === 'load'
            ? 'Loading model…'
            : `Transcribing · ${percent}%`;
    this.set({
      status,
      progress: progress.phase === 'load' ? null : progress.fraction,
      ...(progress.duration === undefined
        ? {}
        : { elapsed: progress.duration, phase: 'transcribing' as const }),
      ...(progress.text === undefined ? {} : { draft: progress.text }),
    });
  };
  command(command: Command): void {
    if (command.type === 'snapshot') return;
    if (command.type === 'cancel') {
      this.cancel();
      return;
    }
    if (command.type === 'stop') {
      if (this.state.phase === 'recording') void this.stop();
      return;
    }
    if (isBusy(this.state.phase)) throw new Error('Another operation is in progress.');
    if (command.type === 'select-model') {
      const model = getModel(command.modelId);
      if (model.id === this.state.modelId) return;
      this.client.dispose();
      this.set({
        modelId: model.id,
        quantization: model.quantizations.includes(this.state.quantization)
          ? this.state.quantization
          : 'int8',
        loaded: false,
        phase: 'idle',
        error: '',
        needsPermission: false,
        status: 'Load a model to begin.',
      });
      return;
    }
    if (command.type === 'load') {
      getModel(command.modelId).assets(command.quantization);
      if (!['int8', 'int4'].includes(command.quantization))
        throw new Error('Unknown model variant.');
      if (this.client.isLoaded) throw new Error('Unload the current model first.');
      void this.load(command);
      return;
    }
    if (command.type === 'unload') {
      this.client.dispose();
      this.set({ loaded: false, phase: 'idle', status: 'Model unloaded.', error: '' });
      return;
    }
    if (command.type === 'clear-cache') {
      void this.clearCache();
      return;
    }
    if (command.type === 'reset') {
      this.set({
        result: undefined,
        committed: '',
        draft: '',
        fileName: '',
        elapsed: 0,
        error: '',
        status: this.client.isLoaded ? 'Ready.' : 'Load a model to begin.',
      });
      return;
    }
    if (!this.client.isLoaded) throw new Error('Load a model first.');
    if (command.type === 'start') {
      void this.start();
      return;
    }
    if (command.type !== 'file') throw new Error('Unknown operation.');
    if (!(command.file instanceof File) || !command.file.size)
      throw new Error('Choose a non-empty audio file.');
    void this.file(command.file);
  }
  private async load(command: Extract<Command, { type: 'load' }>) {
    const generation = ++this.generation;
    this.set({
      phase: 'loading',
      status: 'Preparing model…',
      error: '',
      needsPermission: false,
      progress: 0,
      modelId: command.modelId,
      quantization: command.quantization,
    });
    try {
      await this.client.load({
        modelId: command.modelId,
        quantization: command.quantization,
        runtimeBaseUrl: new URL('./runtime/', location.href).href,
        onProgress: this.progress(generation),
      });
      if (generation === this.generation)
        this.set({ phase: 'ready', loaded: true, status: 'Ready.', progress: null });
    } catch (error) {
      this.fail(error, generation);
    }
  }
  private async clearCache() {
    const generation = ++this.generation;
    this.set({
      phase: 'clearing',
      loaded: false,
      status: 'Deleting downloaded models…',
      error: '',
    });
    try {
      await this.client.clearCache();
      if (generation === this.generation)
        this.set({ phase: 'idle', status: 'Downloaded models deleted.', progress: null });
    } catch (error) {
      this.fail(error, generation);
    }
  }
  private async file(file: File) {
    const generation = ++this.generation;
    this.set({
      phase: 'decoding',
      source: 'file',
      status: 'Reading audio…',
      error: '',
      result: undefined,
      committed: '',
      draft: '',
      fileName: file.name,
      progress: null,
      elapsed: 0,
    });
    try {
      const result = await this.client.transcribeFile(file, {
        onProgress: this.progress(generation),
      });
      if (generation === this.generation)
        this.set({
          phase: 'ready',
          result,
          committed: result.text,
          draft: '',
          progress: null,
          status: result.text ? 'Done.' : 'No speech detected.',
        });
    } catch (error) {
      this.fail(error, generation);
    }
  }
  ownsCapture(owner: string): boolean {
    return this.captureOwner === owner;
  }
  startAnchored(owner: string) {
    if (isBusy(this.state.phase)) throw new Error('Another operation is in progress.');
    if (!this.client.isLoaded) throw new Error('Load a model first.');
    void this.start(owner);
  }
  stopAnchored(owner: string) {
    if (this.ownsCapture(owner)) void this.stop();
  }
  private async start(owner?: string) {
    const generation = ++this.generation;
    this.captureOwner = owner;
    this.set({
      phase: 'requesting-mic',
      source: 'live',
      status: 'Opening microphone…',
      error: '',
      needsPermission: false,
      result: undefined,
      committed: '',
      draft: '',
      fileName: 'Recording',
      elapsed: 0,
      lag: 0,
      level: 0,
    });
    const capture = new MicrophoneCapture();
    this.capture = capture;
    const live = new LiveTranscriber(
      (audio) => this.client.transcribe(audio),
      (update) => {
        if (generation !== this.generation) return;
        this.set({
          committed: update.words.map((w) => w.text).join(' '),
          draft: update.draft.map((w) => w.text).join(' '),
          lag: Math.max(0, this.state.elapsed - update.processed),
        });
      },
      (error) => {
        if (generation === this.generation && this.state.phase === 'recording')
          void this.stop(error.message);
      },
    );
    this.live = live;
    let samples = 0;
    try {
      await capture.start(
        (audio) => {
          if (generation !== this.generation) return;
          samples += audio.length;
          let peak = 0;
          for (const sample of audio) peak = Math.max(peak, Math.abs(sample));
          this.set({
            elapsed: samples / 16000,
            lag: this.state.lag + audio.length / 16000,
            level: Math.min(1, peak * 3),
          });
          live.push(audio);
        },
        (error) => {
          if (generation === this.generation) void this.stop(error.message);
        },
      );
      if (generation !== this.generation) {
        capture.cancel();
        live.cancel();
        return;
      }
      if (this.state.phase !== 'requesting-mic') return;
      this.set({ phase: 'recording', status: 'Recording' });
    } catch (error) {
      capture.cancel();
      live.cancel();
      this.fail(error, generation);
    }
  }
  private async stop(reason = '') {
    if (!['recording', 'requesting-mic'].includes(this.state.phase)) return;
    const generation = this.generation;
    const capture = this.capture,
      live = this.live;
    this.set({ phase: 'stopping', status: 'Finishing…', error: reason });
    try {
      const captureError = await capture?.stop().then(
        () => undefined,
        (error) => error as Error,
      );
      if (generation !== this.generation) return;
      const result = await live?.finish();
      if (generation !== this.generation) return;
      this.capture = undefined;
      this.live = undefined;
      this.captureOwner = undefined;
      this.set({
        phase: 'ready',
        result,
        committed: result?.text ?? '',
        draft: '',
        level: 0,
        elapsed: result?.duration ?? this.state.elapsed,
        error: captureError?.message ?? reason,
        status: result?.text ? 'Done.' : 'No speech detected.',
      });
    } catch (error) {
      capture?.cancel();
      live?.cancel();
      this.fail(error, generation);
    }
  }
  cancel() {
    this.generation++;
    this.capture?.cancel();
    this.live?.cancel();
    this.client.dispose();
    this.captureOwner = undefined;
    this.capture = undefined;
    this.live = undefined;
    this.set({
      phase: 'idle',
      loaded: false,
      needsPermission: false,
      level: 0,
      progress: null,
      error: '',
      status: 'Cancelled. Reload the model to continue.',
    });
  }
}
