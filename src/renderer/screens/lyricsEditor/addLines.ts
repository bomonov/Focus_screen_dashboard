// Lines the user adds to a song's coding, on the editor's page: a paste cleaned into lines,
// where they go, their guessed times and words, an added line's new span and place when it's
// moved, and its words retyped. Times are on the screen's clock: song position plus the song's
// timing fix, as the Focus Screen lights them (R15). Pure.
import type { CodedLine, ShownLine, SongColors } from '../../../main/ipc'
import { MAX_ADDED_CHARS, MAX_ADDED_LINES } from '../../../main/services/lyrics/singers/added'
import {
  MIN_SEC_PER_ADDED_LINE,
  realSpans,
  type OwnLyrics
} from '../../../main/services/lyrics/singers/listen'
import { estimateWords } from '../../widgets/music/lyricsGlide'
import { codedLine } from './editorView'
import { lineRun } from './selection'

export const ADD_SPAN_SEC = 30
/** The gap a moved line leaves after the line before it (R13). */
export const MOVE_GAP_SEC = 0.1

interface Span {
  start: number
  end: number
}

/**
 * A paste as lines: split on any line break, each trimmed, blanks dropped; the problem, if it's
 * too much. A paste is added whole or not at all, so with a problem there are no lines.
 */
export function pastedLines(text: string): { lines: string[]; problem: string | null } {
  const lines = text
    .split(/\r\n|[\n\r\v\f\u0085\u2028\u2029]/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  if (lines.length > MAX_ADDED_LINES) {
    return { lines: [], problem: `Up to ${MAX_ADDED_LINES} lines at a time.` }
  }
  // Whole characters, as main counts them: a line of emoji isn't counted double.
  if (lines.some((line) => Array.from(line).length > MAX_ADDED_CHARS)) {
    return { lines: [], problem: `A line can be at most ${MAX_ADDED_CHARS} characters.` }
  }
  return { lines, problem: null }
}

/**
 * Where each coded line shows, for placing lines among them: its real span (realSpans, R14),
 * and in synced lyrics an added main line's own span too, guessed or not, since the Focus
 * Screen shows it there. In plain lyrics (or with none) a guessed added line has only its place
 * in the order.
 */
function placedSpans(colors: SongColors, own: OwnLyrics | null): (Span | null)[] {
  const spans = realSpans(colors, own)
  if (own?.kind !== 'synced') return spans
  return spans.map((span, i) => {
    const line = colors.lines[i]
    if (span || !line?.added || line.under !== undefined) return span
    return { start: line.start, end: line.end }
  })
}

/**
 * Where lines added at a press go. `at = pressSec + fixSec`. By time: just before the first
 * main line, in the coding's order, whose placed start (placedSpans: its real start, or in
 * synced lyrics an added line's own) is after `at` (or at the end), when it and the main line
 * before it (those there are) have placed spans. Else right after the selected line's block.
 * Null when that's needed and nothing is selected.
 */
export function addPlace(
  colors: SongColors,
  own: OwnLyrics | null,
  pressSec: number,
  fixSec: number,
  selected: number | null
): { index: number; byTime: boolean } | null {
  const at = pressSec + fixSec
  const spans = placedSpans(colors, own)
  const mains = colors.lines.flatMap((line, i) => (line.under === undefined ? [i] : []))
  const found = mains.findIndex((i) => (spans[i]?.start ?? -Infinity) > at)
  const after = found === -1 ? mains.length : found
  // The line before must show at its time too, or the press could fall either side of it.
  const before = mains[after - 1]
  if (before === undefined || spans[before]) {
    return { index: mains[after] ?? colors.lines.length, byTime: true }
  }
  if (selected === null || !colors.lines[selected]) return null
  return { index: lineRun(colors, selected, null).to, byTime: false }
}

/**
 * A music break marked at a press ("♪ Add break"): it starts at `pressSec + fixSec` (the
 * screen's clock, so the note starts at the press) and runs to the placed start of the line
 * after it (placedSpans), or to the song's end. Only where lines have times (synced lyrics),
 * placed by time as added lines are; null otherwise, or with no room left in the song.
 */
export function breakToAdd(
  colors: SongColors,
  own: OwnLyrics | null,
  pressSec: number,
  fixSec: number,
  durationSec: number
): { at: number; start: number; end: number } | null {
  if (own?.kind !== 'synced') return null
  const place = addPlace(colors, own, pressSec, fixSec, null)
  if (!place?.byTime) return null
  const start = Math.max(0, pressSec + fixSec)
  const songEnd = Number.isFinite(durationSec) ? durationSec + fixSec : Infinity
  const next = placedSpans(colors, own)[place.index]?.start
  const end = Math.min(next !== undefined && next > start ? next : songEnd, songEnd)
  return end > start ? { at: place.index, start, end } : null
}

/** A line as the editor starts one: its words estimated, pulled onto it as `startingColors` pulls them. */
function shownLine(text: string, start: number, end: number): ShownLine {
  const { words } = codedLine(text, start, end, estimateWords(text, start, end))
  return {
    text,
    start,
    end,
    words: words.map(({ text: word, start: from, end: to }) => ({
      text: word,
      start: from,
      end: to
    }))
  }
}

/**
 * The lines to send with `addLines`. The first starts at `pressSec + fixSec` (never before 0),
 * so it lights at the press. The rest share out the time up to the placed start (placedSpans:
 * its real start, or in synced lyrics an added line's own) of the line now at `index`, by length
 * in characters, so they never run past a verse added before them. That start
 * counts only when it is at least MIN_SEC_PER_ADDED_LINE a line after the first's start; else
 * (or with no real start) the span ends ADD_SPAN_SEC after it. The span is cut at the song's
 * end on the screen's clock (`durationSec + fixSec`). Each line's words come from
 * estimateWords, pulled onto it as `startingColors` does (`codedLine`); each line is `guessed`.
 */
export function addedShownLines(
  colors: SongColors,
  own: OwnLyrics | null,
  index: number,
  texts: readonly string[],
  pressSec: number,
  fixSec: number,
  durationSec: number
): ShownLine[] {
  if (texts.length === 0) return []
  const first = Math.max(0, pressSec + fixSec)
  const next = placedSpans(colors, own)[index]?.start
  const until =
    next !== undefined && next - first >= MIN_SEC_PER_ADDED_LINE * texts.length
      ? next
      : first + ADD_SPAN_SEC
  const songEnd = Number.isFinite(durationSec) ? durationSec + fixSec : Infinity
  // Pressed at the very end, the lines get no room rather than times before the press.
  const end = Math.max(first, Math.min(until, songEnd))

  // By whole characters, as plain lyrics are spread: a line of Japanese isn't weighed double.
  const weights = texts.map((text) => Math.max(1, Array.from(text).length))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let done = 0
  return texts.map((text, i) => {
    const start = first + ((end - first) * done) / total
    done += weights[i] ?? 1
    // The last one is set, not summed, so float sums never leave it a hair off the next line.
    const stop = i === texts.length - 1 ? end : first + ((end - first) * done) / total
    return { ...shownLine(text, start, stop), guessed: true }
  })
}

/**
 * An added line's new guessed span after ⌥↑/⌥↓ (R13), to send with `moveLine`. Null unless
 * `own` is synced, `line` is an added main line, and it can move that way: plain lyrics send
 * no times.
 *
 * The neighbours are the ones it will have after the move. A neighbour's span is its placed
 * span (placedSpans): its real span (realSpans), else, for an added line, its own coded span
 * (it shows there in synced lyrics). Lines with neither don't show, and are skipped.
 * - Start: `prev.end + MOVE_GAP_SEC`, where `prev` is the nearest neighbour before. With none
 *   before, `max(0, next.start − MOVE_GAP_SEC − length)`.
 * - `until`: `next.start`, or `endSec` with no neighbour after.
 * - The line keeps its length when it fits before `until`. Else it ends at `until` (spread
 *   over the gap). A gap under MIN_SEC_PER_ADDED_LINE keeps the length anyway, and the next
 *   tap or run places it.
 * `endSec` is the song's end on the screen's clock, `durationSec + fixSec`.
 */
export function movedTimes(
  colors: SongColors,
  own: OwnLyrics | null,
  line: number,
  delta: -1 | 1,
  endSec: number
): Span | null {
  const moved = colors.lines[line]
  if (own?.kind !== 'synced' || !moved?.added || moved.under !== undefined) return null
  // The other main lines in order; the moved one goes `delta` places from where it is among them.
  const others = colors.lines.flatMap((one, i) =>
    one.under === undefined && i !== line ? [i] : []
  )
  const place = others.filter((i) => i < line).length + delta
  if (place < 0 || place > others.length) return null

  const spans = placedSpans(colors, own)
  // Lines that don't show are skipped.
  const shows = (i: number): Span | null => spans[i] ?? null
  const prev = others
    .slice(0, place)
    .reverse()
    .map(shows)
    .find((span) => span !== null)
  const next = others
    .slice(place)
    .map(shows)
    .find((span) => span !== null)

  const length = moved.end - moved.start
  const start = prev
    ? prev.end + MOVE_GAP_SEC
    : next
      ? Math.max(0, next.start - MOVE_GAP_SEC - length)
      : moved.start
  const until = next ? next.start : endSec
  if (start + length <= until || until - start < MIN_SEC_PER_ADDED_LINE) {
    return { start, end: start + length }
  }
  return { start, end: until }
}

/** An added line's new words, spread over its own start and end (estimateWords). */
export function retypedLine(line: CodedLine, text: string): ShownLine {
  // Trimmed as a paste is: the words must spell the line out, and a space before the first
  // word would be no word's.
  return shownLine(text.trim(), line.start, line.end)
}

/**
 * Where an added line's block starts once ⌥↑/⌥↓ has moved it past the block next to it, as
 * main's `moveLine` puts it, so the selection can follow it. Null when it can't go that way:
 * at either end, or not an added main line.
 */
export function movedPlace(colors: SongColors, line: number, delta: -1 | 1): number | null {
  const moved = colors.lines[line]
  if (!moved?.added || moved.under !== undefined) return null
  if (delta < 0) {
    const before = colors.lines[line - 1]
    return before ? (before.under ?? line - 1) : null
  }
  const next = lineRun(colors, line, null).to
  if (!colors.lines[next]) return null
  // It goes past the whole block after it, voices and all.
  return line + (lineRun(colors, next, null).to - next)
}

/** For "after line N": the number of the main line whose block ends just before `index`. */
export function numberBefore(colors: SongColors, index: number): number | null {
  const before = colors.lines[index - 1]
  if (!before) return null
  const main = before.under ?? index - 1
  // Breaks aren't numbered: the list counts sung lines.
  return colors.lines
    .slice(0, main + 1)
    .filter((line) => line.under === undefined && !line.instrumental).length
}

/**
 * A retyped line's words as they'd be saved, trimmed as a paste is; null when they can't be.
 * A blank line just can't be saved; one that's too long says why.
 */
export function retypeCheck(text: string): { text: string | null; problem: string | null } {
  const trimmed = text.trim()
  if (trimmed === '') return { text: null, problem: null }
  // Whole characters, as main counts them.
  if (Array.from(trimmed).length > MAX_ADDED_CHARS) {
    return { text: null, problem: `A line can be at most ${MAX_ADDED_CHARS} characters.` }
  }
  return { text: trimmed, problem: null }
}

/** A line kept by its text and place, to find it again after the coding changes. */
export interface KeptLine {
  index: number
  text: string
}

/** The selected line's main line (a second voice's own), kept for the paste box. */
export function keptLine(colors: SongColors, selected: number | null): KeptLine | null {
  if (selected === null) return null
  const line = colors.lines[selected]
  if (!line) return null
  const main = line.under ?? selected
  const text = colors.lines[main]?.text
  return text === undefined ? null : { index: main, text }
}

/**
 * Where a kept main line is now: still at its place, else the main line with its text nearest
 * where it was (later on a tie: lines added above push a line down); null when it's gone.
 */
export function findKept(colors: SongColors, kept: KeptLine | null): number | null {
  if (!kept) return null
  const isIt = (i: number): boolean => {
    const line = colors.lines[i]
    return line !== undefined && line.under === undefined && line.text === kept.text
  }
  if (isIt(kept.index)) return kept.index
  let best: number | null = null
  colors.lines.forEach((_, i) => {
    if (!isIt(i)) return
    if (best === null || Math.abs(i - kept.index) <= Math.abs(best - kept.index)) best = i
  })
  return best
}

/**
 * Where the paste box's lines go on the coding as it is now: by the press (and the fix then),
 * else after the line kept at the press, wherever it is now. Undo, a drag or a timing run can
 * change the coding while the lines are being pasted. Null when neither places them.
 */
export function placeNow(
  colors: SongColors,
  own: OwnLyrics | null,
  press: { pressSec: number; fixSec: number; kept: KeptLine | null }
): { index: number; byTime: boolean } | null {
  return addPlace(colors, own, press.pressSec, press.fixSec, findKept(colors, press.kept))
}
