import type { AdapterTrack, PlayerReport, PlayerSnapshot } from '../adapter'
import { parseRepeatMode } from '../parse'

export type MacPlayer = 'spotify' | 'appleMusic'

/** Titles longer than this are cut; nothing on screen could show more anyway. */
const MAX_TEXT = 300
/** Our script stamps each reading; a stamp further than this from our clock is ignored. */
const MAX_CLOCK_GAP_SEC = 10
const SPOTIFY_ARTWORK_HOST = 'i.scdn.co'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : ''
}

function seconds(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * The only cover URLs we fetch: Spotify's own image server, over https. Older Spotify
 * versions hand out http:// links to the same host.
 */
export function spotifyArtworkUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.hostname !== SPOTIFY_ARTWORK_HOST) return null
  if (url.protocol === 'http:') url.protocol = 'https:'
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
  return url.href
}

function status(value: unknown): PlayerSnapshot['status'] | null {
  switch (value) {
    // Music's seek states count as playing as far as the screen cares.
    case 'playing':
    case 'fast forwarding':
    case 'rewinding':
      return 'playing'
    case 'paused':
    case 'stopped':
      return value
    default:
      return null
  }
}

function spotifyTrack(raw: Record<string, unknown>): AdapterTrack | null {
  const title = text(raw.name)
  if (!title) return null
  const artist = text(raw.artist)
  const album = text(raw.album)
  return {
    id: text(raw.id) || `${title}\n${artist}\n${album}`,
    title,
    artist,
    album,
    // Spotify reports milliseconds.
    durationSec: seconds(raw.duration) / 1000,
    artworkRef: spotifyArtworkUrl(raw.artworkUrl)
  }
}

function musicTrack(raw: Record<string, unknown>): AdapterTrack | null {
  const name = text(raw.name)
  const stream = text(raw.stream)
  const persistentId = text(raw.id)
  // On a radio stream the track is the station; the song is in the stream title.
  const title = stream || name
  if (!title) return null
  const artist = text(raw.artist)
  const album = stream ? name : text(raw.album)
  return {
    id: persistentId ? `${persistentId}${stream ? `\n${stream}` : ''}` : `${title}\n${artist}`,
    title,
    artist,
    album,
    durationSec: seconds(raw.duration),
    // Music hands over covers by persistent ID; a stream's cover isn't reachable that way.
    artworkRef: persistentId && !stream ? persistentId : null
  }
}

function snapshot(player: MacPlayer, raw: Record<string, unknown>): PlayerSnapshot | null {
  const state = status(raw.state)
  if (!state) return null
  const track =
    state !== 'stopped' && isRecord(raw.track)
      ? player === 'spotify'
        ? spotifyTrack(raw.track)
        : musicTrack(raw.track)
      : null
  return {
    status: state,
    track,
    positionSec: seconds(raw.position),
    shuffle: raw.shuffle === true,
    // Spotify's script only knows repeat on/off.
    repeat:
      player === 'spotify'
        ? raw.repeat === true
          ? 'all'
          : 'off'
        : (parseRepeatMode(raw.repeat) ?? 'off')
  }
}

/** One line from the player script. Anything malformed is null: no data, not a crash. */
export function parseMacReport(player: MacPlayer, raw: unknown, now: number): PlayerReport | null {
  if (!isRecord(raw)) return null
  const stamped = raw.at
  const at =
    typeof stamped === 'number' &&
    Number.isFinite(stamped) &&
    Math.abs(stamped - now) <= MAX_CLOCK_GAP_SEC
      ? stamped
      : now

  switch (raw.kind) {
    case 'closed':
      return raw.installed === false
        ? { player, at, kind: 'closed', installed: false }
        : { player, at, kind: 'closed' }
    case 'denied':
    case 'failed':
      return { player, at, kind: raw.kind }
    case 'open': {
      const read = snapshot(player, raw)
      return read ? { player, at, kind: 'open', snapshot: read } : null
    }
    default:
      return null
  }
}

/**
 * The cover from MUSIC_ARTWORK_SCRIPT: osascript prints raw data as «data JPEG<hex>».
 * The four-letter type is ignored; the image decoder decides what the bytes are.
 */
export function parseAppleScriptData(output: string): Uint8Array | null {
  const trimmed = output.trim()
  const prefix = '«data '
  if (!trimmed.startsWith(prefix) || !trimmed.endsWith('»')) return null
  const hex = trimmed.slice(prefix.length + 4, -1)
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9A-Fa-f]+$/.test(hex)) return null
  return Uint8Array.from(Buffer.from(hex, 'hex'))
}
