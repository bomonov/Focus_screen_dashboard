// Auto-sync types shared with the renderer.
// Keep this file free of runtime imports: the renderer compiles it too.

/** Why auto-sync can't work here, for Customize to explain. */
export type AutoSyncProblem =
  /** Windows, for now: there's no audio helper there. */
  | 'unsupported'
  /** The audio helper or the aligner (Python + Whisper) isn't installed. */
  | 'notInstalled'
  /** macOS won't let Focus Screen Audio hear other apps. */
  | 'denied'

/** Why a playlist can't be prepared right now, for Customize to explain. */
export type PrepareBlocker =
  /** Auto-sync is off, or can't run here (not installed, not allowed). */
  | 'autoSyncOff'
  /** Lyrics are hidden, so nothing is looked up. */
  | 'lyricsHidden'
  /** YouTube Music isn't the player on screen (it's the one the app can skip through). */
  | 'noYouTubeMusic'
  /** It plays a single song or a radio mix, not a playlist or album with an end. */
  | 'noPlaylist'

/** What YouTube Music is playing from, judged by its `list` id. */
export type PlaylistKind = 'liked' | 'album' | 'playlist' | 'radio'

/**
 * "LM" is Liked Music and "OLAK5uy_…" an album. Ids starting "RD" are mixes YouTube makes up
 * and keeps extending (a song's radio, My Mix, autoplay), except "RDCLAK5uy_…", which are
 * YouTube Music's own fixed playlists. null: not playing from a list at all.
 */
export function playlistKind(id: string | null | undefined): PlaylistKind | null {
  if (!id) return null
  if (id === 'LM') return 'liked'
  if (id.startsWith('OLAK5uy_')) return 'album'
  if (id.startsWith('RD') && !id.startsWith('RDCLAK5uy_')) return 'radio'
  return 'playlist'
}

/** Why the last run through a playlist ended. */
export type PrepareEnd =
  /** The playlist ran out (or the player moved on to another one). */
  | 'done'
  | 'stopped'
  /** A run started while nobody used the Mac stopped because someone does again. */
  | 'cameBack'
  /** Paused by something else for a while, e.g. YouTube Music asking "still listening?". */
  | 'paused'
  /** YouTube Music went away: tab closed, browser quit, or the extension lost touch. */
  | 'disconnected'
  | 'autoSyncOff'
  /** The safety limit on songs or hours. */
  | 'limit'
  /** The player couldn't be muted, so nothing was played. */
  | 'muteFailed'

/**
 * Preparing a playlist: YouTube Music plays it muted, songs that need timing play to the end
 * so auto-sync times them, and the rest are skipped.
 */
export interface PrepareState {
  running: boolean
  /** Who started the current (or last) run: Start in Customize, or nobody using the Mac. */
  trigger: 'manual' | 'away' | null
  /** Why it can't start now; null when it can (or is running). */
  blocker: PrepareBlocker | null
  /** How the last run ended; null while running or before any. */
  ended: PrepareEnd | null
  /** Songs this run played whose timings were saved, couldn't be made, or are still being made. */
  timed: number
  failed: number
  pending: number
  /** Songs passed by: already timed, no lyrics, instrumental, too long. */
  skipped: number
}

export type PrepareCommand = { kind: 'start' } | { kind: 'stop' }

export interface AutoSyncState {
  /** The Customize setting; nothing is recorded while it's off. */
  enabled: boolean
  problem: AutoSyncProblem | null
  /** The song being timed right now, for the lyrics card's note. */
  trackId: string | null
  stage: 'listening' | 'aligning' | null
  /** 0–1: how much of that song has been heard. */
  heard: number
  /**
   * Live sync on that song's first play: the line being sung now, as an index into its plain
   * lyrics' `lines` (stanza breaks included); null when nothing should be lit.
   */
  liveLine: number | null
}
