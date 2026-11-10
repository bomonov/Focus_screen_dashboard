import { CAST, castSinger } from './cast'
import { addBreak, addLines, heardTimes, moveLine, removeLine, retype } from './addedEdits'
import { resetTimes, slideLine } from './lineSlide'
import {
  copySingers,
  fromShown,
  isIndex,
  isRecord,
  isTime,
  keptSingers,
  same,
  withLine,
  type Edit
} from './editBasics'
import { MAX_SINGER_NAME } from './parse'
import type { CodedLine, CodedWord, ColorEdit, FirstEdit, SingerRef, SongColors } from './types'

// The changes the color-coding editor makes, one pure step each: a coding in, a new one out,
// the input never touched. An edit that can't be done (a line that isn't there, a time that
// isn't a time) gives the same object back, which is how the history knows to skip it. What
// comes out is always something `parseSongColors` would keep as it is. The steps for lines
// the user adds, and a timing run's heard times, are in `addedEdits.ts`.

const EXTRA_PREFIX = 'extra:'
const HEX_COLOR = /^#[0-9a-f]{6}$/i

function isKnownSinger(colors: SongColors, id: string): boolean {
  return castSinger(id) !== undefined || colors.extra.some((singer) => singer.id === id)
}

/** The ids that are real singers here, once each, in the order given. */
function knownSingers(colors: SongColors, ids: readonly unknown[]): string[] {
  const kept: string[] = []
  for (const id of ids) {
    if (typeof id === 'string' && isKnownSinger(colors, id) && !kept.includes(id)) kept.push(id)
  }
  return kept
}

/** What a part is given, or undefined when it can't be. Nobody picked at all clears it, like null. */
function singersFor(colors: SongColors, wanted: SingerRef | null): SingerRef | null | undefined {
  if (wanted === null) return null
  // One singer can't be "everyone", and the cast is who it means.
  if (wanted === 'everyone') return colors.cast.length >= 2 ? 'everyone' : undefined
  if (!Array.isArray(wanted)) return undefined
  const list: readonly unknown[] = wanted
  if (list.length === 0) return null
  const known = knownSingers(colors, list)
  return known.length > 0 ? known : undefined
}

function assign(colors: SongColors, edit: Edit<'assign'>): SongColors {
  const target = isIndex(edit.line, colors.lines.length) ? colors.lines[edit.line] : undefined
  if (!target) return colors
  const { from, to } = edit
  if (!Number.isInteger(from) || !Number.isInteger(to)) return colors
  if (from < 0 || from >= to || to > target.words.length) return colors
  const singers = singersFor(colors, edit.singers)
  if (singers === undefined) return colors

  const words = target.words.map((word, i) =>
    i >= from && i < to ? { ...word, singers: copySingers(singers) } : word
  )
  return withLine(colors, edit.line, { ...target, words })
}

/**
 * The line with times set on it, its own from now on (`timed`): unless it's a guess whose start
 * is still the guess (`guessed`), which would show it wherever the editor spread it. Then the
 * times are kept for the editor, and the screen keeps the lyrics' own until the start is set.
 */
function setTimes(line: CodedLine, startSet: boolean): CodedLine {
  if (line.guessed && !line.timed && !startSet) return line
  const timed: CodedLine = { ...line, timed: true }
  delete timed.guessed
  return timed
}

function lineTime(colors: SongColors, edit: Edit<'lineTime'>): SongColors {
  const target = isIndex(edit.line, colors.lines.length) ? colors.lines[edit.line] : undefined
  // No time given sets none: it mustn't mark the line timed either.
  if (!target || (edit.start === undefined && edit.end === undefined)) return colors
  const start = edit.start ?? target.start
  const end = edit.end ?? target.end
  if (!isTime(start) || !isTime(end) || start < 0 || start >= end) return colors

  // A word that ends up outside is pulled to the edge, so no word is ever off its line.
  const inside = (sec: number): number => Math.min(Math.max(sec, start), end)
  const words = target.words.map((word) => ({
    ...word,
    start: inside(word.start),
    end: inside(word.end)
  }))
  return withLine(
    colors,
    edit.line,
    setTimes({ ...target, start, end, words }, edit.start !== undefined)
  )
}

