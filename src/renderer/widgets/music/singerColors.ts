// Singer colors as the Focus Screen draws them: fitted to the theme's cards, grouped into the
// parts of a line, and the romaji's split points. Pure, so the lyrics rows only have to draw.
import type { LyricsColors, SyncedWord } from '../../../main/services/lyrics/types'
import { castSinger } from '../../../main/services/lyrics/singers/cast'
import { contrast, fitContrast } from '../../theme/color'
// The same floor the weather icons use: a colored word is a graphic against the card, not text.
import { MIN_ICON_CONTRAST } from '../../theme/presets'
import type { GlideRow, LineWords } from './lyricsGlide'
import { soundWeight } from './wordWeights'

/** Each id's color, fitted to 3:1 against `card`; unknown ids are left out. */
export function singerHexes(
  ids: readonly string[],
  extra: LyricsColors['extra'],
  card: string
): string[] {
  const extras = new Map(extra.map((singer) => [singer.id, singer.color]))
  const hexes: string[] = []
  for (const id of ids) {
    // The cast first, so a song can't repaint a character by adding an extra with the same id.
    const color = castSinger(id)?.color ?? extras.get(id)
    if (color === undefined) continue
    hexes.push(
      contrast(color, card) >= MIN_ICON_CONTRAST
        ? color
        : fitContrast(color, card, MIN_ICON_CONTRAST)
    )
  }
  return hexes
}

/** Singer ids to their colors, as `singerHexes` gives them. */
export type SingerLookup = (ids: readonly string[]) => string[]

/**
 * `singerHexes` for one song on one theme, each set of singers worked out once: the lyrics ask
 * for the same few sets on every row, and each answer builds a map and fits colors.
 */
export function singerLookup(extra: LyricsColors['extra'], card: string): SingerLookup {
  const known = new Map<string, string[]>()
  return (ids) => {
    const key = ids.join('\n')
    let hexes = known.get(key)
    if (!hexes) {
      hexes = singerHexes(ids, extra, card)
      known.set(key, hexes)
    }
    return hexes
  }
}

/** Each singer once, in the order they first sing. */
export function singersInOrder(words: readonly (readonly string[] | null)[]): string[] {
  const order = new Set<string>()
  for (const ids of words) ids?.forEach((id) => order.add(id))
  return [...order]
}

export interface ColorPart {
  /** Word indices; `to` is exclusive. */
  from: number
  to: number
  colors: string[]
}

