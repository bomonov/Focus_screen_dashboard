// "Time by listening": which stretch of the song a run hears, whether it has been heard, the
// edit its answer makes and what it says. Import-free but for `./apply` and types: the editor's
// page works out the same stretch, to offer the button only once it's heard.
import type { Lyrics, SyncedLine, SyncedWord } from '../types'
import { matchLines, onShownWords } from './apply'
import type { CodedLine, ColorEdit, HeardTime, SongColors } from './types'

/** How much of a stretch must have been heard before it's timed. */
export const HEARD_SHARE = 0.95
/** The audio given to the aligner reaches this far past the stretch on each side. */
export const LISTEN_PAD_SEC = 0.5
/**
 * The least time a line just added gets before the next line's real start: the page spreads a
 * paste further than that (`addedShownLines`), and the run after an add won't squeeze them in.
 */
export const MIN_SEC_PER_ADDED_LINE = 1
/** With no real start after them, a run hears this long a line... */
export const OPEN_SEC_PER_LINE = 8
/** ...and never longer, so it doesn't listen on into the lines after it. */
export const OPEN_MAX_SEC = 60

/** What "Time by listening" says when the stretch it needs hasn't been heard. */
export const NOT_HEARD_NOTE = 'Play this part once so I can hear it.'
/**
 * What it says when lines just added have too little time before the next line to time by
 * themselves: once the first one's start is set, the run after an add times the rest.
 */
export const CRAMPED_NOTE = "Tap the first line's start, and I'll time the rest."
/** ...and when a run failed, or placed none of its lines. */
export const TIMING_FAILED_NOTE = "Couldn't time these lines."

/** What a run says when the aligner placed some of its lines but not all. */
export function missedNote(missed: number, total: number): string {
  const keeps = missed === 1 ? 'it keeps its times' : 'they keep their times'
  return `Couldn't place ${missed} of these ${total} lines; ${keeps}.`
}

/** The words for a run's answer (null for a failed run): null when every line was placed. */
export function runNote(answer: readonly (HeardLine | null)[] | null): string | null {
  if (!answer) return TIMING_FAILED_NOTE
  const missed = answer.filter((line) => line === null).length
  if (missed === answer.length) return TIMING_FAILED_NOTE
  return missed > 0 ? missedNote(missed, answer.length) : null
}

/** A line's times as one string: its own and each word's. */
export function timeSignature(line: CodedLine): string {
  return JSON.stringify([line.start, line.end, line.words.map((word) => [word.start, word.end])])
}

/** The lyrics' own lines with their times, as the editor reads them (`ownLyricsOf`, through `editorLyrics`). */
export type OwnLyrics = Extract<Lyrics, { kind: 'synced' | 'plain' }>

interface Span {
  start: number
  end: number
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Where each coded line shows for real (R14), on the screen's clock (song position + the fix;
 * the Focus Screen lights `syncedLineIndex(lines, position + offsetSec)`). For a main line
 * matched (matchLines) to a row of synced `own` lyrics: that row's `timeSec`, until its last
 * word's end, or `timeSec` plus the coded line's length when the row has no words. Else, for a
 * `timed` line: its own start and end. Else null (a guess, a second voice, plain lyrics'
 * untimed lines, or `own` null and not timed).
 */
export function realSpans(colors: SongColors, own: OwnLyrics | null): (Span | null)[] {
  const rows: readonly SyncedLine[] = own?.kind === 'synced' ? own.lines : []
  // Which synced row each coded line is.
  const rowOf = new Map<number, SyncedLine>()
  matchLines(
    rows.map((row) => row.text),
    colors.lines
  ).forEach((match, row) => {
    const shown = rows[row]
    if (match !== undefined && shown) rowOf.set(match, shown)
  })

  return colors.lines.map((line, index) => {
    if (line.under !== undefined) return null
    const shown = rowOf.get(index)
    if (shown) {
      const end = shown.words?.at(-1)?.end ?? shown.timeSec + (line.end - line.start)
      return { start: shown.timeSec, end: Math.max(shown.timeSec, end) }
    }
    return line.timed ? { start: line.start, end: line.end } : null
  })
}

/** The main lines with words among places from..to (exclusive) of `lines`: second voices stay out. */
export function listenLines(colors: SongColors, from: number, to: number): number[] {
  const places: number[] = []
  const last = Math.min(to, colors.lines.length)
  for (let index = Math.max(0, from); index < last; index++) {
    const line = colors.lines[index]
    if (!line || line.under !== undefined) continue
    if (line.words.some((word) => word.text.trim() !== '')) places.push(index)
  }
  return places
}

