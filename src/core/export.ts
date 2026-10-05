import type { Transcript, Word } from './types.ts';
function timestamp(seconds: number, separator: string): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${separator}${String(ms % 1000).padStart(3, '0')}`;
}
function cues(words: Word[]): { text: string; start: number; end: number }[] {
  const result: { text: string; start: number; end: number }[] = [];
  let current: { text: string; start: number; end: number } | undefined;
  for (const word of words) {
    if (
      !current ||
      current.text.length + word.text.length > 72 ||
      word.end - current.start > 6 ||
      word.start - current.end > 1
    ) {
      current = { ...word };
      result.push(current);
    } else {
      current.text += ` ${word.text}`;
      current.end = word.end;
    }
  }
  for (let i = 0; i < result.length; i++) {
    const cue = result[i]!;
    cue.end = Math.max(cue.start + 0.001, Math.min(cue.end, result[i + 1]?.start ?? Infinity));
  }
  return result;
}
export function subtitles(transcript: Transcript, format: 'srt' | 'vtt'): string {
  const separator = format === 'srt' ? ',' : '.';
  return (
    (format === 'vtt' ? 'WEBVTT\n\n' : '') +
    cues(transcript.words)
      .map((cue, i) => {
        const text = cue.text.replaceAll('-->', '→');
        const payload =
          format === 'vtt'
            ? text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
            : text;
        return `${format === 'srt' ? `${i + 1}\n` : ''}${timestamp(cue.start, separator)} --> ${timestamp(cue.end, separator)}\n${payload}\n`;
      })
      .join('\n')
  );
}
export function exportTranscript(
  result: Transcript,
  format: 'txt' | 'json' | 'srt' | 'vtt',
): string {
  if (format === 'txt') return `${result.text}\n`;
  if (format === 'json') return JSON.stringify(result, null, 2);
  return subtitles(result, format);
}
