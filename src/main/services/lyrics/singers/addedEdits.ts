import { MAX_ADDED_CHARS, MAX_ADDED_LINES } from './added'
import {
  fromShown,
  isIndex,
  isRecord,
  isTime,
  keptSingers,
  withLine,
  type Edit
} from './editBasics'
import type { CodedLine, CodedWord, SongColors } from './types'

// The steps for lines the user adds (`addLines`, `retype`, `removeLine`, `moveLine`) and for the
// times a "Time by listening" run heard (`heardTimes`, which only main makes). `edit.ts` runs
// them as it runs every step: pure, a coding in and a new one out, and the same object back
// when the edit can't be made.

/** An added line from the page's shown line: its text is within the limits, nobody sings it, its times are a guess. */
function fromAdded(raw: unknown): CodedLine | null {
  const coded = fromShown(raw)
  if (!coded || Array.from(coded.text).length > MAX_ADDED_CHARS) return null
  delete coded.timed
  return { ...coded, added: true, guessed: true }
}

export function addLines(colors: SongColors, edit: Edit<'addLines'>): SongColors {
  const { at } = edit
  if (!Number.isInteger(at) || at < 0 || at > colors.lines.length) return colors
  if (colors.lines[at]?.under !== undefined) return colors
  if (!Array.isArray(edit.lines) || edit.lines.length === 0) return colors
  if (edit.lines.length > MAX_ADDED_LINES) return colors
  const fresh: CodedLine[] = []
  for (const raw of edit.lines as unknown[]) {
    const one = fromAdded(raw)
    if (!one) return colors
    fresh.push(one)
  }
  const later = colors.lines
    .slice(at)
    .map((line) =>
      line.under !== undefined && line.under >= at
        ? { ...line, under: line.under + fresh.length }
        : line
    )
  return { ...colors, lines: [...colors.lines.slice(0, at), ...fresh, ...later] }
}

/** A music break: an added main line with nothing sung, from `start` to `end`, at `at`. */
export function addBreak(colors: SongColors, edit: Edit<'addBreak'>): SongColors {
  const { at, start, end } = edit
  if (!Number.isInteger(at) || at < 0 || at > colors.lines.length) return colors
  if (colors.lines[at]?.under !== undefined) return colors
  if (!isTime(start) || !isTime(end) || start < 0 || end <= start) return colors
  const fresh: CodedLine = {
    text: '',
    start,
    end,
    words: [],
    added: true,
    guessed: true,
    instrumental: true
  }
  const later = colors.lines
    .slice(at)
    .map((line) =>
      line.under !== undefined && line.under >= at ? { ...line, under: line.under + 1 } : line
    )
  return { ...colors, lines: [...colors.lines.slice(0, at), fresh, ...later] }
}

/** The added main line at `index`, or undefined. */
function addedAt(colors: SongColors, index: unknown): CodedLine | undefined {
  const target = isIndex(index, colors.lines.length) ? colors.lines[index] : undefined
  return target && target.under === undefined && target.added ? target : undefined
}

/** Spans carry no more than their times; `scaled` keeps whatever else a word has. */
export function scaled<T extends { start: number; end: number }>(
  items: readonly T[],
  from: { start: number; end: number },
  to: { start: number; end: number }
): T[] {
  const span = from.end - from.start
  const width = to.end - to.start
  return items.map((item, i) =>
    span > 0
      ? {
          ...item,
          start: to.start + ((item.start - from.start) * width) / span,
          end: to.start + ((item.end - from.start) * width) / span
        }
      : {
          ...item,
          start: to.start + (width * i) / items.length,
          end: to.start + (width * (i + 1)) / items.length
        }
  )
}

export function retype(colors: SongColors, edit: Edit<'retype'>): SongColors {
  const target = addedAt(colors, edit.line)
  const shown: unknown = edit.shown
  // A break has no words to change.
  if (!target || target.instrumental || !isRecord(shown) || !Array.isArray(shown.words)) {
    return colors
  }
  const { start, end } = shown
  if (!isTime(start) || !isTime(end) || start < 0 || end < start) return colors
  const given: { start: number; end: number }[] = []
  for (const item of shown.words as unknown[]) {
    if (!isRecord(item) || !isTime(item.start) || !isTime(item.end)) return colors
    given.push({ start: item.start, end: item.end })
  }
  // The words are spread over the line's own span: its times stay where they are.
  const placed = scaled(given, { start, end }, target).map((time, i) => ({
    ...(shown.words as Record<string, unknown>[])[i],
    ...time
  }))
  const fresh = fromAdded({ ...shown, start: target.start, end: target.end, words: placed })
  if (!fresh) return colors
  const next: CodedLine = {
    ...target,
    text: fresh.text,
    words: keptSingers(target.words, fresh.words)
  }
  delete next.romajiSplits
  return withLine(colors, edit.line, next)
}

/** The lines rearranged: `order` lists old places in their new order; second voices are re-pointed. */
export function reordered(colors: SongColors, order: readonly number[]): SongColors {
  const placed = new Map(order.map((old, now) => [old, now]))
  const lines = order.map((old) => {
    const line = colors.lines[old]
    if (!line) throw new Error('reordered: no such line')
    if (line.under === undefined) return line
    return { ...line, under: placed.get(line.under) ?? line.under }
  })
  return { ...colors, lines }
}