function wordTime(colors: SongColors, edit: Edit<'wordTime'>): SongColors {
  const target = isIndex(edit.line, colors.lines.length) ? colors.lines[edit.line] : undefined
  if (!target || !isIndex(edit.word, target.words.length)) return colors
  if (edit.start === undefined && edit.end === undefined) return colors
  const old = target.words[edit.word]
  if (!old) return colors
  const start = edit.start ?? old.start
  const end = edit.end ?? old.end
  if (!isTime(start) || !isTime(end)) return colors

  // Starts only go forward along the line, so a word can't jump before the one that
  // comes first, nor past the one that comes after it.
  const earliest = Math.max(target.start, target.words[edit.word - 1]?.start ?? target.start)
  const latest = Math.min(target.end, target.words[edit.word + 1]?.start ?? target.end)
  const newStart = Math.min(Math.max(start, earliest), latest)
  const newEnd = Math.min(Math.max(end, newStart), target.end)

  const words = target.words.map((word, i) =>
    i === edit.word ? { ...word, start: newStart, end: newEnd } : word
  )
  // A word's start isn't the line's: on a guessed line it leaves the line a guess.
  return withLine(colors, edit.line, setTimes({ ...target, words }, false))
}

/**
 * A tap is where the singer was heard, so it isn't held back by the words around it the way a
 * dragged time is: a late start pushes the rest of the line along with it (each word keeping
 * its length), the first word can pull the line's start earlier, and the last can carry its
 * end later. Only order and the song's length hold it: never before the word before it starts,
 * never before 0, never past `songEnd`. On a line nobody has timed, the first word's tap is
 * where the line starts, later too: its start was only a guess or auto-sync's, and a start
 * left before the singing would light the line early. A guessed line moves whole, end too.
 */
function tapTime(colors: SongColors, edit: Edit<'tapTime'>): SongColors {
  if (edit.whole === true) return tapWhole(colors, edit)
  const target = isIndex(edit.line, colors.lines.length) ? colors.lines[edit.line] : undefined
  if (!target || !isIndex(edit.word, target.words.length)) return colors
  const { start, end } = edit
  if (start === undefined && end === undefined) return colors
  if ((start !== undefined && !isTime(start)) || (end !== undefined && !isTime(end))) return colors
  const songEnd = isTime(edit.songEnd) && edit.songEnd > 0 ? edit.songEnd : Infinity
  const inSong = (sec: number): number => Math.min(Math.max(sec, 0), songEnd)

  let words = target.words
  let lineStart = target.start
  let lineEnd = target.end
  if (start !== undefined) {
    const old = words[edit.word]
    if (!old) return colors
    const earliest = words[edit.word - 1]?.start ?? 0
    const newStart = inSong(Math.max(start, earliest))
    const by = newStart - old.start
    words = words.map((word, i) => {
      if (i > edit.word) {
        return { ...word, start: inSong(word.start + by), end: inSong(word.end + by) }
      }
      if (i === edit.word) {
        return { ...word, start: newStart, end: Math.max(newStart, inSong(word.end + by)) }
      }
      // The word before ends where this one now starts, at the latest.
      return word.end > newStart ? { ...word, end: Math.max(word.start, newStart) } : word
    })
    if (edit.word === 0) {
      lineStart = target.timed ? Math.min(lineStart, newStart) : newStart
      if (target.guessed && !target.timed) lineEnd = Math.max(newStart, inSong(lineEnd + by))
    }
  }
  if (end !== undefined) {
    words = words.map((word, i) =>
      i === edit.word ? { ...word, end: Math.max(word.start, inSong(end)) } : word
    )
  }
  // Grown to hold its words; they were kept inside the song, so it is too.
  const grown = Math.max(lineEnd, ...words.map((word) => word.end))
  const startSet = start !== undefined && edit.word === 0
  return withLine(
    colors,
    edit.line,
    setTimes({ ...target, start: lineStart, end: grown, words }, startSet)
  )
}

