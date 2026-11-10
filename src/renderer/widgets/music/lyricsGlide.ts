// How lyric lines glide, after Apple Music's lyrics: the sung line is lit and the rest fade (and
// blur, further off) with distance. When the next line starts, the lines move up on a spring,
// the ones below the sung line each a beat after the one above, like a ripple running down.
import type { LyricsColors, SyncedLine, SyncedWord } from '../../../main/ipc'
import type { SpringConfig } from '../tabBarMotion'
import { hasCjk, japaneseWords, soundWeight } from './wordWeights'

/** A second voice: a backing line or echo sung over its main row, on its own words' times. */
export interface GlideVoice {
  words: SyncedWord[]
  /** Each word's singers (same index as `words`); null for a word nobody was given. */
  singers: (string[] | null)[]
}

export interface GlideRow {
  /** null: an intro or an instrumental break, drawn as three dots; '' a stanza gap. */
  text: string | null
  romaji: string | null
  /** Where the row starts in the song's lyrics time; null when it can't be jumped to. */
  timeSec: number | null
  /** Each word's timing, when it's known; otherwise the sweep is worked out (lineWords). */
  words?: SyncedWord[]
  /** Who sings each word, when the user colored the line: lined up with `words` when they're its own. */
  singers?: (string[] | null)[]
  /**
   * The user colored this line, so `words` are theirs: after "Make second voice" they're fewer
   * than the text has (the rest is sung under it as the voice), and they're drawn as they are.
   */
  coded?: true
  /** Second voices sung over this row, drawn smaller under it. */
  voices?: GlideVoice[]
  /** Where the user split the romaji between the line's parts. */
  romajiSplits?: number[]
}

/** An intro row (dots) goes first only when the singing doesn't start straight away. */
const INTRO_MIN_SEC = 2

/** Rows farther than this from the sung one all look the same (dimmest, most blurred). */
export const MAX_DISTANCE = 4
/** Rows this close to the sung one glide on their own; the rest are out of sight and jump. */
export const GLIDE_ROWS = 8
/** The ripple: each row below the sung one starts this much after the one above it. */
const STAGGER_MS = 45
const MAX_STAGGER_ROWS = 6

/** The spring the rows glide on, and how long a transition gives it to settle. */
export const GLIDE: SpringConfig = { response: 0.55, damping: 0.82 }
export const GLIDE_SEC = 0.9

/**
 * A line's coloring as its row carries it: its singers, its second voices and its romaji split.
 * Nothing at all for a line the user didn't color, so those rows are exactly as before.
 */
function lineColors(colors: LyricsColors | null, line: number): Partial<GlideRow> {
  if (!colors) return {}
  const singers = colors.lines[line]
  const voices = colors.voices
    .filter((voice) => voice.under === line)
    .map(({ words, singers }) => ({ words, singers }))
  const splits = colors.romajiSplits[line]
  return {
    ...(singers ? { singers, coded: true as const } : {}),
    ...(voices.length > 0 ? { voices } : {}),
    ...(splits ? { romajiSplits: splits } : {})
  }
}

/** Rows for synced lyrics; `romaji` has one entry per line ('' under a line without). */
export function syncedRows(
  lines: readonly SyncedLine[],
  romaji: readonly string[] | null,
  colors: LyricsColors | null = null
): GlideRow[] {
  const rows: GlideRow[] = lines.map((line, i) => ({
    text: line.text || null,
    romaji: romaji?.[i] || null,
    timeSec: line.timeSec,
    ...(line.words ? { words: line.words } : {}),
    ...lineColors(colors, i)
  }))
  return hasIntro(lines) ? [{ text: null, romaji: null, timeSec: 0 }, ...rows] : rows
}

/** When a second voice is sung: its first word's start to its last word's end. */
export function voiceSpan(voice: GlideVoice): { start: number; end: number } | null {
  const first = voice.words[0]
  const last = voice.words.at(-1)
  return first && last ? { start: first.start, end: last.end } : null
}

/**
 * Which of a row's second voices are being sung at `nowSec` (lyrics time): they light on their
 * own, also when one runs on past its main row.
 */