/** The places of a main line and the voices right under it. */
export function blockAt(colors: SongColors, main: number): number[] {
  const block = [main]
  for (let i = main + 1; colors.lines[i]?.under === main; i++) block.push(i)
  return block
}

/** Every second voice of `main` is in its block: the lines next to it. */
export function voicesInBlock(colors: SongColors, main: number): boolean {
  const owned = colors.lines.filter((line) => line.under === main).length
  return owned === blockAt(colors, main).length - 1
}

export function removeLine(colors: SongColors, edit: Edit<'removeLine'>): SongColors {
  if (!addedAt(colors, edit.line) || !voicesInBlock(colors, edit.line)) return colors
  const gone = new Set(blockAt(colors, edit.line))
  const kept = colors.lines.map((_, i) => i).filter((i) => !gone.has(i))
  return reordered(colors, kept)
}

/** The moved line on `[start, end]`, each word keeping its share; its voices keep their distance from its start. */
function retimed(
  moved: CodedLine,
  voices: CodedLine[],
  start: number,
  end: number
): [CodedLine, CodedLine[]] {
  const words = scaled(moved.words, moved, { start, end })
  const line: CodedLine = { ...moved, start, end, words, guessed: true }
  delete line.timed
  const voiced = voices.map((voice) => {
    // Never before 0: the voice is held at the song's start, its length kept.
    const by = Math.max(start - moved.start, -voice.start)
    // Its times now come from a guess, so it's a guess too.
    const shifted: CodedLine = {
      ...voice,
      start: voice.start + by,
      end: voice.end + by,
      words: voice.words.map((word) => ({ ...word, start: word.start + by, end: word.end + by })),
      guessed: true
    }
    delete shifted.timed
    return shifted
  })
  return [line, voiced]
}

export function moveLine(colors: SongColors, edit: Edit<'moveLine'>): SongColors {
  const moved = addedAt(colors, edit.line)
  if (!moved || (edit.delta !== -1 && edit.delta !== 1)) return colors
  const { start, end } = edit
  const timed = start !== undefined || end !== undefined
  if (timed) {
    if (!isTime(start) || !isTime(end) || start < 0 || start >= end) return colors
  }

  if (!voicesInBlock(colors, edit.line)) return colors
  const mine = blockAt(colors, edit.line)
  let order: number[]
  if (edit.delta < 0) {
    const before = colors.lines[edit.line - 1]
    if (!before) return colors
    const first = before.under ?? edit.line - 1
    const other = blockAt(colors, first)
    order = [...colors.lines.keys()].filter((i) => i < first)
    order.push(...mine, ...other)
    order.push(...[...colors.lines.keys()].filter((i) => i > edit.line + mine.length - 1))
  } else {
    const next = (mine[mine.length - 1] ?? edit.line) + 1
    if (!colors.lines[next]) return colors
    const other = blockAt(colors, next)
    order = [...colors.lines.keys()].filter((i) => i < edit.line)
    order.push(...other, ...mine)
    order.push(...[...colors.lines.keys()].filter((i) => i > (other[other.length - 1] ?? next)))
  }
  // A voice away from its main line would be dropped or left behind: leave such a song alone.
  if (order.length !== colors.lines.length) return colors
  let result = reordered(colors, order)
  if (!timed || start === undefined || end === undefined) return result

  const at = order.indexOf(edit.line)
  const voiceAt = (): number[] =>
    order
      .map((old, now) => (colors.lines[old]?.under === edit.line ? now : -1))
      .filter((n) => n >= 0)
  const voicePlaces = voiceAt()
  const voices = voicePlaces.map((place) => result.lines[place]).filter((v): v is CodedLine => !!v)
  const [line, voiced] = retimed(moved, voices, start, end)
  const lines = result.lines.map((one, i) => {
    if (i === at) return line
    const v = voicePlaces.indexOf(i)
    return v >= 0 ? (voiced[v] ?? one) : one
  })
  result = { ...result, lines }
  return result
}

/**
 * Each entry's line on the times a run heard, in song time as given (like a tap's), its words
 * pulled onto it in order the way the parser pulls them. Its start is set, so it's `timed` and
 * no longer a guess; who sings stays. An entry that doesn't fit its line is skipped.
 */
export function heardTimes(colors: SongColors, edit: Edit<'heardTimes'>): SongColors {
  if (!Array.isArray(edit.lines)) return colors
  const lines = [...colors.lines]
  let changed = false
  for (const raw of edit.lines as unknown[]) {
    if (!isRecord(raw)) continue
    const { line: index, start, end, words } = raw
    if (!isIndex(index, lines.length)) continue
    const target = lines[index]
    if (!target || !isTime(start) || !isTime(end) || start < 0 || end <= start) continue
    if (!Array.isArray(words) || words.length !== target.words.length) continue
    const placed: CodedWord[] = []
    let notBefore = start
    for (const [i, item] of (words as unknown[]).entries()) {
      const old = target.words[i]
      if (!old || !isRecord(item) || !isTime(item.start) || !isTime(item.end)) break
      const from = Math.min(Math.max(item.start, notBefore), end)
      placed.push({ ...old, start: from, end: Math.min(Math.max(item.end, from), end) })
      notBefore = from
    }
    if (placed.length !== target.words.length) continue
    const line: CodedLine = { ...target, start, end, words: placed, timed: true }
    delete line.guessed
    lines[index] = line
    changed = true
  }
  return changed ? { ...colors, lines } : colors
}
