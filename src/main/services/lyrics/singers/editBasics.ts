import type { CodedLine, CodedWord, ColorEdit, SingerRef, SongColors } from './types'

// What the editor's steps (`edit.ts`, `addedEdits.ts`) share: checks on what the page sent,
// which is untrusted, equality all the way down, one line swapped, and a shown line made a
// coded one with its singers kept.

export type Edit<K extends ColorEdit['kind']> = Extract<ColorEdit, { kind: K }>

export function isIndex(value: unknown, length: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < length
}

export function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Equal all the way down. Untouched lines are the same objects, so this skips most of a song. */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item: unknown, index) => same(item, b[index]))
  }
  const left = Object.entries(a)
  const right = b as Record<string, unknown>
  if (left.length !== Object.keys(right).length) return false
  return left.every(([key, value]) => key in right && same(value, right[key]))
}

export function withLine(colors: SongColors, index: number, line: CodedLine): SongColors {
  return { ...colors, lines: colors.lines.map((old, i) => (i === index ? line : old)) }
}

export function copySingers(singers: SingerRef | null): SingerRef | null {
  return singers === null || singers === 'everyone' ? singers : [...singers]
}

/**
 * A shown line as a coded one, nobody given anything; null unless its words spell out its
 * text and its times are times. Words are pulled onto the line the way the parser pulls them.
 */
export function fromShown(raw: unknown): CodedLine | null {
  if (!isRecord(raw)) return null
  const { text, start, end, words } = raw
  if (typeof text !== 'string' || text.trim() === '' || !Array.isArray(words)) return null
  if (!isTime(start) || !isTime(end) || start < 0 || end < start) return null
  const coded: CodedWord[] = []
  let notBefore = start
  for (const item of words as unknown[]) {
    if (!isRecord(item) || typeof item.text !== 'string') return null
    if (!isTime(item.start) || !isTime(item.end)) return null
    const from = Math.min(Math.max(item.start, notBefore), end)
    coded.push({
      text: item.text,
      start: from,
      end: Math.min(Math.max(item.end, from), end),
      singers: null
    })
    notBefore = from
  }
  if (coded.length === 0 || coded.map((word) => word.text).join('') !== text) return null
  const marks =
    raw.timed === true
      ? { timed: true as const }
      : raw.guessed === true
        ? { guessed: true as const }
        : {}
  return { text, start, end, words: coded, ...marks }
}

/**
 * Each new word takes the singers of an old word with the same text, matched in order (the
 * longest run of words both have), so a fixed typo keeps the rest of the line's colors.
 */
export function keptSingers(old: readonly CodedWord[], fresh: readonly CodedWord[]): CodedWord[] {
  const same = (a: CodedWord | undefined, b: CodedWord | undefined): boolean =>
    a !== undefined && b !== undefined && a.text.trim() === b.text.trim()
  // best[i][j]: how many words match among old from i and fresh from j.
  const best = Array.from({ length: old.length + 1 }, () => new Int32Array(fresh.length + 1))
  for (let i = old.length - 1; i >= 0; i--) {
    for (let j = fresh.length - 1; j >= 0; j--) {
      const below = best[i + 1]
      const here = best[i]
      if (!below || !here) continue
      here[j] = same(old[i], fresh[j])
        ? (below[j + 1] ?? 0) + 1
        : Math.max(below[j] ?? 0, here[j + 1] ?? 0)
    }
  }
  const kept = fresh.map((word) => ({ ...word }))
  let i = 0
  let j = 0
  while (i < old.length && j < fresh.length) {
    const word = kept[j]
    if (same(old[i], fresh[j]) && word) {
      word.singers = copySingers(old[i]?.singers ?? null)
      i++
      j++
    } else if ((best[i + 1]?.[j] ?? 0) >= (best[i]?.[j + 1] ?? 0)) {
      i++
    } else {
      j++
    }
  }
  return kept
}
