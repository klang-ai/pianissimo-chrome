import {
  Input,
  BlobSource,
  AudioSampleSink,
  MP4,
  QTFF,
  MATROSKA,
  WEBM,
  OGG,
  MP3,
  WAVE,
  FLAC,
  ADTS,
  type AudioSample,
} from 'mediabunny';
import { audioChunks, SAMPLE_RATE, type Chunk } from './audio.ts';

export interface DecodedChunk extends Chunk {
  audio: Float32Array;
  duration: number;
}
/** Decode only a single inference window at a time. No whole-file ArrayBuffer or PCM allocation. */
export async function* decodeAudioChunks(
  file: Blob,
  signal?: AbortSignal,
): AsyncGenerator<DecodedChunk> {
  signal?.throwIfAborted();
  if (!file.size) throw new Error('Choose a non-empty audio file.');
  // Explicit local container formats exclude playlists and remote media sources.
  const input = new Input({
    source: new BlobSource(file, { maxCacheSize: 4 * 1024 * 1024 }),
    formats: [MP4, QTFF, MATROSKA, WEBM, OGG, MP3, WAVE, FLAC, ADTS],
  });
  let iterator: AsyncGenerator<AudioSample, void, unknown> | undefined;
  let sample: AudioSample | undefined;
  const abort = () => input.dispose();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('This file has no audio track.');
    if (!(await track.canDecode()))
      throw new Error(
        'Chrome cannot decode this audio format. Try WAV, MP3, M4A, OGG, WebM or FLAC.',
      );
    const rate = await track.getSampleRate();
    const channels = await track.getNumberOfChannels();
    if (
      !Number.isInteger(rate) ||
      rate < 8000 ||
      rate > 192000 ||
      !Number.isInteger(channels) ||
      channels < 1 ||
      channels > 32
    ) {
      throw new Error('Unsupported audio layout. Use audio with 1–32 channels at 8–192 kHz.');
    }
    const origin = Math.max(0, await track.getFirstTimestamp());
    const duration = (await track.computeDuration()) - origin;
    const length = Math.round(duration * SAMPLE_RATE);
    if (!Number.isSafeInteger(length) || length < 1600)
      throw new Error('Audio must be at least 0.1 seconds long.');
    iterator = new AudioSampleSink(track).samples(origin);
    let carry = new Float32Array(0),
      carryStart = 0;
    for (const chunk of audioChunks(length)) {
      signal?.throwIfAborted();
      const sourceStart = Math.round((chunk.start / SAMPLE_RATE) * rate);
      const sourceEnd = Math.round((chunk.end / SAMPLE_RATE) * rate);
      const mono = new Float32Array(sourceEnd - sourceStart);
      if (carry.length) mono.set(carry, carryStart - sourceStart);
      while (true) {
        sample ??= (await iterator.next()).value ?? undefined;
        if (!sample) break;
        signal?.throwIfAborted();
        if (sample.sampleRate !== rate || sample.numberOfChannels !== channels)
          throw new Error('The audio format changes inside this file.');
        const sampleStart = Math.round((sample.timestamp - origin) * rate);
        if (sampleStart >= sourceEnd) break;
        const offset = sampleStart - sourceStart;
        const from = Math.max(0, -offset),
          to = Math.min(sample.numberOfFrames, mono.length - offset);
        if (to > from) {
          const plane = new Float32Array(to - from),
            mixed = new Float32Array(to - from);
          for (let channel = 0; channel < channels; channel++) {
            sample.copyTo(plane, {
              planeIndex: channel,
              format: 'f32-planar',
              frameOffset: from,
              frameCount: to - from,
            });
            for (let i = 0; i < plane.length; i++) mixed[i]! += plane[i]! / channels;
          }
          mono.set(mixed, offset + from);
        }
        if (sampleStart + sample.numberOfFrames > sourceEnd) break;
        sample.close();
        sample = undefined;
      }
      // Retain only the four seconds shared with the next inference window.
      // One continuous decoder avoids reapplying codec delay on every window.
      carryStart = Math.round(Math.max(0, chunk.keepEnd / SAMPLE_RATE - 2) * rate);
      carry = mono.slice(carryStart - sourceStart);
      signal?.throwIfAborted();
      let audio: Float32Array;
      if (rate === SAMPLE_RATE) audio = mono.subarray(0, chunk.end - chunk.start);
      else {
        // Web Audio's band-limited resampler avoids aliasing when downsampling.
        // Only this window is rendered; acoustic overlap keeps filter edges out of owned text.
        const context = new OfflineAudioContext(1, chunk.end - chunk.start, SAMPLE_RATE);
        const buffer = context.createBuffer(1, mono.length, rate);
        buffer.copyToChannel(mono, 0);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.start();
        try {
          audio = (await context.startRendering()).getChannelData(0);
        } finally {
          source.disconnect();
          source.buffer = null;
        }
      }
      signal?.throwIfAborted();
      for (let i = 0; i < audio.length; i++) audio[i] = Math.max(-1, Math.min(1, audio[i]!));
      yield { ...chunk, audio, duration: length / SAMPLE_RATE };
    }
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    sample?.close();
    input.dispose();
    await iterator?.return().catch(() => {});
  }
}
