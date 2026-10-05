import type { Word } from './types.ts';
export interface Token {
  id: number;
  frame: number;
  duration: number;
}
export function parseVocabulary(text: string): string[] {
  const vocabulary: string[] = [];
  for (const line of text.trim().split(/\r?\n/u)) {
    const match = /^(.*) (\d+)$/u.exec(line);
    if (!match || !match[1]) throw new Error('Invalid vocabulary.');
    const id = Number(match[2]);
    if (id > 100000 || vocabulary[id] !== undefined) throw new Error('Invalid token ID.');
    vocabulary[id] = match[1];
  }
  if (Array.from(vocabulary).some((v) => !v) || vocabulary.at(-1) !== '<blk>')
    throw new Error('Vocabulary is missing a valid blank token.');
  return vocabulary;
}
export function normalizeText(text: string): string {
  return text
    .replaceAll('▁', ' ')
    .replace(/\s+([,.;:!?%)}\]])/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
}
export function tokensToWords(tokens: Token[], vocabulary: string[], duration: number): Word[] {
  const words: Word[] = [];
  let current: Word | undefined;
  for (const token of tokens) {
    const piece = vocabulary[token.id];
    if (!piece || piece === '<blk>') continue;
    const start = Math.min(duration, token.frame * 0.08);
    const end = Math.min(duration, Math.max(start + 0.08, (token.frame + token.duration) * 0.08));
    if (!current || piece.startsWith('▁')) {
      const text = normalizeText(piece);
      if (!text) {
        current = undefined;
        continue;
      }
      if (/^[,.;:!?%)}\]]+$/u.test(text) && words.length) {
        words.at(-1)!.text += text;
        words.at(-1)!.end = end;
        current = undefined;
      } else {
        current = { text, start, end };
        words.push(current);
      }
    } else {
      current.text += piece;
      current.end = end;
    }
  }
  return words;
}
export function argmax(values: ArrayLike<number>, start = 0, end = values.length): number {
  if (start >= end) throw new Error('Empty model output.');
  let best = start;
  for (let i = start; i < end; i++) {
    if (!Number.isFinite(values[i])) throw new Error('Model output contains invalid values.');
    if (values[i]! > values[best]!) best = i;
  }
  return best - start;
}