export function voicesNow(row: GlideRow, nowSec: number): number[] {
  const sung: number[] = []
  row.voices?.forEach((voice, i) => {
    const span = voiceSpan(voice)
    if (span && nowSec >= span.start && nowSec < span.end) sung.push(i)
  })
  return sung
}

function hasIntro(lines: readonly SyncedLine[]): boolean {
  return (lines[0]?.timeSec ?? 0) >= INTRO_MIN_SEC
}

/** The row being sung, from `syncedLineIndex`'s line (-1 before the first line). */
export function syncedRow(lines: readonly SyncedLine[], lineIndex: number): number {
  return hasIntro(lines) ? lineIndex + 1 : Math.max(lineIndex, 0)
}

/**
 * Which of a row's second voices get the light, and whether the row is lifted to the sung row's
 * brightness for them. On the sung row (`sung`) every voice does, each waiting for its own first
 * word; on any other row only those being sung now, past their line's time or ahead of it, and
 * then the row is lifted, so two rows can be lit at once.
 */
export function voiceLight(
  row: GlideRow,
  sung: boolean,
  nowSec: number | null
): { lit: number[]; lifted: boolean } {
  const voices = row.voices ?? []
  if (sung) return { lit: voices.map((_, i) => i), lifted: false }
  const lit = nowSec === null ? [] : voicesNow(row, nowSec)
  return { lit, lifted: lit.length > 0 }
}

/**
 * Rows for plain lyrics that live sync is following: no times, so none can be jumped to. A
 * colored line keeps its singers (drawn as one gradient: plain text has no words to line up).
 */
export function plainRows(
  lines: readonly string[],
  romaji: readonly string[] | null,
  colors: LyricsColors | null = null
): GlideRow[] {
  return lines.map((line, i) => {
    const singers = colors?.lines[i]
    return {
      text: line.trim(),
      romaji: romaji?.[i] || null,
      timeSec: null,
      ...(singers ? { singers } : {})
    }
  })
}

/** How far a row is from the sung one, for how lit it is: 0 sung, up to MAX_DISTANCE. */
export function rowDistance(row: number, current: number): number {
  return Math.min(Math.abs(row - current), MAX_DISTANCE)
}

/**
 * How long after a line change a row starts gliding. Rows above the sung one and the sung one
 * go together; each row below follows a beat later. Going back, or jumping more than a couple
 * of lines (a seek), everything moves at once.
 */
export function glideDelayMs(row: number, current: number, step: number): number {
  if (step < 0 || step > 2) return 0
  const below = row - current
  return below <= 0 ? 0 : Math.min(below, MAX_STAGGER_ROWS) * STAGGER_MS
}

/** Whether a row is near enough the sung one to glide, rather than jump while out of sight. */
export function glides(row: number, current: number): boolean {
  return Math.abs(row - current) <= GLIDE_ROWS
}

/**
 * Where to jump the song so a row is the one sung: its time less the lyrics offset (the lyrics
 * are looked up at position + offset), and a hair past it so the row is already on.
 */
export function seekTarget(timeSec: number, offsetSec: number): number {
  return Math.max(0, timeSec - offsetSec + 0.05)
}

/**
 * When an intro or instrumental break (a row without words) starts and ends, in lyrics time:
 * it lasts until the next row with a time, or until the song ends. null for any other row.
 */
export function breakSpan(
  rows: readonly GlideRow[],
  index: number,
  songEndSec: number
): { start: number; end: number } | null {
  const row = rows[index]
  if (!row || row.text !== null || row.timeSec === null) return null
  const next = rows.slice(index + 1).find((later) => later.timeSec !== null)
  const end = next?.timeSec ?? songEndSec
  return end > row.timeSec ? { start: row.timeSec, end } : null
}

/** How far through a break `nowSec` is, 0 at its start to 1 as the singing comes back. */
export function breakProgress(span: { start: number; end: number }, nowSec: number): number {
  return Math.min(Math.max((nowSec - span.start) / (span.end - span.start), 0), 1)
}

/**
 * How fast a line is sung, at most, in seconds per character: past this the line is done and
 * waits for the next one, rather than the sweep crawling through a pause. Kana and kanji each
 * carry a syllable or more; a letter is a fraction of one.
 */