/**
 * Tap: Lines. The tap is where the line's first word is sung, so the whole line moves there,
 * timed or not: its start and first word on the press, every word, its end and the second voices
 * under it shifted by as much (each keeping its share), all kept inside the song. Its start is
 * set, so it's `timed` and no longer a guess. Only a start on the first word is a line's tap.
 */
function tapWhole(colors: SongColors, edit: Edit<'tapTime'>): SongColors {
  const target = isIndex(edit.line, colors.lines.length) ? colors.lines[edit.line] : undefined
  const first = target?.words[0]
  const { start } = edit
  if (!target || !first || edit.word !== 0 || edit.end !== undefined || !isTime(start)) {
    return colors
  }
  const songEnd = isTime(edit.songEnd) && edit.songEnd > 0 ? edit.songEnd : Infinity
  const inSong = (sec: number): number => Math.min(Math.max(sec, 0), songEnd)
  const at = inSong(start)
  const by = at - first.start
  const shift = <T extends { start: number; end: number }>(item: T): T => ({
    ...item,
    start: inSong(item.start + by),
    end: inSong(item.end + by)
  })

  const words = target.words.map(shift)
  const moved = { ...target, start: at, end: Math.max(at, inSong(target.end + by)), words }
  const lines = colors.lines.map((one, i) => {
    if (i === edit.line) return setTimes(moved, true)
    return one.under === edit.line ? { ...shift(one), words: one.words.map(shift) } : one
  })
  return { ...colors, lines }
}

function splitWord(colors: SongColors, edit: Edit<'splitWord'>): SongColors {
  const target = isIndex(edit.line, colors.lines.length) ? colors.lines[edit.line] : undefined
  if (!target || !isIndex(edit.word, target.words.length)) return colors
  const old = target.words[edit.word]
  if (!old) return colors
  // By whole characters: a letter outside the basic range is two UTF-16 units.
  const chars = Array.from(old.text)
  if (!Number.isInteger(edit.at) || edit.at <= 0 || edit.at >= chars.length) return colors

  const middle = old.start + ((old.end - old.start) * edit.at) / chars.length
  const first: CodedWord = {
    text: chars.slice(0, edit.at).join(''),
    start: old.start,
    end: middle,
    singers: copySingers(old.singers)
  }
  const second: CodedWord = {
    text: chars.slice(edit.at).join(''),
    start: middle,
    end: old.end,
    singers: copySingers(old.singers)
  }
  const words = target.words.flatMap((word, i) => (i === edit.word ? [first, second] : [word]))
  return withLine(colors, edit.line, { ...target, words })
}

const OPENERS = new Set(['(', '（'])
const CLOSERS = new Set([')', '）'])

/** One pair of brackets round the whole text: "(a) and (b)" is two, so it isn't. */
function isWrapped(text: string): boolean {
  const chars = Array.from(text)
  const first = chars[0]
  if (first === undefined || !OPENERS.has(first)) return false
  let depth = 0
  for (const [i, char] of chars.entries()) {
    if (OPENERS.has(char)) depth++
    else if (CLOSERS.has(char)) depth--
    // The first bracket has to close at the very end.
    if (depth === 0) return i === chars.length - 1
  }
  return false
}

