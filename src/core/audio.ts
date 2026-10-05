export const SAMPLE_RATE = 16000;
export function validateAudio(audio: Float32Array): void {
  if (!(audio instanceof Float32Array) || audio.length < 1600)
    throw new Error('Audio must be at least 0.1 seconds long.');
  for (const sample of audio)
    if (!Number.isFinite(sample) || Math.abs(sample) > 1.01)
      throw new Error('Audio contains invalid samples.');
}
export async function decodeAudio(file: Blob): Promise<Float32Array> {
  if (!file.size) throw new Error('Choose a non-empty audio file.');
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    // Web Audio performs band-limited resampling at the AudioContext's sample rate.
    const pcm = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < pcm.length; i++) pcm[i] = pcm[i]! + data[i]! / buffer.numberOfChannels;
    }
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.max(-1, Math.min(1, pcm[i]!));
    validateAudio(pcm);
    return pcm;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'EncodingError')
      throw new Error('Chrome could not decode this file. Try WAV, MP3, M4A, OGG or WebM.');
    throw error;
  } finally {
    await context.close();
  }
}
export interface Chunk {
  start: number;
  end: number;
  keepStart: number;
  keepEnd: number;
}
/** 30-second owned intervals, 2-second acoustic context on either side. */
export function* audioChunks(length: number): Generator<Chunk> {
  const size = 30 * SAMPLE_RATE,
    context = 2 * SAMPLE_RATE;
  for (let keepStart = 0; keepStart < length; keepStart += size) {
    const keepEnd = Math.min(length, keepStart + size);
    yield {
      start: Math.max(0, keepStart - context),
      end: Math.min(length, keepEnd + context),
      keepStart,
      keepEnd,
    };
  }
}
