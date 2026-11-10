import {
  MAX_OFFSET_SEC,
  type Lyrics,
  type LyricsCommand,
  type SyncedLine,
  type LyricsFrom
} from './types'

/** "Musixmatch": a name, never more. */
export const MAX_CREDIT = 60

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Commands come from the renderer, so they're untrusted: only the exact known shapes pass. */
export function parseLyricsCommand(raw: unknown): LyricsCommand | null {
  if (!isRecord(raw)) return null
  switch (raw.kind) {
    case 'setVisible':
      return typeof raw.on === 'boolean' ? { kind: 'setVisible', on: raw.on } : null
    case 'setAlbumInk':
      return typeof raw.on === 'boolean' ? { kind: 'setAlbumInk', on: raw.on } : null
    case 'nudgeOffset':
      return raw.direction === 'earlier' || raw.direction === 'later'
        ? { kind: 'nudgeOffset', direction: raw.direction }
        : null
    case 'resetOffset':
      return { kind: 'resetOffset' }
    default:
      return null
  }
}

function parseSyncedLine(raw: unknown): SyncedLine | null {
  if (!isRecord(raw)) return null
  const { timeSec, text } = raw
  return typeof timeSec === 'number' && Number.isFinite(timeSec) && timeSec >= 0
    ? { timeSec, text: typeof text === 'string' ? text : '' }
    : null
}

const MAX_FROM_ARTIST = 500

/** Where saved lyrics came from; anything off-shape is nothing, the lyrics still good. */
function parseFrom(raw: unknown): LyricsFrom | null {
  if (!isRecord(raw)) return null
  const { id, artist, durationSec, credit } = raw
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return null
  if (typeof artist !== 'string') return null
  if (typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec < 0)
    return null
  if (credit !== 'singers' && credit !== 'others') return null
  return { id, artist: artist.slice(0, MAX_FROM_ARTIST), durationSec, credit }
}

/** Lyrics read back from the cache. A hand-edited or half-written file reads as "not cached". */
export function parseLyrics(raw: unknown): Lyrics | null {
  const lyrics = parseLyricsOnly(raw)
  const from = lyrics && isRecord(raw) ? parseFrom(raw.from) : null
  return lyrics && from ? { ...lyrics, from } : lyrics
}

function parseLyricsOnly(raw: unknown): Lyrics | null {
  if (!isRecord(raw)) return null
  const source =
    raw.source === 'lrclib' ||
    raw.source === 'vocadb' ||
    raw.source === 'ytmusic' ||
    raw.source === 'demo'
      ? raw.source
      : null
  if (!source) return null
  if (raw.kind === 'instrumental') return { kind: 'instrumental', source }
  if (!Array.isArray(raw.lines) || raw.lines.length === 0) return null
  const items: unknown[] = raw.lines
  if (raw.kind === 'synced') {
    const lines = items.map(parseSyncedLine)
    return lines.every((line) => line !== null) ? { kind: 'synced', lines, source } : null
  }
  if (raw.kind === 'plain') {
    const credit = typeof raw.credit === 'string' ? raw.credit.slice(0, MAX_CREDIT) : ''
    return items.every((line) => typeof line === 'string')
      ? { kind: 'plain', lines: items, source, ...(credit ? { credit } : {}) }
      : null
  }
  return null
}

/** Saved offsets are clamped and rounded so float drift never shows up as "+0.4999 s". */
export function clampOffset(value: number): number {
  if (!Number.isFinite(value)) return 0
  const clamped = Math.min(MAX_OFFSET_SEC, Math.max(-MAX_OFFSET_SEC, value))
  return Math.round(clamped * 100) / 100
}
