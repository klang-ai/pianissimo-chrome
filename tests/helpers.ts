export const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
export function wordDistance(reference: string, hypothesis: string): number {
  const a = normalize(reference).split(' ').filter(Boolean),
    b = normalize(hypothesis).split(' ').filter(Boolean);
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        previous[j]! + 1,
        next[j - 1]! + 1,
        previous[j - 1]! + Number(a[i - 1] !== b[j - 1]),
      );
    previous = next;
  }
  return previous[b.length]!;
}
