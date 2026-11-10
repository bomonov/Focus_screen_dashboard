import type { SyncedLine, SyncedWord } from '../lyrics/types'

/** What the aligner may be told; anything else it works out from the audio. */
export type AlignLanguage = 'ja' | 'ko' | 'zh' | 'en'

/**
 * One line's span in the song, from the aligner, with its words when it timed each of them;
 * null when it couldn't place the line.
 */
export type TimedLine = { start: number; end: number; words?: SyncedWord[] } | null

/** Words in one line, at most; a line with more is no line of lyrics. */
const MAX_WORDS = 200

/**
 * A line's words from the aligner or a saved file, which are untrusted: in order, each with its
 * text and a span that runs forward. Anything off and the line has no words (it still has its
 * start, and the sweep is worked out from that).
 */
export function parseWords(raw: unknown): SyncedWord[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_WORDS) return undefined
  const words: SyncedWord[] = []
  for (const item of raw as unknown[]) {
    if (typeof item !== 'object' || item === null) return undefined
    const { text, start, end } = item as Record<string, unknown>
    if (typeof text !== 'string' || text.length === 0 || text.length > 100) return undefined
    if (typeof start !== 'number' || typeof end !== 'number') return undefined
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || start < 0)
      return undefined
    words.push({ text, start, end })
  }
  return words
}

/** A gap at least this long between two lines shows the ♪ break. */
export const BREAK_GAP_SEC = 5
/** How far apart lines the aligner missed at the start or end are put. */
const GUESS_STEP_SEC = 2
/**
 * Past this share of lines unplaced, out of order, piled onto the line before or pinned to the
 * very end, the result isn't worth showing: plain lyrics beat wrong timings.
 */
const MAX_BAD_SHARE = 0.15
/** Two lines starting closer than this were piled up, not sung. */
const PILED_SEC = 0.05

/** For the log when timings are turned down: "20 of 73 lines piled up, 2 unplaced". */
export function describeTimings(timed: readonly TimedLine[], durationSec: number): string {
  const placed = timed.filter((span): span is NonNullable<TimedLine> => span !== null)
  let piled = 0
  placed.forEach((span, index) => {
    const before = placed[index - 1]
    if (
      (before && span.start - before.start < PILED_SEC) ||
      span.start >= durationSec - PILED_SEC
    ) {
      piled += 1
    }
  })
  return `${piled} of ${timed.length} lines piled up, ${timed.length - placed.length} unplaced`
}

const ENGLISH_WORDS = new Set([
  'the',
  'and',
  'you',
  'i',
  'to',
  'a',
  'me',
  'my',
  'it',
  'in',
  'of',
  'is',
  'that',
  'on',
  'your',
  'we',
  'be',
  'all',
  'for',
  'love',
  'so',
  'just',
  'what',
  'with',
  'don’t',
  "don't",
  'can',
  'this',
  'like',
  'no',
  'when',
  'know',
  'oh',
  'up',
  'now',
  'never',
  'feel',
  'are'
])

/**
 * The language to align in, from the lyrics' own script: kana means Japanese, Hangul Korean,
 * Chinese characters alone Chinese, and plenty of common English words English. Anything
 * else is left to the aligner, which listens for it.
 */
