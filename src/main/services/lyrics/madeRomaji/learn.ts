// Readings learned from the VocaDB romaji already saved on this computer: where songs' romaji
// keeps reading a word other than the dictionary does (水面 as minamo, 身体 as karada), songs
// without romaji read it that way too. Measured leaving each of the user's 183 songs out in turn:
// 87.2% → 87.75% of 7,501 lines exact. It only learns from a line the swap makes exactly right,
// as learning from any line picked up neighbours' letters (高 as "aka", 口 as "guchi").
import { type LearnedReadings, type Token, spell } from './readings'

/** A line, as the dictionary splits it, and the romaji VocaDB has for it. */
export interface LearningExample {
  /** Which song it's from: a reading counts only once more than one song uses it. */
  song: string
  tokens: readonly Token[]
  romaji: string
}

const MIN_SONGS = 2
/** Of every time the word was read in VocaDB's romaji, how often it was read this way. */
const MIN_SHARE = 0.6

/** Romaji letters only, spelled one way: macrons doubled (ō → ou), を's "wo" as "o". */
export function romajiLetters(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[āâ]/g, 'aa')
    .replace(/[īî]/g, 'ii')
    .replace(/[ūû]/g, 'uu')
    .replace(/[ēê]/g, 'ee')
    .replace(/[ōô]/g, 'ou')
    .replace(/\bwo\b/g, 'o')
    .replace(/[^a-z]/g, '')
}

/** For each place in `a`, the place in `b` it lines up with (edit distance, traced back). */
function lineUp(a: string, b: string): Int32Array {
  const width = b.length + 1
  const cost = new Int32Array((a.length + 1) * width)
  for (let j = 0; j <= b.length; j++) cost[j] = j
  for (let i = 1; i <= a.length; i++) {
    cost[i * width] = i
    for (let j = 1; j <= b.length; j++) {
      const same = a[i - 1] === b[j - 1] ? 0 : 1
      cost[i * width + j] = Math.min(
        (cost[(i - 1) * width + j] ?? 0) + 1,
        (cost[i * width + j - 1] ?? 0) + 1,
        (cost[(i - 1) * width + j - 1] ?? 0) + same
      )
    }
  }
  const at = new Int32Array(a.length + 1)
  at[a.length] = b.length
  let i = a.length
  let j = b.length
  while (i > 0 || j > 0) {
    const here = cost[i * width + j] ?? 0
    const same = i > 0 && j > 0 && a[i - 1] === b[j - 1] ? 0 : 1
    if (i > 0 && j > 0 && here === (cost[(i - 1) * width + j - 1] ?? 0) + same) {
      i--
      j--
      at[i] = j
    } else if (i > 0 && here === (cost[(i - 1) * width + j] ?? 0) + 1) {
      i--
      at[i] = j
    } else j--
  }
  return at
}

/** How each word VocaDB read differently was read, per song: key → reading → song → times. */
type Tally = Map<string, Map<string, Map<string, number>>>

function tallyLine(tally: Tally, example: LearningExample): void {
  const pieces = spell(example.tokens)
  const theirs = romajiLetters(example.romaji)
  if (!pieces || !theirs) return
  const spans: [number, number][] = []
  let ours = ''
  for (const piece of pieces) {
    const letters = romajiLetters(piece.text)
    spans.push([ours.length, ours.length + letters.length])
    ours += letters
  }
  if (!ours) return
  const at = lineUp(ours, theirs)
  pieces.forEach((piece, k) => {
    const [start, end] = spans[k] ?? [0, 0]
    // Not a word ending in っ: its doubled letter belongs to the next word.
    if (!piece.key || end === start || /[っッ]$/.test(piece.token.kana ?? '')) return
    const read = theirs.slice(at[start] ?? 0, at[end] ?? 0)
    if (!read || ours.slice(0, start) + read + ours.slice(end) !== theirs) return
    const readings = tally.get(piece.key) ?? new Map<string, Map<string, number>>()
    const songs = readings.get(read) ?? new Map<string, number>()
    songs.set(example.song, (songs.get(example.song) ?? 0) + 1)
    readings.set(read, songs)
    tally.set(piece.key, readings)
  })
}

export function learnReadings(examples: Iterable<LearningExample>): LearnedReadings {
  const tally: Tally = new Map()
  for (const example of examples) tallyLine(tally, example)
  const learned = new Map<string, string>()
  for (const [key, readings] of tally) {
    const ours = key.slice(key.lastIndexOf('|') + 1)
    let total = 0
    let best: { read: string; times: number } | null = null
    for (const [read, songs] of readings) {
      const times = [...songs.values()].reduce((sum, n) => sum + n, 0)
      total += times
      if (songs.size >= MIN_SONGS && times > (best?.times ?? 0)) best = { read, times }
    }
    if (best && best.read !== ours && best.times / total >= MIN_SHARE) learned.set(key, best.read)
  }
  return learned
}
