import type { LyricsQuery } from './query'
import type { SongColors } from './singers/types'
import type { Lyrics } from './types'
import type { LyricsVersion } from './versions'

export type LookupResult =
  /** `seen`: every version the lookup took for the song, the shown one among them. */
  | { kind: 'found'; lyrics: Lyrics; seen?: LyricsVersion[] }
  | { kind: 'notFound' }
  /** Couldn't ask right now (offline, rate limited). Never cached. */
  | { kind: 'unavailable' }
  /**
   * The main source couldn't be asked, but these words stand in meanwhile (VocaDB's, while
   * LRCLIB is down): shown, never cached, and the main source is asked again later.
   */
  | { kind: 'interim'; lyrics: Lyrics }

/** Somewhere lyrics come from: LRCLIB, or the demo songs' built-in lyrics. */
export interface LyricsProvider {
  lookup(query: LyricsQuery): Promise<LookupResult>
  /** Whether answers are worth saving on disk. The demo's are built in. */
  readonly cacheable: boolean
  /**
   * The demo's own romaji for the lines shown (its own and any the user added), one entry per
   * line ('' for none), by each line's text, so the dev screen shows it with no network. Real
   * sources leave it out: their romaji comes from VocaDB.
   */
  romaji?(query: LyricsQuery, lines: readonly string[]): string[] | null
  /**
   * The demo's own singer coding for a song, since the dev screen has no saved ones. Real
   * sources leave it out: theirs comes from what the user colors, saved per song.
   */
  colors?(query: LyricsQuery): SongColors | null
}