/** The words of a "(echo)" without its brackets, taken off the outer words' edges. */
function unwrapped(words: readonly CodedWord[]): CodedWord[] {
  const plain = [...words]
  if (
    !isWrapped(
      words
        .map((word) => word.text)
        .join('')
        .trim()
    )
  )
    return plain

  const copy = words.map((word) => ({ ...word }))
  const first = copy[0]
  const last = copy[copy.length - 1]
  if (!first || !last) return plain
  first.text = first.text.replace(/^(\s*)[(（]/u, '$1')
  last.text = last.text.replace(/[)）](\s*)$/u, '$1')
  // A bracket that was a word of its own leaves nothing behind.
  const kept = copy.filter((word) => word.text !== '')
  // "()" has nothing inside to be a voice: keep it as it was rather than make an empty one.
  return kept
    .map((word) => word.text)
    .join('')
    .trim() === ''
    ? plain
    : kept
}

/** `voice` set under `main`, after the line and the voices it already has; later `under`s move along. */
function insertVoice(
  colors: SongColors,
  lines: readonly CodedLine[],
  main: number,
  voice: CodedLine
): SongColors {
  let last = main
  lines.forEach((line, i) => {
    if (line.under === main) last = Math.max(last, i)
  })
  const at = last + 1
  const later = lines
    .slice(at)
    .map((line) =>
      line.under !== undefined && line.under >= at ? { ...line, under: line.under + 1 } : line
    )
  return { ...colors, lines: [...lines.slice(0, at), { ...voice, under: main }, ...later] }
}

function makeVoice(colors: SongColors, edit: Edit<'makeVoice'>): SongColors {
  const source = isIndex(edit.line, colors.lines.length) ? colors.lines[edit.line] : undefined
  if (!source) return colors
  const { from, to } = edit
  if (!Number.isInteger(from) || !Number.isInteger(to)) return colors
  if (from < 0 || from >= to || to > source.words.length) return colors
  // A second voice under a voice is the main line's: it's the main line's words that shown
  // lines are matched by, and a voice has to keep something of its own.
  const main = source.under ?? edit.line
  if (!colors.lines[main]) return colors
  if (source.under !== undefined && to - from === source.words.length) return colors

  const words = unwrapped(source.words.slice(from, to))
  const first = words[0]
  const text = words
    .map((word) => word.text)
    .join('')
    .trim()
  if (!first || text === '') return colors

  const rest = [...source.words.slice(0, from), ...source.words.slice(to)]
  // The main line's own text stays as the lyrics show it: that's how it's found again.
  const lines = colors.lines.map((line, i) => (i === edit.line ? { ...source, words: rest } : line))
  const voice: CodedLine = {
    text,
    start: first.start,
    end: Math.max(...words.map((word) => word.end)),
    words,
    // Its words keep the times they had on the line, real or not.
    ...(source.timed ? { timed: true as const } : {}),
    ...(source.guessed ? { guessed: true as const } : {})
  }
  return insertVoice(colors, lines, main, voice)
}

function addVoice(colors: SongColors, edit: Edit<'addVoice'>): SongColors {
  const target = isIndex(edit.line, colors.lines.length) ? colors.lines[edit.line] : undefined
  if (!target || typeof edit.text !== 'string') return colors
  const main = target.under ?? edit.line
  const mainLine = colors.lines[main]
  const pieces = edit.text.split(/\s+/u).filter((piece) => piece !== '')
  // Nobody sings in a music break, under it neither.
  if (!mainLine || mainLine.instrumental || pieces.length === 0) return colors

  // Longer words take longer to sing; the main line's span is shared out by length.
  const lengths = pieces.map((piece) => Array.from(piece).length)
  const total = lengths.reduce((sum, length) => sum + length, 0)
  const span = mainLine.end - mainLine.start
  const edges = [mainLine.start]
  let sofar = 0
  for (const length of lengths) {
    sofar += length
    edges.push(mainLine.start + (span * sofar) / total)
  }
  edges[pieces.length] = mainLine.end

  const words = pieces.map((piece, i): CodedWord => ({
    text: i < pieces.length - 1 ? `${piece} ` : piece,
    start: edges[i] ?? mainLine.start,
    end: edges[i + 1] ?? mainLine.end,
    singers: null
  }))
  const voice: CodedLine = {
    text: pieces.join(' '),
    start: mainLine.start,
    end: mainLine.end,
    words,
    // Shared out over the main line's span, so a guess when that is.
    ...(mainLine.guessed && !mainLine.timed ? { guessed: true as const } : {})
  }
  return insertVoice(colors, colors.lines, main, voice)
}

