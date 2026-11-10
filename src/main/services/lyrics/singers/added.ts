// Limits on the lines a user adds to a song's coding, and which shown lines they stand in for.
// Imports only types and likeness.ts: the renderer compiles this.
import { alikePairs } from './likeness'
import type { SongColors } from './types'

/** Most lines one "＋ Add lines" can bring. */
export const MAX_ADDED_LINES = 40
/** Longest an added line can be, in whole characters. */
export const MAX_ADDED_CHARS = 200

/**
 * Added lines that stand in for a shown line: an added main line no shown line matches exactly,
 * paired (alikePairs) with an unmatched, non-blank shown line between the same two matched
 * lines. Coded line → shown row. `matches` is `matchLines`' answer (row → coded line); the
 * caller hands it in so this file never imports apply.ts.
 */
export function standIns(
  texts: readonly string[],
  coding: SongColors,
  matches: readonly (number | undefined)[]
): Map<number, number> {
  const anchors = [
    { row: -1, index: -1 },
    ...matches.flatMap((index, row) => (index === undefined ? [] : [{ row, index }])),
    { row: texts.length, index: coding.lines.length }
  ]
  const result = new Map<number, number>()
  anchors.slice(1).forEach((after, k) => {
    const before = anchors[k]
    if (!before) return
    const lines: number[] = []
    for (let index = before.index + 1; index < after.index; index++) {
      const line = coding.lines[index]
      // A break has no words to be like a shown line by.
      if (line?.added && line.under === undefined && !line.instrumental) lines.push(index)
    }
    const rows: number[] = []
    for (let row = before.row + 1; row < after.row; row++) {
      if ((texts[row] ?? '').trim() !== '' && matches[row] === undefined) rows.push(row)
    }
    const pairs = alikePairs(
      lines.map((index) => coding.lines[index]?.text ?? ''),
      rows.map((row) => texts[row] ?? '')
    )
    for (const [i, j] of pairs) {
      const index = lines[i]
      const row = rows[j]
      if (index !== undefined && row !== undefined) result.set(index, row)
    }
  })
  return result
}
