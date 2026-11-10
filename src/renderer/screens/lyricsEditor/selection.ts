// What the editor has hold of: the selected line and words, a run of lines, a duet being built
// by clicks, the word (or line) tap timing marks next, and where an Option-click splits a word.
// Pure.
import type { SongColors } from '../../../main/ipc'
import { wordRange } from './editorView'

/** A line (its place in `lines`, second voices included) and a run of its words, either way round. */
export interface Selection {
  line: number
  anchor: number
  focus: number
}

/** The first line with words to color, else the first line; null with no lines. */
function firstLine(colors: SongColors): number | null {
  if (colors.lines.length === 0) return null
  const found = colors.lines.findIndex((line) => line.words.length > 0)
  return found === -1 ? 0 : found
}

/** All of a line's words. */
export function wholeLine(colors: SongColors, line: number): Selection {
  const count = colors.lines[line]?.words.length ?? 0
  return { line, anchor: 0, focus: Math.max(0, count - 1) }
}

/**
 * The selection kept on the coding as it is now: an undo or a second voice can take lines or
 * words away from under it. Nothing selected yet starts on the first line, all of it.
 */
export function fitSelection(
  selection: Selection | null,
  colors: SongColors | null
): Selection | null {
  if (!colors) return null
  if (!selection || !colors.lines[selection.line]) {
    const line = selection ? Math.min(selection.line, colors.lines.length - 1) : firstLine(colors)
    return line === null || line < 0 ? null : wholeLine(colors, line)
  }
  const last = Math.max(0, (colors.lines[selection.line]?.words.length ?? 0) - 1)
  const fit = (word: number): number => Math.min(Math.max(word, 0), last)
  return { line: selection.line, anchor: fit(selection.anchor), focus: fit(selection.focus) }
}

/** The selected words as an edit's range; null for a line with no words. */
export function selectedRange(
  selection: Selection | null,
  colors: SongColors | null
): { from: number; to: number } | null {
  if (!selection || !colors) return null
  const count = colors.lines[selection.line]?.words.length ?? 0
  if (count === 0) return null
  return wordRange(selection.anchor, selection.focus)
}

/** A line's block: its main line (a second voice's own, if it is one) and the voices right under it. */
function blockOf(colors: SongColors, line: number): { from: number; to: number } {
  const main = colors.lines[line]?.under ?? line
  let to = main + 1
  while (colors.lines[to]?.under === main) to++
  return { from: main, to }
}

/** The places from one line's block to the other's, `to` exclusive, either way round; `other` null is the line's own block. */
export function lineRun(
  colors: SongColors,
  line: number,
  other: number | null
): { from: number; to: number } {
  const one = blockOf(colors, line)
  const two = other === null ? one : blockOf(colors, other)
  return { from: Math.min(one.from, two.from), to: Math.max(one.to, two.to) }
}

/**
 * ⇧↑/⇧↓: the run's other end one main line further that way (a line's second voices go with
 * it), starting from the focused line when there's no run yet. Past the song's first or last
 * line it stays where it was.
 */
export function extendRun(
  colors: SongColors,
  line: number,
  other: number | null,
  delta: -1 | 1
): number | null {
  const from = other ?? line
  let next = (colors.lines[from]?.under ?? from) + delta
  while (colors.lines[next]?.under !== undefined) next += delta
  return colors.lines[next] ? next : other
}

/** The line `delta` away in the list, kept on it, with all its words selected. */
export function stepLine(colors: SongColors, line: number, delta: -1 | 1): Selection | null {
  if (colors.lines.length === 0) return null
  const next = Math.min(Math.max(line + delta, 0), colors.lines.length - 1)
  return wholeLine(colors, next)
}

/** Singers picked one click at a time for one run of words: a duet in the order clicked. */
export interface Duet {
  line: number
  from: number
  to: number
  singers: string[]
}

/**
 * The singers after clicking `id` with `range` selected. A click on the same run adds to the
 * duet (or, on a singer already in it, takes them out); a new run starts again with `id`.
 */