function sameSingers(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

/** Runs of neighbouring words with the same singers. Words with none get no part. */
export function colorParts(
  words: readonly (readonly string[] | null)[],
  hexes: (ids: readonly string[]) => string[]
): ColorPart[] {
  const parts: ColorPart[] = []
  let open: { ids: readonly string[]; part: ColorPart } | null = null
  words.forEach((ids, index) => {
    const colors = ids ? hexes(ids) : []
    // A word nobody sings (or whose singers have no color) ends the run: it isn't colored, so
    // the words either side of it aren't one part.
    if (!ids || colors.length === 0) {
      open = null
      return
    }
    if (open && sameSingers(open.ids, ids)) {
      open.part.to = index + 1
      return
    }
    const part: ColorPart = { from: index, to: index + 1, colors }
    parts.push(part)
    open = { ids, part }
  })
  return parts
}

/**
 * How a line's (or a second voice's) words are colored. Word by word when its singers line up
 * with the words it's drawn with; otherwise (plain lyrics, which have no words, or words worked
 * out because the coded ones no longer spell the line) one part across all of it, in the line's
 * singers in the order they first sing. null when nobody in it has a color.
 */
export function wordParts(
  singers: readonly (readonly string[] | null)[] | undefined,
  wordCount: number,
  ownWords: boolean,
  hexes: SingerLookup
): ColorPart[] | null {
  if (!singers) return null
  if (ownWords && singers.length === wordCount) {
    const parts = colorParts(singers, hexes)
    return parts.length > 0 ? parts : null
  }
  const colors = hexes(singersInOrder(singers))
  return colors.length > 0 ? [{ from: 0, to: wordCount, colors }] : null
}

/** `linear-gradient(90deg, …)` evenly across `colors`; one color gives a flat two-stop gradient. */
export function partGradient(colors: readonly string[]): string {
  const [only] = colors
  if (only === undefined) return ''
  if (colors.length === 1) return `linear-gradient(90deg, ${only} 0%, ${only} 100%)`
  const last = colors.length - 1
  const stops = colors.map((color, i) => `${color} ${+((i / last) * 100).toFixed(2)}%`)
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

/**
 * How a part's text is painted. One color is plain colored text, and the light over it a single
 * layer like the uncolored light; only a part sung by several needs its gradient as a second
 * layer under the light. Measured on 2026-11-03: two layers on every colored word (with second
 * voices popping too) cost the GPU process about 4.3 points over the same song uncolored; this
 * way, nothing measurable.
 */
export function partStyle(colors: readonly string[]): {
  blend: boolean
  style: Record<string, string>
} {
  const [only] = colors
  if (colors.length > 1) return { blend: true, style: { '--part-gradient': partGradient(colors) } }
  return { blend: false, style: { '--part-color': only ?? 'var(--text)' } }
}

/** A guess is sure only when its space is this near (in morae) to where the boundary falls. */
const SURE_WITHIN_MORAE = 1

/**
 * How many morae (kana beats) a romaji word sounds: one each vowel, so a long vowel or a pair
 * counts two, as its kana do (arigatou 5, ai 2; a vowel with a macron counts two); one a
 * syllabic n, which no vowel or y follows (hon 2, konnichiwa 5, shin'you 4); and one the
 * doubled consonant a small っ makes (kitte, icchi, matcha). Punctuation counts nothing.
 */
export function romajiMorae(word: string): number {
  const letters = [...word.toLowerCase()]
  let morae = 0
  letters.forEach((letter, i) => {
    const next = letters[i + 1] ?? ''
    if (/[aeiou]/.test(letter)) morae += 1
    else if (/[āīūēō]/.test(letter)) morae += 2
    else if (letter === 'n') morae += /[aeiouyāīūēō]/.test(next) ? 0 : 1
    else if (
      /[bcdfghjkmpqrstvwxz]/.test(letter) &&
      (next === letter || (letter === 't' && next === 'c'))
    ) {
      morae += 1
    }
  })
  return morae
}

/** Each space in the romaji, with how many morae come before it; and the romaji's whole count. */
function romajiSpaces(romaji: string): { spaces: { at: number; before: number }[]; morae: number } {
  const spaces: { at: number; before: number }[] = []
  let morae = 0
  let word = ''
  for (let at = 0; at < romaji.length; at += 1) {
    const char = romaji.charAt(at)
    if (!/\s/.test(char)) {
      word += char
      continue
    }
    morae += romajiMorae(word)
    word = ''
    spaces.push({ at, before: morae })
  }
  return { spaces, morae: morae + romajiMorae(word) }
}

const bare = (text: string): string => text.replace(/\s+/g, '')

/**
 * Where the romaji splits for each part: the user's points, else a sure guess, else null (the
 * romaji then gets one gradient). The guess goes by sound, not by letters: each boundary's share
 * of how long the Japanese sounds (`soundWeight`: beats, a kanji about two) is matched to the
 * space whose share of the romaji's morae is nearest, and only counts when that's within a mora.
 * Counting characters instead put 永遠に's cut after "hoshizora": a kanji is one character but
 * several sounds. Romaji's words don't line up with the Japanese ones, so a cut in the middle of
 * a word would put a wrong color on a sound. Each cut is the index of that space.
 */
export function romajiCuts(
  romaji: string,
  lineText: string,
  parts: readonly ColorPart[],
  wordTexts: readonly string[],
  userCuts: readonly number[] | null
): number[] | null {
  if (userCuts) return [...userCuts]
  if (parts.length < 2) return []
  // The words are weighed for the line: only when they spell it out.
  if (bare(lineText) === '' || bare(wordTexts.join('')) !== bare(lineText)) return null

  const weights = wordTexts.map((word) => (word.trim() === '' ? 0 : soundWeight(word)))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const { spaces, morae } = romajiSpaces(romaji)
  if (total === 0 || morae === 0) return null

  const cuts: number[] = []
  for (const part of parts.slice(1)) {
    const before = weights.slice(0, part.from).reduce((sum, weight) => sum + weight, 0)
    // Multiplied first: 2 × 5 ÷ 4 is exact where 2 ÷ 4 × 5 can drift on a tie.
    const target = (before * morae) / total
    let cut: number | null = null
    let distance = Infinity
    for (const space of spaces) {
      const off = Math.abs(space.before - target)
      // The small margin keeps a tie a tie (the earlier space wins) despite rounding.
      if (off < distance - 1e-9) {
        cut = space.at
        distance = off
      }
    }
    // Two boundaries on one space would leave a part with no romaji at all: not a sure guess.
    if (cut === null || distance > SURE_WITHIN_MORAE + 1e-9 || cut <= (cuts.at(-1) ?? 0)) {
      return null
    }
    cuts.push(cut)
  }
  return cuts
}

/** A piece of a line's romaji in one part's colors; it lights over words `from` to `to` (exclusive). */
export interface RomajiPiece {
  text: string
  colors: string[]
  from: number
  to: number
}

/** Cuts that split the romaji into exactly one piece per part, each with something in it. */
function fits(cuts: readonly number[] | null, parts: number, length: number): cuts is number[] {
  if (!cuts || cuts.length !== parts - 1) return false
  return cuts.every((cut, i) => cut > (cuts[i - 1] ?? 0) && cut < length)
}

/**
 * The romaji in its line's colors: cut where the singers change (`romajiCuts`), each piece in
 * its part's colors and lit over its part's words. A line it can't cut surely, or whose saved
 * cuts no longer fit its parts, is one piece in `line.colors` (the line's singers in order).
 */
export function romajiPieces(
  romaji: string,
  line: {
    text: string
    words: readonly string[]
    parts: readonly ColorPart[]
    colors: readonly string[]
  },
  userCuts: readonly number[] | null
): RomajiPiece[] | null {
  const { parts, words } = line
  if (parts.length === 0) return null
  const cuts = romajiCuts(romaji, line.text, parts, words, userCuts)
  if (fits(cuts, parts.length, romaji.length)) {
    const ends = [...cuts, romaji.length]
    return parts.map((part, i) => ({
      text: romaji.slice(i === 0 ? 0 : cuts[i - 1], ends[i]),
      colors: part.colors,
      // The pieces between them cover the whole line, words nobody sings included.
      from: i === 0 ? 0 : part.from,
      to: parts[i + 1]?.from ?? words.length
    }))
  }
  return line.colors.length > 0
    ? [{ text: romaji, colors: [...line.colors], from: 0, to: words.length }]
    : null
}

/** When a romaji piece lights: its first word's start until the next piece's (or the line's end). */
export function pieceSpan(
  words: readonly SyncedWord[],
  from: number,
  to: number
): { start: number; end: number } | null {
  const first = words[from]
  const end = to < words.length ? words[to]?.start : words.at(-1)?.end
  return first && end !== undefined ? { start: first.start, end } : null
}

/** How a row is drawn in its singers' colors: its words' parts, its romaji's pieces, its voices'. */
export interface RowPaint {
  /** null: the row's own words aren't colored (only a second voice under it is). */
  parts: ColorPart[] | null
  romaji: RomajiPiece[] | null
  /** One per second voice, same index as the row's `voices`. */
  voices: (ColorPart[] | null)[]
}

/** A row's colors, from its singers and the words it's drawn with; null for a row nobody colored. */
export function rowPaint(row: GlideRow, words: LineWords, hexes: SingerLookup): RowPaint | null {
  const parts = wordParts(row.singers, words.words.length, words.timed, hexes)
  const voices = (row.voices ?? []).map((voice) =>
    wordParts(voice.singers, voice.words.length, true, hexes)
  )
  if (!parts && voices.every((voice) => voice === null)) return null
  const romaji =
    parts && row.romaji
      ? romajiPieces(
          row.romaji,
          {
            text: row.text ?? '',
            words: words.words.map((word) => word.text),
            parts,
            colors: hexes(singersInOrder(row.singers ?? []))
          },
          row.romajiSplits ?? null
        )
      : null
  return { parts, romaji, voices }
}
