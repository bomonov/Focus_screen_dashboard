// Lyrics types shared with the renderer, plus the line lookup both sides need.
// Keep this file free of imports: the renderer compiles it too.

export interface SyncedLine {
  /** Seconds from the start of the song. */
  timeSec: number
  /** Empty for an instrumental break. */
  text: string
  /** Each word's own timing, when it's known (auto-sync hears every word); else absent. */
  words?: SyncedWord[]
}

/** A word in a synced line, as sung: its text (spaces included) and when, in song seconds. */
export interface SyncedWord {
  text: string
  start: number
  end: number
}

/**
 * Where lyrics came from, for the "Synced lyrics · LRCLIB" note under them. 'vocadb' is plain
 * text from VocaDB, asked only when LRCLIB hasn't got the song. 'ytmusic' is the plain text
 * YouTube Music shows in its Lyrics tab, read by the extension, for songs neither has. 'autosync' is plain text with
 * line timings worked out on this Mac by listening to the song.
 */
export type LyricsSource = 'lrclib' | 'vocadb' | 'ytmusic' | 'demo' | 'autosync'

/**
 * Which LRCLIB record lyrics came from: its id (to fetch it again), whom it's credited to, and
 * its length. A re-check tells the singers' own version from another name's by it.
 */
export interface LyricsFrom {
  id: number
  artist: string
  durationSec: number
  /** The player's singers, or only other names VocaDB has for the song. */
  credit: 'singers' | 'others'
}

export type Lyrics =
  | {
      kind: 'synced'
      lines: SyncedLine[]
      source: LyricsSource
      from?: LyricsFrom
      /** Auto-synced words that came from VocaDB or YouTube Music, credited for them. */
      wordsFrom?: 'vocadb' | 'ytmusic'
      /** Who YouTube Music licensed the words from ("Musixmatch"). */
      credit?: string
      /**
       * Auto-synced: the plain lyrics the timings were made for, so the song can be timed again
       * (timings from before word timing existed are, once, for their words).
       */
      plain?: string[]
    }
  /** No timestamps: the card scrolls these along with the song's progress. Empty strings are stanza breaks. */
  | {
      kind: 'plain'
      lines: string[]
      source: LyricsSource
      from?: LyricsFrom
      /** Who YouTube Music licensed the words from ("Musixmatch"), for 'ytmusic'. */
      credit?: string
    }
  | { kind: 'instrumental'; source: LyricsSource; from?: LyricsFrom }

/** Plain lyrics auto-sync may time: real songs' words, never the demo's. */
export function canAutoSync(source: LyricsSource): boolean {
  return source === 'lrclib' || source === 'vocadb' || source === 'ytmusic'
}

export type LyricsStatus =
  /** Nothing to look up: no song, an ad, or lyrics are hidden. */
  | 'idle'
  | 'loading'
  | 'found'
  | 'notFound'
  /** LRCLIB couldn't be reached or is rate limiting us; tried again later. */
  | 'unavailable'

export interface LyricsState {
  /** The song these lyrics belong to (`Track.id`), so a stale push never lands on the next song. */
  trackId: string | null
  status: LyricsStatus
  /** Set when status is 'found'. */
  lyrics: Lyrics | null
  /** Saved per song. Added to the song position before picking a line: positive shows lines sooner. */
  offsetSec: number
  /**
   * Romaji under each of the lyrics' lines (same index), for Japanese songs VocaDB has a
   * romanization of; '' under a line it couldn't be matched to. null when there's none.
   */
  romaji: string[] | null
  /** Whose the romaji is, when there's any (the demo's own says nothing). */
  romajiFrom?: RomajiSource
  /** Who sings which part, when the user has colored this song (and its lines still match). */
  colors?: LyricsColors | null
}

/**
 * The user's singer coloring as the Focus Screen needs it, lined up with the lyrics shown.
 * It's the saved coding with "everyone" already worked out, so the renderer needs no cast.
 */
export interface LyricsColors {
  /**
   * Per shown line (same index): each word's singer ids, resolved ("everyone" → the cast); null
   * for a word nobody was given, or a line that isn't colored. A colored line's words are the
   * shown line's `words`, which after "Make second voice" are fewer than its text.
   */
  lines: ((string[] | null)[] | null)[]
  /** Second voices, each under a shown line. */
  voices: { under: number; words: SyncedWord[]; singers: (string[] | null)[] }[]
  /** Romaji split points per shown line, where the user set them. */
  romajiSplits: (number[] | null)[]
  /** Singers the user added to this song, so a color is known for their ids. */
  extra: { id: string; name: string; color: string }[]
  /**
   * The lyrics' own rows, just as `colorLyrics` gives them without the added lines the lyrics
   * haven't got: synced lyrics on the coding's times, and plain lyrics synced on the user's times
   * once every one of their lines is timed, else plain. The shown rows are synced or plain as
   * these are. Set only when added lines are shown (put in, or standing in for a row). Auto-sync
   * and the editor read these.
   */
  own?: Extract<Lyrics, { kind: 'synced' | 'plain' }>
}

/**
 * The lyrics' own lines, without any the user added: what auto-sync times, the editor codes and
 * the version picker tags "showing now". The shown `lyrics` may have added lines among them.
 */
export function ownLyricsOf(state: Pick<LyricsState, 'lyrics' | 'colors'>): Lyrics | null {
  return state.colors?.own ?? state.lyrics
}

/**
 * VocaDB's (written by people), made from a dictionary on this computer for lines VocaDB has
 * none for, or both.
 */
export type RomajiSource = 'vocadb' | 'dictionary' | 'both'

export type LyricsCommand =
  | { kind: 'setVisible'; on: boolean }
  | { kind: 'setAlbumInk'; on: boolean }
  | { kind: 'nudgeOffset'; direction: 'earlier' | 'later' }
  | { kind: 'resetOffset' }

/** One press of the lyrics timing keys. */
export const OFFSET_STEP_SEC = 0.5
/** Past this the song is simply a different recording. */
export const MAX_OFFSET_SEC = 30

export const NO_LYRICS: LyricsState = {
  trackId: null,
  status: 'idle',
  lyrics: null,
  offsetSec: 0,
  romaji: null
}

/** Index of the line on screen at `timeSec` (song time, offset already applied); -1 before the first. */
export function syncedLineIndex(lines: readonly SyncedLine[], timeSec: number): number {
  let low = 0
  let high = lines.length - 1
  let found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if ((lines[middle]?.timeSec ?? Infinity) <= timeSec) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found
}