const SECONDS_PER_CHAR = { cjk: 0.3, other: 0.11 }
/** No line sweeps faster than this, however short. */
const MIN_LINE_SEC = 1
/** The sweep ends this much before the next line starts, so it never runs into it. */
const LINE_GAP_SEC = 0.15

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/

/** A line's words: split at spaces, and Japanese (which has none) split into its words too. */
function splitWords(text: string): string[] {
  return (text.match(/\S+\s*/g) ?? []).flatMap((token) => {
    if (!hasCjk(token)) return [token]
    const core = token.trimEnd()
    const words = japaneseWords(core)
    // The space after stays on the last word, so the words still spell out the line.
    return words.map((word, i) => (i === words.length - 1 ? word + token.slice(core.length) : word))
  })
}

/**
 * Word timings worked out for a line nobody timed word by word: from its start to the next
 * line's (or as long as its length allows, if that's sooner), shared out by how long each word
 * sounds (syllables, or beats in Japanese, whose words are found first).
 */
export function estimateWords(text: string, start: number, nextStart: number | null): SyncedWord[] {
  return spreadWords(splitWords(text), text, start, nextStart)
}

/** `estimateWords` for words already split (a colored line's own, which its singers line up with). */
function spreadWords(
  tokens: readonly string[],
  text: string,
  start: number,
  nextStart: number | null
): SyncedWord[] {
  if (tokens.length === 0) return []
  const weights = tokens.map((token) => soundWeight(token))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  // The cap is still by characters: how fast a line may go was measured that way.
  const chars = tokens.reduce((sum, token) => sum + Math.max(1, [...token.trim()].length), 0)
  const perChar = CJK.test(text) ? SECONDS_PER_CHAR.cjk : SECONDS_PER_CHAR.other
  const longest = Math.max(MIN_LINE_SEC, chars * perChar)
  const room = nextStart === null ? longest : nextStart - LINE_GAP_SEC - start
  const length = Math.max(0.3, Math.min(longest, room))
  let at = start
  return tokens.map((token, i) => {
    const share = (length * (weights[i] ?? 1)) / total
    const word = { text: token, start: at, end: at + share }
    at += share
    return word
  })
}

/** Words this close together all start at once, as far as anyone can see. */
const STACKED_SEC = 0.05

/** Two or more words that all start at the same moment: timings that time nothing. */
function stacked(words: readonly SyncedWord[]): boolean {
  if (words.length < 2) return false
  const starts = words.map((word) => word.start)
  return Math.max(...starts) - Math.min(...starts) < STACKED_SEC
}

/** A row's words, and whether they're its own real timings (auto-sync's) rather than a guess. */
export interface LineWords {
  words: SyncedWord[]
  timed: boolean
}

/**
 * The words to sweep through on a row: a colored row's own words, or its own timed words when
 * they spell out its text (spaces aside), or else ones worked out from its start and the next
 * row's. A colored row's words are never second-guessed by its text: after "Make second voice"
 * the text still has the echo, but the words don't, and it's sung once, under the row.
 */
export function lineWords(row: GlideRow, nextStart: number | null): LineWords {
  if (row.text === null || row.timeSec === null) return { words: [], timed: false }
  const timed = row.words
  // Timings that put every word on one moment say nothing about when each is sung (auto-sync
  // couldn't place the line, and moving the line kept them piled up): lit by them, the whole
  // line lights at once. Its words are shared out over the line instead, like untimed words.
  if (timed && stacked(timed)) {
    const tokens = timed.map((word) => word.text)
    return { words: spreadWords(tokens, tokens.join(''), row.timeSec, nextStart), timed: false }
  }
  if (row.coded) return { words: timed ?? [], timed: true }
  const bare = (text: string): string => text.replace(/\s+/g, '')
  if (
    timed &&
    timed.length > 0 &&
    bare(timed.map((word) => word.text).join('')) === bare(row.text)
  ) {
    return { words: timed, timed: true }
  }
  return { words: estimateWords(row.text, row.timeSec, nextStart), timed: false }
}
