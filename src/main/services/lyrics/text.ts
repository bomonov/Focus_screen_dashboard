// Text comparison for matching song metadata across players and LRCLIB.

/** Lowercase letters and digits only, accents dropped, "&" read as "and". Works for any script. */
export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function bigrams(text: string): Map<string, number> {
  const compact = text.replace(/ /g, '')
  const counts = new Map<string, number>()
  if (compact.length === 1) counts.set(compact, 1)
  for (let i = 0; i < compact.length - 1; i++) {
    const pair = compact.slice(i, i + 2)
    counts.set(pair, (counts.get(pair) ?? 0) + 1)
  }
  return counts
}

/** How alike two normalized strings are, 0–1 (Sørensen–Dice over character pairs). */
export function similarity(a: string, b: string): number {
  if (a === b) return a === '' ? 0 : 1
  const left = bigrams(a)
  const right = bigrams(b)
  let total = 0
  let shared = 0
  for (const count of left.values()) total += count
  for (const [pair, count] of right) {
    total += count
    shared += Math.min(count, left.get(pair) ?? 0)
  }
  return total === 0 ? 0 : (2 * shared) / total
}

/** "A, B & C" → ["A", "B", "C"]. Also splits "feat."; "and" isn't split ("Florence and the Machine"). */
export function splitArtists(artist: string): string[] {
  return artist
    .split(/\s*,\s*|\s+&\s+|\s+(?:feat\.?|ft\.?|featuring|with|x|×)\s+/i)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}
