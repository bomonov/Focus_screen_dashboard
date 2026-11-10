import { blockAt, reordered, scaled, voicesInBlock } from './addedEdits'
import { fromShown, isIndex, isTime, type Edit } from './editBasics'
import type { CodedLine, SongColors } from './types'

// A line's block dragged along the waveform (`slideLine`), and Delete putting one of the
// lyrics' own lines back on their time (`resetTimes`; the user's asks of 2026-11-07: "hold and
// drag will move it along", "let me delete it with … a delete button"). Pure like every step,
// so the page draws a drag exactly where main will put it.

/**
 * How close a line of the lyrics' own may come to its neighbours' starts. The lyrics' order is
 * how a coding is matched to them, so it never ties or passes one.
 */
const KEEP_APART_SEC = 0.05

/**
 * The nearest main line before or after `index` whose time is real (second voices skipped). A
 * guess (plain lyrics spread over the song) is no line's place: a line is dragged past it to
 * where it's really sung.
 */
function neighbour(colors: SongColors, index: number, step: -1 | 1): CodedLine | undefined {
  for (let i = index + step; i >= 0 && i < colors.lines.length; i += step) {
    const line = colors.lines[i]
    if (line && line.under === undefined && !(line.guessed && !line.timed)) return line
  }
  return undefined
}

/**
 * Where a main line's start may go: inside the song with its length kept, and for a line of the
 * lyrics' own, between the starts of its neighbours with real times (its own start always counts,
 * even where an older coding has it out of order). Null for a second voice or no such line.
 */
function slideRange(
  colors: SongColors,
  index: number,
  songEnd: number
): { min: number; max: number } | null {
  const line = isIndex(index, colors.lines.length) ? colors.lines[index] : undefined
  if (!line || line.under !== undefined) return null
  let min = 0
  let max = Number.isFinite(songEnd) ? Math.max(0, songEnd - (line.end - line.start)) : Infinity
  if (!line.added) {
    const before = neighbour(colors, index, -1)
    const after = neighbour(colors, index, 1)
    if (before) min = Math.max(min, before.start + KEEP_APART_SEC)
    if (after) max = Math.min(max, after.start - KEEP_APART_SEC)
  }
  return { min: Math.min(min, line.start), max: Math.max(max, line.start) }
}

/** `item` moved by `by`, its times kept inside the song. */
function shifted<T extends { start: number; end: number }>(
  item: T,
  by: number,
  songEnd: number
): T {
  const inSong = (sec: number): number => Math.min(Math.max(sec, 0), songEnd)
  return { ...item, start: inSong(item.start + by), end: inSong(item.end + by) }
}

/** The line moved whole to start at `start` (kept where it may go), its words along; it's `timed`. */
function moved(line: CodedLine, start: number, songEnd: number): CodedLine {
  const by = start - line.start
  const next: CodedLine = {
    ...shifted(line, by, songEnd),
    words: line.words.map((word) => shifted(word, by, songEnd)),
    timed: true
  }
  delete next.guessed
  return next
}

/**
 * The line as a drag to `start` would leave it (the waveform draws this while it's held), or
 * null when it can't be slid. `songEnd` 0 or less means the song's length isn't known.
 */
export function slideTo(
  colors: SongColors,
  index: number,
  start: number,
  songEnd: number
): CodedLine | null {
  const end = songEnd > 0 ? songEnd : Infinity
  const range = slideRange(colors, index, end)
  const line = colors.lines[index]
  if (!range || !line || !isTime(start)) return null
  return moved(line, Math.min(Math.max(start, range.min), range.max), end)
}

/** An added line's block taken out and put back before the first main line that starts after it. */
function placedByStart(colors: SongColors, index: number): SongColors {
  const line = colors.lines[index]
  if (!line || !voicesInBlock(colors, index)) return colors
  const mine = blockAt(colors, index)
  const rest = [...colors.lines.keys()].filter((i) => !mine.includes(i))
  const at = rest.findIndex((i) => {
    const other = colors.lines[i]
    return other !== undefined && other.under === undefined && other.start > line.start
  })
  const order = at < 0 ? [...rest, ...mine] : [...rest.slice(0, at), ...mine, ...rest.slice(at)]
  return order.every((old, now) => old === now) ? colors : reordered(colors, order)
}

export function slideLine(colors: SongColors, edit: Edit<'slideLine'>): SongColors {
  if (!isIndex(edit.line, colors.lines.length) || !isTime(edit.start)) return colors
  const songEnd = isTime(edit.songEnd) && edit.songEnd > 0 ? edit.songEnd : 0
  const target = colors.lines[edit.line]
  const line = slideTo(colors, edit.line, edit.start, songEnd)
  if (!target || !line) return colors
  const by = line.start - target.start
  if (by === 0) return colors
  const end = songEnd > 0 ? songEnd : Infinity
  // Its second voices keep their distance from it, each kept inside the song.
  const lines = colors.lines.map((one, i) => {
    if (i === edit.line) return line
    if (one.under !== edit.line) return one
    return { ...shifted(one, by, end), words: one.words.map((word) => shifted(word, by, end)) }
  })
  const slid = { ...colors, lines }
  return target.added ? placedByStart(slid, edit.line) : slid
}

export function resetTimes(colors: SongColors, edit: Edit<'resetTimes'>): SongColors {
  const target = isIndex(edit.line, colors.lines.length) ? colors.lines[edit.line] : undefined
  // Only a line of the lyrics' own has a time of theirs to go back to.
  if (!target || target.under !== undefined || target.added) return colors
  const shown = fromShown(edit.shown)
  if (!shown || shown.text !== target.text) return colors
  const span = { start: shown.start, end: shown.end }
  const line: CodedLine = {
    ...target,
    ...span,
    words: scaled(target.words, target, span),
    ...(shown.timed ? { timed: true as const } : {}),
    ...(shown.guessed ? { guessed: true as const } : {})
  }
  if (!shown.timed) delete line.timed
  if (!shown.guessed) delete line.guessed
  const by = shown.start - target.start
  const lines = colors.lines.map((one, i) => {
    if (i === edit.line) return line
    if (one.under !== edit.line) return one
    return {
      ...shifted(one, by, Infinity),
      words: one.words.map((word) => shifted(word, by, Infinity))
    }
  })
  return { ...colors, lines }
}
