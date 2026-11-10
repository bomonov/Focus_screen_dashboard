import type { MusicCommand, PlayerId, RepeatMode } from './types'

export interface PlayerInfo {
  id: PlayerId
  /** "Spotify", "Apple Music" */
  name: string
  repeatModes: readonly RepeatMode[]
}

/** A song as the adapter reads it, before the service adds the cover image. */
export interface AdapterTrack {
  id: string
  title: string
  artist: string
  album: string
  durationSec: number
  /** Where the adapter can find the cover. Only the adapter itself interprets it. */
  artworkRef: string | null
}

/** The song a player will play next, before the service adds its cover. */
export interface AdapterUpNext {
  title: string
  artist: string
  /** 0 when the player doesn't say. */
  durationSec: number
  /** Where the adapter can find the cover, as for AdapterTrack. */
  artworkRef: string | null
}

export interface PlayerSnapshot {
  status: 'playing' | 'paused' | 'stopped'
  /** null when stopped. */
  track: AdapterTrack | null
  positionSec: number
  shuffle: boolean
  repeat: RepeatMode
  /** The playlist the song plays from; only YouTube Music can tell, others leave it out. */
  playlistId?: string | null
  /** The song after this one, where the player says (YouTube Music's queue, the demo). */
  next?: AdapterUpNext | null
}

/** One reading of one player. */
export type PlayerReport = {
  player: PlayerId
  /** Unix epoch seconds when the player was read. */
  at: number
} &
  /** `installed: false` when the player isn't on this computer at all. */
  (
    | { kind: 'closed'; installed?: boolean }
    | { kind: 'denied' }
    /** Read failed this time (busy, timed out); the last good reading still stands. */
    | { kind: 'failed' }
    | { kind: 'open'; snapshot: PlayerSnapshot }
  )

/** Commands reach adapters with "previous" already decided: restart the song or go back one. */
export type AdapterCommand = MusicCommand | { kind: 'restart' }

/** One platform's way of reading and controlling music players. */
export interface MusicAdapter {
  readonly players: readonly PlayerInfo[]
  /** Starts reading; reports arrive whenever the adapter has news (about once a second). */
  start(onReport: (report: PlayerReport) => void): void
  /** Resolves with a fresh reading when the adapter can take one right after the command. */
  command(player: PlayerId, command: AdapterCommand): Promise<PlayerReport | null>
  /** Cover image bytes (PNG or JPEG) for the song now playing, or null. */
  loadArtwork(player: PlayerId, track: AdapterTrack): Promise<Uint8Array | null>
  dispose(): void
}
