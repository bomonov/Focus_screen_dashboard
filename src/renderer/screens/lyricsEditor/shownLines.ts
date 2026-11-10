// The lyrics' lines the coding has lost track of: shown lines no coded line matches (a line
// the lyrics gained, or a typo they fixed), where each goes in the coding, and which changed
// line each could replace ("Use the new words"), by how alike they are. Matched the way the
// Focus Screen matches. Pure.
import type {
  ColorEditorState,
  ColorEdit,
  Lyrics,
  LyricsState,
  ShownLine,
  SongColors
} from '../../../main/ipc'
import { standIns } from '../../../main/services/lyrics/singers/added'
import { matchLines } from '../../../main/services/lyrics/singers/apply'
import { isFirstEdit } from '../../../main/services/lyrics/singers/edit'
import { ownLyricsOf } from '../../../main/services/lyrics/types'
import { alikePairs as alikeIndices } from '../../../main/services/lyrics/singers/likeness'
import { changedLines } from './editorView'

/** A shown line no coded line matches. */
export interface NewLine {
  /** Its place among the shown lines. */
  shown: number
  text: string
  /** Where it goes in the coding's `lines` when added: before the next line that matched. */
  place: number
}

const isBlank = (text: string): boolean => text.trim() === ''

/** Where a line's block ends: after it and the second voices right under it. */
function blockEnd(colors: SongColors, index: number): number {
  let end = index + 1
  while (colors.lines[end]?.under === index) end++
  return end
}

/**
 * Changed lines paired with new shown lines between the same two matched lines: in order, each
 * once, the most alike that are alike at all. A line the lyrics gained in the same place as
 * one they edited is left unpaired, not handed the edited line's singers.
 */
function alikePairs(
  colors: SongColors,
  shown: readonly string[],
  lines: readonly number[],
  rows: readonly number[]
): Map<number, number> {
  const pairs = new Map<number, number>()
  for (const [i, j] of alikeIndices(
    lines.map((line) => colors.lines[line]?.text ?? ''),
    rows.map((row) => shown[row] ?? '')
  )) {
    const line = lines[i]
    const row = rows[j]
    if (line !== undefined && row !== undefined) pairs.set(line, row)
  }
  return pairs
}

/** The stretch between two matched lines: where it starts in the coding, its new rows and pairs. */
interface Gap {
  start: number
  rows: number[]
  /** Changed line → the new row most like it. */
  pairs: Map<number, number>
}

function gaps(colors: SongColors, shown: readonly string[]): Gap[] {
  const matches = matchLines(shown, colors.lines)
  const changed = changedLines(colors, shown)
  // A shown line an added line stands in for is that verse, not a new line.
  const stoodIn = new Set(standIns(shown, colors, matches).values())
  const anchors = [
    { row: -1, index: -1 },
    ...matches.flatMap((index, row) => (index === undefined ? [] : [{ row, index }])),
    { row: shown.length, index: colors.lines.length }
  ]
  return anchors.slice(1).flatMap((after, k) => {
    const before = anchors[k]
    if (!before) return []
    const lines: number[] = []
    for (let index = before.index + 1; index < after.index; index++) {
      if (changed.has(index)) lines.push(index)
    }
    const rows: number[] = []
    for (let row = before.row + 1; row < after.row; row++) {
      if (!isBlank(shown[row] ?? '') && matches[row] === undefined && !stoodIn.has(row))
        rows.push(row)
    }
    const start = before.index < 0 ? 0 : blockEnd(colors, before.index)
    return [{ start, rows, pairs: alikePairs(colors, shown, lines, rows) }]
  })
}

/**
 * Shown lines no coded line matches, each with where it goes in the coding: right after the
 * changed line it's most like (it's that line, edited), else after the last such pair before
 * it, else right after the matched line before it. So the list reads in the order it's sung.
 */
export function newLines(colors: SongColors, shown: readonly string[]): NewLine[] {
  return gaps(colors, shown).flatMap((gap) => {
    const paired = [...gap.pairs].map(([line, row]) => ({ end: blockEnd(colors, line), row }))
    return gap.rows.map((row): NewLine => {
      const own = paired.find((pair) => pair.row === row)
      const before = paired.filter((pair) => pair.row < row).at(-1)
      return { shown: row, text: shown[row] ?? '', place: (own ?? before)?.end ?? gap.start }
    })
  })
}

/**
 * Which shown line each changed line could take the words of ("Use the new words"): the new
 * line most like it between the same two matched lines. Coded line → shown line.
 */
export function newWordsFor(colors: SongColors, shown: readonly string[]): Map<number, number> {
  return new Map(gaps(colors, shown).flatMap((gap) => [...gap.pairs]))
}

/**
 * The shown line a coded line of the lyrics' own is matched to (by its place among the shown
 * lines), as the screen matches them, so a repeated line is told apart; null for a second voice,
 * an added line, or a line the lyrics no longer have.
 */
export function ownRowOf(
  colors: SongColors,
  index: number,
  shown: readonly string[]
): number | null {
  const line = colors.lines[index]
  if (!line || line.under !== undefined || line.added) return null
  const row = matchLines(shown, colors.lines).indexOf(index)
  return row < 0 ? null : row
}

/** A row of the editor's list: a coded line (its place in `lines`), or a shown line not coded yet. */
export type ListEntry = { kind: 'coded'; index: number } | { kind: 'new'; line: NewLine }

export function listEntries(colors: SongColors, fresh: readonly NewLine[]): ListEntry[] {
  const entries: ListEntry[] = []
  const at = (place: number): void => {
    for (const line of fresh) if (line.place === place) entries.push({ kind: 'new', line })
  }
  colors.lines.forEach((_, index) => {
    at(index)
    entries.push({ kind: 'coded', index })
  })
  at(colors.lines.length)
  return entries
}

/**
 * An edit made on a shown line not coded yet: it's added to the coding with it, in the same
 * step, so looking at a line never changes the coding and one undo takes both back. Edits for
 * other lines (or none) go as they are. Only its words and singers can come with it
 * (`FirstEdit`): anything else on it is nothing (null) until it's in the coding.
 */
export function onNewLine(edit: ColorEdit, line: NewLine, words: ShownLine): ColorEdit | null {
  if (edit.kind === 'addLine' || edit.kind === 'newWords') return edit
  if (!('line' in edit) || edit.line !== line.place) return edit
  return isFirstEdit(edit) ? { kind: 'addLine', at: line.place, shown: words, then: edit } : null
}

/**
 * The lyrics on screen, with their times, while they're the editor's song's: it's playing and
 * they're the lines the editor was given. A new line's words and times come from them.
 */
export function editorLyrics(
  state: Pick<ColorEditorState, 'playingThis' | 'shownLines'>,
  lyrics: LyricsState | null
): Extract<Lyrics, { kind: 'synced' | 'plain' }> | null {
  // The lyrics' own lines: the shown ones may have the user's added lines among them.
  const found = lyrics?.status === 'found' ? ownLyricsOf(lyrics) : null
  if (!state.playingThis || !found || found.kind === 'instrumental') return null
  const texts: readonly string[] =
    found.kind === 'synced' ? found.lines.map((line) => line.text) : found.lines
  const same =
    texts.length === state.shownLines.length &&
    texts.every((text, i) => text === state.shownLines[i])
  return same ? found : null
}
