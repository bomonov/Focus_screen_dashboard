// The color-coding editor's pure helpers: the coding a song starts from, which lines the lyrics
// have left behind, a run of selected words, what "Time by listening" offers, and what a key
// press means.
import type {
  CodedLine,
  ColorEdit,
  ListenState,
  LyricsSource,
  ShownLine,
  SongColors,
  SyncedLine,
  SyncedWord
} from '../../../main/ipc'
import {
  isHeard,
  listenLines,
  listenStretch,
  type OwnLyrics
} from '../../../main/services/lyrics/singers/listen'
import { estimateWords, lineWords } from '../../widgets/music/lyricsGlide'

/**
 * Plain lyrics have no times, so their lines are spread over the middle of the song: a song
 * has an intro and an outro with no singing, and the user times the lines from there.
 */
const PLAIN_FROM = 0.05
const PLAIN_TO = 0.95

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}

/** A line with no words in it is a stanza gap or a break: nothing to color. */
function isBlank(text: string): boolean {
  return text.trim() === ''
}

function isPlain(lines: readonly SyncedLine[] | readonly string[]): lines is readonly string[] {
  return typeof lines[0] === 'string'
}

/**
 * A coded line, its words pulled onto it the way the saved file's parser would pull them
 * (never before the line or the word before, never past its end), so a coding made here is
 * already what reading it back gives.
 */
export function codedLine(
  text: string,
  start: number,
  end: number,
  words: readonly SyncedWord[]
): CodedLine {
  let notBefore = start
  return {
    text,
    start,
    end,
    words: words.map((word) => {
      const from = clamp(word.start, notBefore, end)
      notBefore = from
      // The text stays exactly as given: the words spell out the line.
      return { text: word.text, start: from, end: clamp(word.end, from, end), singers: null }
    })
  }
}

function syncedCoding(
  lines: readonly SyncedLine[],
  durationSec: number,
  offsetSec: number,
  realTimes: boolean
): CodedLine[] {
  // A positive offset shows lines sooner, so a line's true time is the shown time less it.
  const trueTime = (sec: number): number => clamp(sec - offsetSec, 0, durationSec)
  const coded: CodedLine[] = []
  lines.forEach((line, i) => {
    if (isBlank(line.text)) return
    const start = trueTime(line.timeSec)
    const next = lines[i + 1]
    // The next row counts even when it's only a break: that's where this line stops.
    const nextStart = next ? trueTime(next.timeSec) : durationSec
    const timed = line.words?.map((word) => ({
      text: word.text,
      start: trueTime(word.start),
      end: trueTime(word.end)
    }))
    // The very split the Focus Screen lights, so the editor's words are the sung ones.
    const { words } = lineWords(
      { text: line.text, romaji: null, timeSec: start, ...(timed ? { words: timed } : {}) },
      nextStart
    )
    const end = next
      ? Math.max(start, nextStart)
      : clamp(words.at(-1)?.end ?? durationSec, start, durationSec)
    const made = codedLine(line.text, start, end, words)
    coded.push(realTimes ? { ...made, timed: true } : made)
  })
  return coded
}

function plainCoding(lines: readonly string[], durationSec: number): CodedLine[] {
  const sung = lines
    .filter((text) => !isBlank(text))
    // By whole characters: a line of Japanese or emoji isn't weighed double.
    .map((text) => ({ text, weight: Math.max(1, Array.from(text).length) }))
  const total = sung.reduce((sum, { weight }) => sum + weight, 0)
  const from = durationSec * PLAIN_FROM
  const room = durationSec * (PLAIN_TO - PLAIN_FROM)
  let done = 0
  return sung.map(({ text, weight }, i) => {
    const start = from + (room * done) / total
    done += weight
    // The last one is set, not summed, so float sums never leave it a hair short of 95%.
    const end = i === sung.length - 1 ? durationSec * PLAIN_TO : from + (room * done) / total
    return { ...codedLine(text, start, end, estimateWords(text, start, end)), guessed: true }
  })
}

/**
 * The coding a song starts from: its shown lines as words (as the Focus Screen splits them),
 * timed as shown, nobody assigned. Times are the song's true times, so `offsetSec` (the
 * per-song timing fix, positive showing lines sooner) comes off; plain lyrics have no times
 * for it to move. Only lines that came with real times are marked timed: plain lyrics' are
 * made up here, and auto-sync's are its own, which it may make again (for their words), so
 * the screen keeps showing auto-sync's until the user sets a line's times themselves.
 */
