import { pairRomaji } from '../romaji'
import { learnReadings, type LearningExample } from './learn'
import type { ReadingEntries } from './messages'
import { type LearnedReadings, lineRomaji, textToRead } from './readings'
import type { Tokenize } from './tokenizer'

/** VocaDB's lyrics and romaji for a song, as saved on this computer. */
export interface Romanization {
  original: string
  romanized: string
}

export interface Maker {
  readonly tokenize: Tokenize
  /** Readings learned before, used as they are. */
  use(readings: ReadingEntries): void
  /** Learns readings from the VocaDB romaji saved for other songs (replacing what it knew). */
  learn(songs: readonly Romanization[]): ReadingEntries
  /** Romaji for each line: '' for one with no Japanese in it, null for one it can't read. */
  make(lines: readonly string[]): (string | null)[]
}

const JAPANESE = /[ぁ-ゖァ-ヺ㐀-鿿々\u{20000}-\u{3FFFF}]/u

export function createMaker(tokenize: Tokenize): Maker {
  let learned: LearnedReadings = new Map()
  return {
    tokenize,
    use(readings) {
      learned = new Map(readings)
    },
    learn(songs) {
      const examples: LearningExample[] = []
      // A song is often saved more than once (players report its length a second apart): its
      // words count once, or one VocaDB typo would look like two songs agreeing.
      const seen = new Set<string>()
      for (const song of songs) {
        if (seen.has(song.original)) continue
        seen.add(song.original)
        for (const pair of pairRomaji(song.original, song.romanized) ?? []) {
          examples.push({
            song: song.original,
            tokens: tokenize(textToRead(pair.sung)),
            romaji: pair.romaji
          })
        }
      }
      learned = learnReadings(examples)
      return [...learned]
    },
    make(lines) {
      return lines.map((line) =>
        JAPANESE.test(line) ? lineRomaji(tokenize(textToRead(line)), learned) : ''
      )
    }
  }
}
