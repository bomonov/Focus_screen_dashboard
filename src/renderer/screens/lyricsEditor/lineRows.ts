// The editor's line list and line as words to draw: who sings, in what colors, the romaji
// under each line, and times as a cue sheet writes them. Pure.
import type { CodedLine, SingerRef, SongColors } from '../../../main/ipc'
import { standIns } from '../../../main/services/lyrics/singers/added'
import { matchLines } from '../../../main/services/lyrics/singers/apply'
import { colorParts, type ColorPart, type SingerLookup } from '../../widgets/music/singerColors'
import { changedLines } from './editorView'

/**
 * A word's singers as drawn: "everyone" is the song's cast, but only once it has two (one
 * singer isn't everyone, so a word saved that way while the cast is smaller shows as nobody's).
 */
export function resolveSingers(
  singers: SingerRef | null,
  cast: readonly string[]
): string[] | null {
  if (singers === null) return null
  if (singers === 'everyone') return cast.length >= 2 ? [...cast] : null
  return singers.length > 0 ? [...singers] : null
}

/** Who sings in a line, for its badges: each singer once in the order they come in, and whether "everyone" does. */
export function lineSingers(
  line: CodedLine,
  cast: readonly string[]
): { ids: string[]; everyone: boolean } {
  const ids: string[] = []
  let everyone = false
  for (const word of line.words) {
    if (word.singers === 'everyone') {
      everyone ||= cast.length >= 2
      continue
    }
    word.singers?.forEach((id) => {
      if (!ids.includes(id)) ids.push(id)
    })
  }
  return { ids, everyone }
}

/** A line's colored runs of words, as the Focus Screen groups them. */
export function lineParts(
  line: CodedLine,
  cast: readonly string[],
  hexes: SingerLookup
): ColorPart[] {
  return colorParts(
    line.words.map((word) => resolveSingers(word.singers, cast)),
    hexes
  )
}

export interface LineRow {
  /** Its place in `lines`. */
  index: number
  /** Main lines count 1, 2, 3…; a second voice has no number of its own. */
  number: number | null
  voice: boolean
  /** Its text is no longer among the lyrics shown (they changed since it was coded). */
  changed: boolean
  /** The user added it ("＋ Add lines"). */
  added: boolean
  /** An added line the lyrics now have: a shown line matches it exactly or stands in for it. */
  alsoInLyrics: boolean
  /** A music break the user marked ("♪ Add break"): no words, no number. */
  instrumental?: true
  /** The words as coded: after "Make second voice" a main line's words no longer join to its text. */
  text: string
}

export function lineRows(colors: SongColors, shown: readonly string[]): LineRow[] {
  const changed = changedLines(colors, shown)
  const matches = matchLines(shown, colors.lines)
  const stoodIn = standIns(shown, colors, matches)
  const have = new Set(shown)
  let number = 0
  return colors.lines.map((line, index) => {
    const voice = line.under !== undefined
    const numbered = !voice && !line.instrumental
    if (numbered) number += 1
    return {
      index,
      number: numbered ? number : null,
      voice,
      changed: changed.has(index),
      added: line.added === true,
      alsoInLyrics:
        line.added === true && !line.instrumental && (have.has(line.text) || stoodIn.has(index)),
      text: line.words.map((word) => word.text).join(''),
      ...(line.instrumental ? { instrumental: true as const } : {})
    }
  })
}

/**
 * The romaji under each coded line (same index as `lines`), matched the way the Focus Screen
 * matches the coding to the lyrics shown; null for a second voice or a line without any.
 */
export function romajiByLine(
  colors: SongColors,
  shown: readonly string[],
  romaji: readonly string[] | null
): (string | null)[] {
  const byLine = colors.lines.map((): string | null => null)
  if (!romaji) return byLine
  matchLines(shown, colors.lines).forEach((coded, row) => {
    const text = romaji[row]
    if (coded !== undefined && text && text.trim() !== '') byLine[coded] = text
  })
  return byLine
}

/** A run of a line's words drawn together: a colored part's, or the uncolored ones between. */
export interface TextPiece {
  text: string
  /** null: nobody sings it (yet). */
  colors: string[] | null
}

/** A line's words as runs to draw, each part in one piece so its gradient runs across all of it. */
export function textPieces(words: readonly string[], parts: readonly ColorPart[]): TextPiece[] {
  const pieces: TextPiece[] = []
  let at = 0
  const plain = (to: number): void => {
    if (to > at) pieces.push({ text: words.slice(at, to).join(''), colors: null })
  }
  for (const part of parts) {
    plain(part.from)
    pieces.push({ text: words.slice(part.from, part.to).join(''), colors: [...part.colors] })
    at = part.to
  }
  plain(words.length)
  return pieces
}

/** "1:02.40": minutes, seconds and hundredths, the way the list and the toolbar show times. */
export function cueTime(sec: number): string {
  const hundredths = Math.max(0, Math.round((Number.isFinite(sec) ? sec : 0) * 100))
  const minutes = Math.floor(hundredths / 6000)
  const seconds = Math.floor((hundredths % 6000) / 100)
  const rest = hundredths % 100
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(rest).padStart(2, '0')}`
}
