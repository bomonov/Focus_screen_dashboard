// What the main process and the romaji maker's own process (worker.ts) send each other.
import type { Romanization } from './maker'

/** Learned readings as [key, reading] pairs (`learnedKey`), as they're sent and saved. */
export type ReadingEntries = [string, string][]

export type MakerRequest =
  /** Readings learned before: used at once, as learning again takes seconds. */
  | { kind: 'readings'; readings: ReadingEntries }
  | { kind: 'learn'; songs: Romanization[] }
  | { kind: 'make'; id: number; lines: string[] }

export type MakerReply =
  | { kind: 'made'; id: number; romaji: (string | null)[] }
  | { kind: 'failed'; id: number }
  | { kind: 'learned'; readings: ReadingEntries }
  /** Learning didn't work (the dictionary didn't load, or it threw): what was used stays. */
  | { kind: 'learnFailed' }
