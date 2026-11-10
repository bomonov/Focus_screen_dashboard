import { parseRepeatMode } from '../parse'
import {
  CHROME_EXTENSION_ID,
  isArtworkUrl,
  type ExtensionMessage,
  type PageLyrics,
  type PageState,
  type PageUpNext
} from './protocol'

export type BrowserKind = 'chrome' | 'safari'

const MAX_TEXT = 300
const MAX_URL = 2000
/** No real song is this long; anything bigger is a bad reading. */
const MAX_SECONDS = 24 * 3600
const VIDEO_ID = /^[\w-]{6,20}$/
const PLAYLIST_ID = /^[\w-]{1,200}$/
const SAFARI_ORIGIN = /^safari-web-extension:\/\/[0-9a-f-]{36}$/i
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, max = MAX_TEXT): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function seconds(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(value, MAX_SECONDS)
    : 0
}

/**
 * Which browser a connection comes from, by the Origin header the browser sets. Web pages
 * can't fake it, so no website can reach the app; null means refuse the connection.
 */
export function browserForOrigin(origin: string | undefined): BrowserKind | null {
  if (origin === `chrome-extension://${CHROME_EXTENSION_ID}`) return 'chrome'
  if (origin && SAFARI_ORIGIN.test(origin)) return 'safari'
  return null
}

/** Blocks DNS rebinding: a page on another name that resolves to us still sends its own Host. */
export function isLoopbackHost(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`
}

/** The song up next; null for anything off-shape, or when an older extension doesn't say. */
function parseUpNext(raw: unknown): PageUpNext | null {
  if (!isRecord(raw)) return null
  const title = text(raw.title)
  if (!title) return null
  const artwork = text(raw.artworkUrl, MAX_URL)
  return {
    title,
    artist: text(raw.artist),
    durationSec: seconds(raw.durationSec),
    artworkUrl: artwork && isArtworkUrl(artwork) ? artwork : null
  }
}

function parsePageState(raw: unknown): PageState | null {
  if (!isRecord(raw)) return null
  const title = text(raw.title)
  if (!title) return null
  const videoId = typeof raw.videoId === 'string' && VIDEO_ID.test(raw.videoId) ? raw.videoId : null
  // Older extensions don't send it; that reads the same as no playlist.
  const playlistId =
    typeof raw.playlistId === 'string' && PLAYLIST_ID.test(raw.playlistId) ? raw.playlistId : null
  const artwork = text(raw.artworkUrl, MAX_URL)
  return {
    videoId,
    playlistId,
    title,
    artist: text(raw.artist),
    album: text(raw.album),
    durationSec: seconds(raw.durationSec),
    positionSec: seconds(raw.positionSec),
    playing: raw.playing === true,
    shuffle: typeof raw.shuffle === 'boolean' ? raw.shuffle : null,
    repeat: parseRepeatMode(raw.repeat) ?? 'off',
    artworkUrl: artwork && isArtworkUrl(artwork) ? artwork : null,
    ad: raw.ad === true,
    next: raw.ad === true ? null : parseUpNext(raw.next)
  }
}

/** Plenty for any song's words; caps what a bad message can make us keep. */
const MAX_LYRICS_CHARS = 30_000
const MAX_LYRICS_LINES = 600
const MAX_CREDIT = 60

function parsePageLyrics(raw: unknown): PageLyrics | null {
  if (!isRecord(raw)) return null
  const title = text(raw.title)
  const words = typeof raw.text === 'string' ? raw.text.slice(0, MAX_LYRICS_CHARS) : ''
  if (!title || words.trim() === '') return null
  const lines = words.split(/\r?\n/).slice(0, MAX_LYRICS_LINES)
  return {
    videoId: typeof raw.videoId === 'string' && VIDEO_ID.test(raw.videoId) ? raw.videoId : null,
    title,
    artist: text(raw.artist),
    text: lines.map((line) => line.trimEnd()).join('\n'),
    source: text(raw.source, MAX_CREDIT) || null
  }
}

function requestId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

/** One message from the extension. It's untrusted input: anything off-shape is null. */
export function parseExtensionMessage(raw: unknown): ExtensionMessage | null {
  if (!isRecord(raw)) return null
  switch (raw.type) {
    case 'hello':
      return typeof raw.version === 'number' && typeof raw.token === 'string'
        ? { type: 'hello', version: raw.version, token: raw.token.slice(0, 200) }
        : null
    case 'pair':
      return typeof raw.version === 'number' && typeof raw.code === 'string'
        ? { type: 'pair', version: raw.version, code: raw.code.replace(/\s/g, '').slice(0, 12) }
        : null
    case 'state':
      if (raw.state === null) return { type: 'state', state: null }
      {
        const state = parsePageState(raw.state)
        return state ? { type: 'state', state } : null
      }
    case 'artwork': {
      const id = requestId(raw.requestId)
      return id !== null && typeof raw.base64 === 'string' && BASE64.test(raw.base64)
        ? { type: 'artwork', requestId: id, base64: raw.base64 }
        : null
    }
    case 'artworkFailed': {
      const id = requestId(raw.requestId)
      return id !== null ? { type: 'artworkFailed', requestId: id } : null
    }
    case 'lyrics': {
      const lyrics = parsePageLyrics(raw.lyrics)
      return lyrics ? { type: 'lyrics', lyrics } : null
    }
    default:
      return null
  }
}