export function startingColors(
  lines: readonly SyncedLine[] | readonly string[],
  durationSec: number,
  offsetSec: number,
  source: LyricsSource = 'lrclib'
): SongColors {
  const duration = Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0
  const offset = Number.isFinite(offsetSec) ? offsetSec : 0
  return {
    version: 1,
    lines: isPlain(lines)
      ? plainCoding(lines, duration)
      : syncedCoding(lines, duration, offset, source !== 'autosync'),
    cast: [],
    extra: []
  }
}

/**
 * A shown line (by its place among the lyrics' lines) as the editor would start it: its
 * words and times exactly as `startingColors` makes them, for "Use the new words" or adding
 * it to a coding that hasn't got it. Null for a gap or a line that isn't there.
 */
export function shownLineAt(
  lines: readonly SyncedLine[] | readonly string[],
  row: number,
  durationSec: number,
  offsetSec: number,
  source: LyricsSource = 'lrclib'
): ShownLine | null {
  const texts = isPlain(lines) ? lines : lines.map((line) => line.text)
  const text = texts[row]
  if (text === undefined || isBlank(text)) return null
  // The coding leaves gaps out, so the line's place in it counts only the lines with words.
  const place = texts.slice(0, row).filter((one) => !isBlank(one)).length
  const line = startingColors(lines, durationSec, offsetSec, source).lines[place]
  if (!line) return null
  return {
    text: line.text,
    start: line.start,
    end: line.end,
    words: line.words.map(({ text: word, start, end }) => ({ text: word, start, end })),
    ...(line.timed ? { timed: true as const } : {}),
    ...(line.guessed ? { guessed: true as const } : {})
  }
}

/**
 * Lines in the coding whose text isn't among the shown lines (marked "changed" in the list).
 * A second voice and an added line are the user's own words, never among the shown lines, so
 * they can't be changed
 * out from under them.
 */
export function changedLines(colors: SongColors, shown: readonly string[]): Set<number> {
  const have = new Set(shown)
  const changed = new Set<number>()
  colors.lines.forEach((line, i) => {
    if (line.under === undefined && !line.added && !isBlank(line.text) && !have.has(line.text))
      changed.add(i)
  })
  return changed
}

/** What was picked last: a whole line (its block or its row, ↑/↓) or words in the edit area. */
export type PickedBy = 'line' | 'words'

/** What Delete does: clear the picked words' singers, or make an edit to the selected line. */
export type DeleteAction = { kind: 'clear' } | { kind: 'edit'; edit: ColorEdit } | null

/**
 * Delete, by what was picked last (the user's asks of 2026-11-07: select a line, delete it with
 * Delete). Picked words, or a second voice: their singers are cleared, as before. A line the
 * user added goes (⌘Z brings it back). A line of the lyrics' own can't go, as it's how the
 * coding is matched: it goes back on the lyrics' own time (`ownTime`, their line as the editor
 * would start it), which is only known while the song is on; otherwise nothing.
 */
export function deleteAction(
  colors: SongColors,
  line: number | null,
  pickedBy: PickedBy,
  ownTime: ShownLine | null
): DeleteAction {
  const target = line === null ? undefined : colors.lines[line]
  if (line === null || !target) return null
  if (pickedBy === 'words' || target.under !== undefined) return { kind: 'clear' }
  if (target.added) return { kind: 'edit', edit: { kind: 'removeLine', line } }
  return ownTime ? { kind: 'edit', edit: { kind: 'resetTimes', line, shown: ownTime } } : null
}

/** A drag or shift-click across words, as an inclusive-exclusive range. */
export function wordRange(anchor: number, focus: number): { from: number; to: number } {
  return { from: Math.min(anchor, focus), to: Math.max(anchor, focus) + 1 }
}

/** What "Time by listening" offers for a run of lines; null when the run has no words to time. */
export type ListenView =
  | { kind: 'notInstalled' }
  /** A run is out: `count` lines are being timed. */
  | { kind: 'timing'; count: number }
  /** The stretch the run needs hasn't been heard (or there's no room for one). */
  | { kind: 'notHeard' }
  | { kind: 'ready' }
  | null

/**
 * "Time by listening" for places `run.from`..`run.to` (exclusive): the add-on first, then a run
 * already going, then whether its stretch (`listenStretch`, song time under the song's fix) has
 * been heard. `own` is the lyrics' own lines while they're the editor's song's (`editorLyrics`):
 * null while another song plays, when only timed lines count here and main has the last word.
 */
