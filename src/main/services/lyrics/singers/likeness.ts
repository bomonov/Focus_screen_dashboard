// How alike two lines are, shared by main (matching a coding onto the lyrics) and the editor.
// No imports: the renderer compiles this.

/** Two lines this alike are the same line, edited. */
export const ALIKE = 0.5

/** 0–1: the letters both have in order (spaces aside), against both lengths. */
export function likeness(a: string, b: string): number {
  const left = Array.from(a.replace(/\s+/g, ''))
  const right = Array.from(b.replace(/\s+/g, ''))
  if (left.length + right.length === 0) return 0
  let above = new Array<number>(right.length + 1).fill(0)
  for (const letter of left) {
    const row = [0]
    right.forEach((other, j) => {
      row.push(letter === other ? (above[j] ?? 0) + 1 : Math.max(above[j + 1] ?? 0, row[j] ?? 0))
    })
    above = row
  }
  return (2 * (above[right.length] ?? 0)) / (left.length + right.length)
}

/**
 * Left and right items alike enough (≥ ALIKE), paired in order, each once, with the most
 * likeness in all: left index → right index.
 */
export function alikePairs(left: readonly string[], right: readonly string[]): Map<number, number> {
  const like = (i: number, j: number): number => likeness(left[i] ?? '', right[j] ?? '')
  // best[i][j]: the most likeness pairing left items from i and right items from j can have.
  const best = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0)
  )
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      const here = best[i]
      if (!here) continue
      const paired = like(i, j) >= ALIKE ? like(i, j) + (best[i + 1]?.[j + 1] ?? 0) : 0
      here[j] = Math.max(best[i + 1]?.[j] ?? 0, here[j + 1] ?? 0, paired)
    }
  }
  const pairs = new Map<number, number>()
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    const score = best[i]?.[j] ?? 0
    if (score === 0) break
    if (like(i, j) >= ALIKE && score === like(i, j) + (best[i + 1]?.[j + 1] ?? 0)) {
      pairs.set(i, j)
      i++
      j++
    } else if (score === (best[i + 1]?.[j] ?? 0)) {
      i++
    } else {
      j++
    }
  }
  return pairs
}