/**
 * The stretch a run hears for `lines`, in SONG time (what the recording and the aligner use).
 * On the screen's clock it runs from the first line's real start (realSpans), or its coded
 * start when it has none (R10). It ends at the real start of the main line right after the
 * last of `lines`, when that line has one later than the start. Else it ends OPEN_SEC_PER_LINE
 * a line on, at most OPEN_MAX_SEC. It never ends before the last of `lines`' own real end,
 * where that has one. Both ends then turn into song time (`− fixSec`) and are cut to
 * [0, durationSec]. Null for no lines or no room.
 */
export function listenStretch(
  colors: SongColors,
  lines: readonly number[],
  durationSec: number,
  own: OwnLyrics | null,
  fixSec: number
): { from: number; to: number } | null {
  if (lines.length === 0) return null
  const first = Math.min(...lines)
  const last = Math.max(...lines)
  const firstLine = colors.lines[first]
  if (!firstLine) return null
  const spans = realSpans(colors, own)
  const start = spans[first]?.start ?? firstLine.start

  // The next main line: its second voices sit right under it and are skipped.
  let next = last + 1
  while (colors.lines[next]?.under !== undefined) next++
  const nextStart = spans[next]?.start
  const open =
    nextStart !== undefined && nextStart > start
      ? nextStart
      : start + Math.min(OPEN_SEC_PER_LINE * lines.length, OPEN_MAX_SEC)
  // Never short of the last line's own real end: a long break inside the run would otherwise
  // leave that line's singing out, and the aligner would force it into the wrong audio.
  const end = Math.max(open, spans[last]?.end ?? open)

  const fix = isTime(fixSec) ? fixSec : 0
  const from = Math.max(0, start - fix)
  const to = Math.min(durationSec, end - fix)
  return to > from ? { from, to } : null
}

/**
 * Too little time for `count` lines just added to be timed by themselves: under
 * MIN_SEC_PER_ADDED_LINE a line, as when they were pressed just before the next line. The
 * aligner would force them into the wrong audio; the user taps the first one's start instead.
 */
export function isCramped(stretch: { from: number; to: number }, count: number): boolean {
  return stretch.to - stretch.from < MIN_SEC_PER_ADDED_LINE * count
}

/** 0–1: how much of from..to the heard stretches cover, each moment counted once. */
export function coveredShare(
  spans: readonly (readonly [number, number])[],
  from: number,
  to: number
): number {
  if (!(to > from)) return 0
  const sorted = [...spans].sort((a, b) => a[0] - b[0])
  let reached = from
  let covered = 0
  for (const [start, end] of sorted) {
    const low = Math.max(start, reached)
    const high = Math.min(end, to)
    if (high > low) {
      covered += high - low
      reached = high
    }
  }
  return covered / (to - from)
}

/** Heard enough to time: at least HEARD_SHARE of the stretch. */
export function isHeard(
  spans: readonly (readonly [number, number])[],
  stretch: { from: number; to: number }
): boolean {
  return coveredShare(spans, stretch.from, stretch.to) >= HEARD_SHARE
}

/** A line the aligner placed, in song time, with its words when it heard them. */
export interface HeardLine {
  start: number
  end: number
  words?: SyncedWord[]
}

/** The line's own words on start..end, each keeping its share of the line. */
function spread(line: CodedLine, start: number, end: number): Span[] {
  const span = line.end - line.start
  const width = end - start
  const count = line.words.length
  return line.words.map((word, i) =>
    span > 0
      ? {
          start: start + ((word.start - line.start) * width) / span,
          end: start + ((word.end - line.start) * width) / span
        }
      : { start: start + (width * i) / count, end: start + (width * (i + 1)) / count }
  )
}

/**
 * The edit a run's answer makes, on the song's clock. It covers each answered line still at its
 * place with the text it was asked with, for which `still(line, place)` holds. Its words go on
 * the answer's words by their letters (onShownWords) when those spell the line out; else its own
 * words are scaled into the span, each keeping its share. Null when no line is left.
 */
export function heardEdit(
  colors: SongColors,
  asked: readonly { index: number; text: string }[],
  heard: readonly (HeardLine | null)[],
  still: (line: CodedLine, index: number) => boolean
): Extract<ColorEdit, { kind: 'heardTimes' }> | null {
  const lines: HeardTime[] = []
  asked.forEach(({ index, text }, i) => {
    const answer = heard[i]
    const line = colors.lines[index]
    // Moved, retyped or removed meanwhile.
    if (!answer || !line || line.under !== undefined || line.text !== text) return
    // Timed by the user where their times win.
    if (!still(line, index)) return
    const { start, end } = answer
    if (!isTime(start) || !isTime(end) || start < 0 || end <= start) return
    const shown: SyncedLine = {
      timeSec: start,
      text: line.text,
      ...(answer.words ? { words: answer.words } : {})
    }
    const words = onShownWords(line, shown) ?? spread(line, start, end)
    lines.push({
      line: index,
      start,
      end,
      words: words.map((word) => ({ start: word.start, end: word.end }))
    })
  })
  return lines.length > 0 ? { kind: 'heardTimes', lines } : null
}