export function listenView(
  listen: ListenState,
  colors: SongColors,
  run: { from: number; to: number },
  durationSec: number,
  own: OwnLyrics | null
): ListenView {
  if (!listen.installed) return { kind: 'notInstalled' }
  if (listen.timing.length > 0) return { kind: 'timing', count: listen.timing.length }
  const lines = listenLines(colors, run.from, run.to)
  if (lines.length === 0) return null
  const stretch = listenStretch(colors, lines, durationSec, own, listen.fixSec)
  return stretch && isHeard(listen.heard, stretch) ? { kind: 'ready' } : { kind: 'notHeard' }
}

/** Whether a run's note names any of the selected lines (`run`: places, `to` exclusive). */
export function noteApplies(
  noteLines: readonly number[],
  run: { from: number; to: number } | null
): boolean {
  return run !== null && noteLines.some((line) => line >= run.from && line < run.to)
}

/**
 * The page's side of a run's note, render by render. `key` is main's note now (its words and
 * lines; null for none), `here` whether it applies to the selection, and `shown` the note the
 * page has shown. Once a note has shown and the selection has moved off its lines, `drop` asks
 * main to drop it, so it doesn't come back. One that comes while the selection is elsewhere
 * waits for its lines.
 */
export function noteStep(
  shown: string | null,
  key: string | null,
  here: boolean
): { shown: string | null; drop: boolean } {
  if (key === null) return { shown: null, drop: false }
  if (here) return { shown: key, drop: false }
  return { shown: null, drop: shown === key }
}

export type EditorKey =
  | { kind: 'line'; delta: -1 | 1 }
  /** ⇧↑/⇧↓: the run of selected lines reaches one more line. */
  | { kind: 'extendLines'; delta: -1 | 1 }
  /** ⌥↑/⌥↓: an added line moves past the line next to it. */
  | { kind: 'moveLine'; delta: -1 | 1 }
  | { kind: 'playLine' }
  /** ⇧Space: plays from the line before, to tap this one again. */
  | { kind: 'replayLine' }
  | { kind: 'addLines' }
  | { kind: 'assign'; slot: number }
  | { kind: 'clear' }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'tap'; phase: 'down' | 'up' }
  | null

/**
 * The editor's keys: ↑/↓ lines (⇧ runs the selection on, ⌥ moves an added line), Space plays
 * the line (⇧Space from the line before), 1–9 the cast row's slots, Delete (`deleteAction`), ⌘Z / ⇧⌘Z
 * undo and redo, ⌘N adds lines, J taps. Typing in a field is never a key.
 */
export function editorKey(event: {
  key: string
  metaKey: boolean
  shiftKey: boolean
  altKey?: boolean
  type: 'keydown' | 'keyup'
  repeat: boolean
  inField: boolean
}): EditorKey {
  if (event.inField) return null
  const { key, metaKey, repeat } = event
  const letter = key.toLowerCase()

  if (letter === 'j') {
    // Letting go always counts, even if ⌘ went down meanwhile: a tap left held would run on.
    if (event.type === 'keyup') return { kind: 'tap', phase: 'up' }
    // A held key repeats keydown; only the first press marks the word.
    return metaKey || repeat ? null : { kind: 'tap', phase: 'down' }
  }
  if (event.type === 'keyup') return null

  if (metaKey) {
    if (letter === 'z') return { kind: event.shiftKey ? 'redo' : 'undo' }
    // Once per press: a held ⌘N would ask again and again.
    return letter === 'n' && !event.shiftKey && !repeat ? { kind: 'addLines' } : null
  }

  // Held arrows keep walking the lines (or running the selection on). The rest do their one
  // thing once: a held Space would restart the line over and over, a held number would pile up
  // identical edits, and a held ⌥↑ would swap two added lines back and forth before the coding
  // caught up.
  const delta = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : null
  if (delta !== null) {
    // Both at once is neither: a slip of one shouldn't move a line while the other runs on.
    if (event.altKey && event.shiftKey) return null
    if (event.altKey) return repeat ? null : { kind: 'moveLine', delta }
    return { kind: event.shiftKey ? 'extendLines' : 'line', delta }
  }
  if (repeat) return null
  if (key === ' ') return { kind: event.shiftKey ? 'replayLine' : 'playLine' }
  if (key === 'Delete' || key === 'Backspace') return { kind: 'clear' }
  if (/^[1-9]$/.test(key)) return { kind: 'assign', slot: Number(key) - 1 }
  return null
}