export function alignLanguage(lines: readonly string[]): AlignLanguage | null {
  const text = lines.join('\n')
  if (/[぀-ヿ]/.test(text)) return 'ja'
  if (/[가-힯]/.test(text)) return 'ko'
  if (/[一-鿿]/.test(text)) return 'zh'
  const words = text.toLowerCase().match(/[a-z’']+/g) ?? []
  if (words.length === 0) return null
  const english = words.filter((word) => ENGLISH_WORDS.has(word)).length
  return english / words.length >= 0.15 ? 'en' : null
}

/**
 * A line as it's sung, for the aligner: lyric sites add alternate readings in brackets
 * (鋭利(営利), 目盛(×メモリー)) and decorations (→ ～ ♪ quotes) that no one sings, and asking
 * the aligner to place words that never come throws off every line after them. The card still
 * shows the full line. A line that's all aside keeps its text.
 */
export function sungText(line: string): string {
  const sung = line
    .replace(/[(（[［【][^()（）[\]［］【】]*[)）\]］】]/g, ' ')
    .replace(/[→←×～〜♪♫☆★※"“”「」『』]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return sung || line.trim()
}

/** The lines the aligner is given: the plain lyrics without stanza breaks. */
export function lyricLines(plain: readonly string[]): string[] {
  return plain.map((line) => line.trim()).filter((line) => line !== '')
}

const CJK = /[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/
const LATIN = /[A-Za-z]/
const ALL_BRACKETS = /^\s*[(（[［【].*[)）\]］】]\s*$/
/**
 * Lyric sites often put a translation or romaji under every Japanese (or Korean, Chinese)
 * line. Past this share of lines being a Latin line right under such a line, those are
 * companions, not sung. A song that only switches to English now and then stays well below.
 */
const COMPANION_SHARE = 0.35
/** How long after its sung line a companion comes up, as lyric sites time them. */
const COMPANION_SEC = 0.01

/**
 * Which of `lyricLines(plain)` go with the sung line above them instead of being sung: the
 * translation or romaji under each line, and lines that are all brackets. The aligner never
 * sees them; asking it to find words no one sings throws off the lines after them.
 */
export function companionLines(texts: readonly string[]): boolean[] {
  const underCjk = texts.map(
    (text, index) =>
      index > 0 && !CJK.test(text) && LATIN.test(text) && CJK.test(texts[index - 1] ?? '')
  )
  const pairs = underCjk.filter(Boolean).length / Math.max(1, texts.length) >= COMPANION_SHARE
  return texts.map(
    (text, index) => ALL_BRACKETS.test(text) || (pairs && (underCjk[index] ?? false))
  )
}

/**
 * What live sync follows for `plain`: the sung lines exactly as the aligner gets them, and
 * where each one sits in `plain` (stanza breaks included), so the card can light it.
 */
export function followLines(plain: readonly string[]): {
  lines: string[]
  plainIndexes: number[]
} {
  const positions = plain.flatMap((line, index) => (line.trim() === '' ? [] : [index]))
  const texts = lyricLines(plain)
  const companions = companionLines(texts)
  const sung = texts.flatMap((_, index) => (companions[index] ? [] : [index]))
  return {
    lines: sung.map((index) => sungText(texts[index] ?? '')),
    plainIndexes: sung.map((index) => positions[index] ?? 0)
  }
}

/**
 * Synced lyrics from the aligner's spans for `lyricLines(plain)` (null for companions, which
 * follow the sung line above them). A few unplaced lines sit evenly between their neighbours,
 * a start that runs backwards is held at the one before, and long gaps get the ♪ break. Too
 * many unplaced, backwards or piled-up lines and there's nothing worth showing: null.
 */
export function toSyncedLines(
  plain: readonly string[],
  timed: readonly TimedLine[],
  durationSec: number,
  companions: readonly boolean[] = []
): SyncedLine[] | null {
  const texts = lyricLines(plain)
  if (texts.length === 0 || timed.length !== texts.length) return null
  const sungIndexes = texts.flatMap((_, index) => (companions[index] ? [] : [index]))
  const sung = syncSung(
    sungIndexes.map((index) => texts[index] ?? ''),
    sungIndexes.map((index) => timed[index] ?? null),
    durationSec
  )
  if (!sung) return null
  const lines: SyncedLine[] = []
  let next = 0
  let lastSung = 0
  texts.forEach((text, index) => {
    if (companions[index]) {
      lines.push({ timeSec: round(lastSung + COMPANION_SEC), text })
      return
    }
    // This line's own entry, with the ♪ break before it if there is one.
    while (next < sung.length) {
      const line = sung[next++]
      if (!line) break
      lines.push(line)
      if (line.text !== '') {
        lastSung = line.timeSec
        break
      }
    }
  })
  return lines
}

function syncSung(
  texts: readonly string[],
  timed: readonly TimedLine[],
  durationSec: number
): SyncedLine[] | null {
  if (texts.length === 0) return null
  const starts = timed.map((span) =>
    span && span.start >= 0 && span.start <= durationSec ? span.start : null
  )
  let bad = starts.filter((start) => start === null).length

  // Unplaced lines sit evenly between the placed ones around them. At either end there's only
  // one neighbour: a line before the first placed one goes a moment earlier, one after the last
  // starts as the line before it ends.
  for (let index = 0; index < starts.length; index++) {
    if (starts[index] !== null) continue
    let next = index
    while (next < starts.length && starts[next] === null) next++
    const count = next - index
    const before = index > 0 ? starts[index - 1] : null
    const after = next < starts.length ? starts[next] : null
    for (let k = 0; k < count; k++) {
      if (before != null && after != null) {
        starts[index + k] = before + ((after - before) * (k + 1)) / (count + 1)
      } else if (after != null) {
        starts[index + k] = Math.max(0, after - GUESS_STEP_SEC * (count - k))
      } else {
        const lastEnd = timed[index - 1]?.end ?? before ?? 0
        starts[index + k] = Math.min(durationSec, lastEnd + GUESS_STEP_SEC * k)
      }
    }
    index = next - 1
  }

  const lines: SyncedLine[] = []
  let previous = 0
  texts.forEach((text, index) => {
    let start = starts[index] ?? previous
    if (start < previous) {
      bad += 1
      start = previous
    } else if (
      timed[index] &&
      ((index > 0 && start - previous < PILED_SEC) || start >= durationSec - PILED_SEC)
    ) {
      bad += 1
    }
    const lastEnd = index > 0 ? timed[index - 1]?.end : undefined
    if (lastEnd !== undefined && start - lastEnd >= BREAK_GAP_SEC && lastEnd > previous) {
      lines.push({ timeSec: round(lastEnd), text: '' })
    }
    // Its words only when the aligner placed the line where it stands (not guessed or held).
    const own = timed[index]
    const words =
      own && own.start === start && own.words
        ? own.words.map((word) => ({
            text: word.text,
            start: round(word.start),
            end: round(word.end)
          }))
        : undefined
    lines.push(words ? { timeSec: round(start), text, words } : { timeSec: round(start), text })
    previous = start
  })
  return bad / texts.length > MAX_BAD_SHARE ? null : lines
}

const round = (seconds: number): number => Math.round(seconds * 1000) / 1000