function newWords(colors: SongColors, edit: Edit<'newWords'>): SongColors {
  const target = isIndex(edit.line, colors.lines.length) ? colors.lines[edit.line] : undefined
  // Only a main line is a shown line; a second voice is the user's own words.
  if (!target || target.under !== undefined || target.added) return colors
  const shown = fromShown(edit.shown)
  if (!shown) return colors
  // The old romaji splits were for the old line's romaji. Its times are the shown line's, so
  // it's timed or a guess as that is: the user's old times were for the old line, and keeping
  // the mark would show the shown line's guess (a plain song's) as if they'd set it.
  return withLine(colors, edit.line, {
    text: shown.text,
    start: shown.start,
    end: shown.end,
    words: keptSingers(target.words, shown.words),
    ...(shown.timed ? { timed: true as const } : {}),
    ...(shown.guessed ? { guessed: true as const } : {})
  })
}

/** Every kind of `FirstEdit`, so a new one can't be left out (the Record has to name them all). */
const FIRST_EDITS = new Set<string>(
  Object.keys({
    assign: true,
    splitWord: true,
    makeVoice: true,
    addVoice: true,
    romajiSplits: true
  } satisfies Record<FirstEdit['kind'], true>)
)

/** An edit that can ride in with an add (`FirstEdit`): main checks the page's, and the page its own. */
export function isFirstEdit(edit: Record<string, unknown>): edit is FirstEdit {
  return typeof edit.kind === 'string' && FIRST_EDITS.has(edit.kind)
}

function addLine(colors: SongColors, edit: Edit<'addLine'>): SongColors {
  const { at } = edit
  if (!Number.isInteger(at) || at < 0 || at > colors.lines.length) return colors
  // Between a main line and its second voices would leave them under the wrong line.
  if (colors.lines[at]?.under !== undefined) return colors
  const shown = fromShown(edit.shown)
  if (!shown) return colors

  const later = colors.lines
    .slice(at)
    .map((line) =>
      line.under !== undefined && line.under >= at ? { ...line, under: line.under + 1 } : line
    )
  const added: SongColors = { ...colors, lines: [...colors.lines.slice(0, at), shown, ...later] }
  const then: unknown = edit.then
  if (then === undefined) return added
  // Its first edit comes with it, or it isn't added at all; and it's an edit of this line.
  if (!isRecord(then) || !isFirstEdit(then) || then.line !== at) return colors
  const edited = change(added, then)
  return edited === added || same(added, edited) ? colors : edited
}

function setCast(colors: SongColors, edit: Edit<'setCast'>): SongColors {
  if (!Array.isArray(edit.cast)) return colors
  return { ...colors, cast: knownSingers(colors, edit.cast) }
}

/** "Guest Star" is extra:guest-star; one with no letters or digits of ours is extra:singer-1. */
function newSingerId(name: string, taken: ReadonlySet<string>): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug === '') {
    let n = 1
    while (taken.has(`${EXTRA_PREFIX}singer-${n}`)) n++
    return `${EXTRA_PREFIX}singer-${n}`
  }
  let id = `${EXTRA_PREFIX}${slug}`
  for (let n = 2; taken.has(id); n++) id = `${EXTRA_PREFIX}${slug}-${n}`
  return id
}

function addSinger(colors: SongColors, edit: Edit<'addSinger'>): SongColors {
  if (typeof edit.name !== 'string' || typeof edit.color !== 'string') return colors
  if (!HEX_COLOR.test(edit.color)) return colors
  // By whole characters, like the parser: a name in Japanese must not be cut in half.
  const name = Array.from(edit.name.trim()).slice(0, MAX_SINGER_NAME).join('').trim()
  if (name === '') return colors

  const lower = name.toLowerCase()
  const exists =
    colors.extra.some((singer) => singer.name.toLowerCase() === lower) ||
    CAST.some((singer) => singer.name.toLowerCase() === lower)
  if (exists) return colors

  const id = newSingerId(name, new Set(colors.extra.map((singer) => singer.id)))
  return { ...colors, extra: [...colors.extra, { id, name, color: edit.color }] }
}

