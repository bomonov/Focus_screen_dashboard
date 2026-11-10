// Music types shared with the renderer, plus the one calculation both sides need.
// Keep this file free of imports: the renderer compiles it too.

export type PlayerId = 'spotify' | 'appleMusic' | 'ytmChrome' | 'ytmSafari' | 'demo'
export type RepeatMode = 'off' | 'all' | 'one'

/** The track id players use while an ad plays (YouTube Music); it has no lyrics. */
export const AD_TRACK_ID = 'ytm:ad'

export interface Track {
  /** Stable for one song in one player (Spotify URI, Music persistent ID). */
  id: string
  title: string
  /** Empty when the player doesn't know. */
  artist: string
  album: string
  /** 0 when the player doesn't know, e.g. a radio stream. */
  durationSec: number
  /** A JPEG data URL; null while it loads or when the song has no cover. */
  artwork: string | null
}

/** The song a player will play after this one ("Up next"). */
export interface UpNext {
  title: string
  artist: string
  /** 0 when the player doesn't say. */
  durationSec: number
  /** A data URL; null while it loads or when there's none. */
  artwork: string | null
}

/** A player is open but we can't read it. */
export interface MusicProblem {
  kind: 'automationDenied'
  playerName: string
}

export interface PlaybackState {
  /** The player on screen; null when none is open. */
  player: { id: PlayerId; name: string } | null
  /** null when the player is open but stopped. */
  track: Track | null
  playing: boolean
  /** Position at `positionAt`. While playing, both sides count on from there. */
  positionSec: number
  /** Unix epoch seconds. */
  positionAt: number
  shuffle: boolean
  repeat: RepeatMode
  /** What the repeat button cycles through: Spotify can't repeat one song from a script. */
  repeatModes: RepeatMode[]
  problem: MusicProblem | null
  /** Players this computer can show, for the "nothing playing" hint. Empty = no music support yet. */
  supportedPlayers: string[]
  /**
   * YouTube Music's id for the playlist the song plays from (the page URL's `list`); null when
   * it plays from none. Left out for players that can't tell. Lets a run through a playlist
   * notice when the player has moved on to something else.
   */
  playlistId?: string | null
  /** The song after this one, where the player says (YouTube Music, the demo); else null. */
  next?: UpNext | null
}

/** What the renderer may ask for. Anything else is dropped by the main process. */
export type MusicCommand =
  | { kind: 'playPause' }
  | { kind: 'next' }
  /** Back to the start of the song, or to the previous one when it just started. */
  | { kind: 'previous' }
  | { kind: 'setShuffle'; on: boolean }
  | { kind: 'setRepeat'; mode: RepeatMode }
  /** Jumps to a point in the song: dragging or clicking the progress bar. */
  | { kind: 'seek'; positionSec: number }

/** A song can be jumped around in when it has a length and isn't an ad (YouTube won't skip those). */
export function canSeek(track: Track | null): boolean {
  return track !== null && track.id !== AD_TRACK_ID && track.durationSec > 0
}

/** The furthest a jump goes: just short of the end, so the song isn't over the moment it lands. */
export function seekEnd(track: Track): number {
  return Math.max(0, track.durationSec - 1)
}

/** Song position at `now`, counted on from the last reading while playing. */
export function positionAt(state: PlaybackState, now: number): number {
  const since = state.playing ? Math.max(0, now - state.positionAt) : 0
  const position = state.positionSec + since
  const duration = state.track?.durationSec ?? 0
  return duration > 0 ? Math.min(position, duration) : position
}