export function pickSinger(
  duet: Duet | null,
  line: number,
  range: { from: number; to: number },
  id: string
): Duet {
  const same = duet && duet.line === line && duet.from === range.from && duet.to === range.to
  const before = same ? duet.singers : []
  const singers = before.includes(id) ? before.filter((one) => one !== id) : [...before, id]
  return { line, from: range.from, to: range.to, singers }
}

/** The word tap timing marks next. */
export interface TapAt {
  line: number
  word: number
}

/** Tapping starts at the selected line's first selected word, or the next line that has words. */
export function tapStart(colors: SongColors, selection: Selection | null): TapAt | null {
  if (!selection) return null
  const line = colors.lines[selection.line]
  if (line && line.words.length > 0) {
    return { line: selection.line, word: Math.min(selection.anchor, selection.focus) }
  }
  return nextLineWithWords(colors, selection.line)
}

function nextLineWithWords(colors: SongColors, after: number): TapAt | null {
  for (let i = after + 1; i < colors.lines.length; i++) {
    if ((colors.lines[i]?.words.length ?? 0) > 0) return { line: i, word: 0 }
  }
  return null
}

/** The word after the one just tapped: on along the line, then the next line's first; null at the end. */
export function nextTap(colors: SongColors, at: TapAt): TapAt | null {
  const line = colors.lines[at.line]
  if (line && at.word + 1 < line.words.length) return { line: at.line, word: at.word + 1 }
  return nextLineWithWords(colors, at.line)
}

/** A tap position still on the coding (an edit can take its word away); else null. */
export function fitTap(colors: SongColors, at: TapAt | null): TapAt | null {
  if (!at) return null
  const count = colors.lines[at.line]?.words.length ?? 0
  return at.word < count ? at : null
}

/** Where tapping is: on a word, past the song's last one ('done'), or not started (null). */
export type TapCursor = TapAt | 'done' | null

/** What J marks: each word (its start, held to its end), or each line's start. */
export type TapMode = 'words' | 'lines'

/** The cursor after tapping `at`: the next word, or 'done' after the last. */
export function afterTap(colors: SongColors, at: TapAt): TapCursor {
  return nextTap(colors, at) ?? 'done'
}

/**
 * The word J marks next. Past the last word it's none, until a line or word is picked (which
 * clears the cursor): falling back to the selection would retime its first word.
 */
export function tapTarget(
  colors: SongColors,
  cursor: TapCursor,
  selection: Selection | null
): TapAt | null {
  if (cursor === 'done') return null
  return fitTap(colors, cursor) ?? tapStart(colors, selection)
}

/** The next main line with words after `after`, its first word: line taps leave second voices be. */
function nextMainLine(colors: SongColors, after: number): TapAt | null {
  for (let i = after + 1; i < colors.lines.length; i++) {
    const line = colors.lines[i]
    if (line && line.under === undefined && line.words.length > 0) return { line: i, word: 0 }
  }
  return null
}

/** Lines mode: J marks this line's first word. */
export function lineTapTarget(
  colors: SongColors,
  cursor: TapCursor,
  selection: Selection | null
): TapAt | null {
  if (cursor === 'done') return null
  const at = fitTap(colors, cursor)
  if (at) return { line: at.line, word: 0 }
  if (!selection) return null
  if ((colors.lines[selection.line]?.words.length ?? 0) > 0) {
    return { line: selection.line, word: 0 }
  }
  return nextMainLine(colors, selection.line)
}

/** Lines mode: the next main line with words, its first word; 'done' after the last. */
export function afterLineTap(colors: SongColors, at: TapAt): TapCursor {
  return nextMainLine(colors, at.line) ?? 'done'
}

/**
 * Where an Option-click between two letters splits a word, as `splitWord` counts it (whole
 * characters), from the click's place in the word's text (UTF-16, as the browser gives it).
 * null on the word's very edges, where there's nothing to split off.
 */
export function splitPoint(text: string, offset: number): number | null {
  const chars = Array.from(text).length
  const at = Array.from(text.slice(0, Math.max(0, offset))).length
  return at > 0 && at < chars ? at : null
}