function romajiSplits(colors: SongColors, edit: Edit<'romajiSplits'>): SongColors {
  const target = isIndex(edit.line, colors.lines.length) ? colors.lines[edit.line] : undefined
  if (!target) return colors
  if (edit.splits === null) {
    const line = { ...target }
    delete line.romajiSplits
    return withLine(colors, edit.line, line)
  }
  if (!Array.isArray(edit.splits)) return colors
  const offsets = (edit.splits as unknown[]).filter(
    (offset): offset is number =>
      typeof offset === 'number' && Number.isInteger(offset) && offset >= 0
  )
  const splits = [...new Set(offsets)].sort((a, b) => a - b)
  return withLine(colors, edit.line, { ...target, romajiSplits: splits })
}

function change(colors: SongColors, edit: ColorEdit): SongColors {
  switch (edit.kind) {
    case 'assign':
      return assign(colors, edit)
    case 'lineTime':
      return lineTime(colors, edit)
    case 'wordTime':
      return wordTime(colors, edit)
    case 'tapTime':
      return tapTime(colors, edit)
    case 'splitWord':
      return splitWord(colors, edit)
    case 'makeVoice':
      return makeVoice(colors, edit)
    case 'addVoice':
      return addVoice(colors, edit)
    case 'setCast':
      return setCast(colors, edit)
    case 'addSinger':
      return addSinger(colors, edit)
    case 'romajiSplits':
      return romajiSplits(colors, edit)
    case 'newWords':
      return newWords(colors, edit)
    case 'addLine':
      return addLine(colors, edit)
    case 'addLines':
      return addLines(colors, edit)
    case 'addBreak':
      return addBreak(colors, edit)
    case 'retype':
      return retype(colors, edit)
    case 'removeLine':
      return removeLine(colors, edit)
    case 'moveLine':
      return moveLine(colors, edit)
    case 'slideLine':
      return slideLine(colors, edit)
    case 'resetTimes':
      return resetTimes(colors, edit)
    case 'heardTimes':
      return heardTimes(colors, edit)
    default:
      return colors
  }
}

/**
 * The coding with one edit made. Never changes what it's given, and hands the very same
 * object back when the edit can't be made or wouldn't change anything.
 */
export function applyEdit(colors: SongColors, edit: ColorEdit): SongColors {
  const next = change(colors, edit)
  return same(colors, next) ? colors : next
}

export interface EditHistory {
  now(): SongColors
  /** The coding after the edit; the same one as before, left out of the history, when it changed nothing. */
  apply(edit: ColorEdit): SongColors
  /** The coding as it was before the last edit, or null when there's nothing to undo. */
  undo(): SongColors | null
  redo(): SongColors | null
  canUndo(): boolean
  canRedo(): boolean
}

export const EDIT_HISTORY_LIMIT = 200

export function createEditHistory(start: SongColors, limit = EDIT_HISTORY_LIMIT): EditHistory {
  let present = start
  const past: SongColors[] = []
  let future: SongColors[] = []

  return {
    now: () => present,
    apply(edit) {
      const next = applyEdit(present, edit)
      if (next === present) return present
      past.push(present)
      // The oldest goes first, so the last `limit` steps can always be undone.
      if (past.length > limit) past.shift()
      future = []
      present = next
      return present
    },
    undo() {
      const before = past.pop()
      if (!before) return null
      future.push(present)
      present = before
      return present
    },
    redo() {
      const after = future.pop()
      if (!after) return null
      past.push(present)
      present = after
      return present
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0
  }
}
