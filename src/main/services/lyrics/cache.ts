import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { writeJsonFile } from '../jsonFile'
import { parseLyrics } from './parse'
import type { Lyrics } from './types'

export type CachedLookup = { kind: 'found'; lyrics: Lyrics } | { kind: 'notFound' }

export interface LyricsCache {
  read(key: string): CachedLookup | null
  write(key: string, result: CachedLookup): void
  /**
   * LRCLIB's lyrics saved by an older lookup: still shown, but worth one more look, in case the
   * singers' own version is there (4: irony took scop's original over Nightcord's).
   */
  needsRecheck(key: string): boolean
}

/** LRCLIB grows every day, so a miss is asked again after this long. Hits are kept for good. */
export const NOT_FOUND_TTL_SEC = 3 * 24 * 3600
/**
 * VocaDB's and YouTube Music's words are only the fallback for songs LRCLIB lacked: LRCLIB is
 * asked again after this long, in case it has the song now, maybe with timings.
 */
export const VOCADB_TTL_SEC = 7 * 24 * 3600
/**
 * Goes up when the lookup finds songs it used to miss (2: title-only searches, covers) or stops
 * taking the wrong ones (3: another language's version): a miss or VocaDB's words saved by an
 * older one are asked again at once. YouTube Music's words stay, since they only come back
 * while its Lyrics panel is on screen.
 */
export const LOOKUP_REVISION = 4
/**
 * Lookups that could take another language's version of a song ("English Ver."): what they
 * found on LRCLIB is asked again once too. Earlier ones never searched widely enough to.
 */
const TOOK_OTHER_LANGUAGES = new Set([2])

function expired(result: CachedLookup, ageSec: number, revision: number): boolean {
  const older = revision < LOOKUP_REVISION
  if (result.kind === 'notFound') return older || ageSec > NOT_FOUND_TTL_SEC
  if (result.lyrics.source === 'vocadb' && older) return true
  if (result.lyrics.source === 'lrclib' && TOOK_OTHER_LANGUAGES.has(revision)) return true
  const fallback = result.lyrics.source === 'vocadb' || result.lyrics.source === 'ytmusic'
  return fallback && ageSec > VOCADB_TTL_SEC
}

interface CacheFile {
  version: 1
  /** The song key itself, so a file is never mistaken for another song's. */
  key: string
  savedAt: number
  /** Which lookup found it (LOOKUP_REVISION); missing in files from before revisions. */
  lookup?: number
  result: CachedLookup
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseResult(raw: unknown): CachedLookup | null {
  if (!isRecord(raw)) return null
  if (raw.kind === 'notFound') return { kind: 'notFound' }
  if (raw.kind !== 'found') return null
  const lyrics = parseLyrics(raw.lyrics)
  return lyrics ? { kind: 'found', lyrics } : null
}

/**
 * One small JSON file per song in `directory`, so each song is looked up once. Song keys hold
 * titles, so file names are hashes of them.
 */
export function openLyricsCache(
  directory: string,
  now: () => number = () => Date.now() / 1000
): LyricsCache {
  const fileFor = (key: string): string =>
    join(directory, `${createHash('sha256').update(key).digest('hex').slice(0, 40)}.json`)

  /** The saved answer and the lookup that made it; null when there's none or it's unreadable. */
  function load(key: string): { result: CachedLookup; savedAt: number; revision: number } | null {
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(fileFor(key), 'utf8'))
    } catch {
      return null
    }
    if (!isRecord(raw) || raw.key !== key || typeof raw.savedAt !== 'number') return null
    const result = parseResult(raw.result)
    const revision = typeof raw.lookup === 'number' ? raw.lookup : 1
    return result ? { result, savedAt: raw.savedAt, revision } : null
  }

  return {
    read(key) {
      const saved = load(key)
      if (!saved || expired(saved.result, now() - saved.savedAt, saved.revision)) return null
      return saved.result
    },
    needsRecheck(key) {
      const saved = load(key)
      if (!saved || saved.revision >= LOOKUP_REVISION) return false
      if (expired(saved.result, now() - saved.savedAt, saved.revision)) return false
      return saved.result.kind === 'found' && saved.result.lyrics.source === 'lrclib'
    },
    write(key, result) {
      const file: CacheFile = {
        version: 1,
        key,
        savedAt: Math.floor(now()),
        lookup: LOOKUP_REVISION,
        // The lyrics shown only: a lookup's other versions are for this run, not the disk.
        result: result.kind === 'found' ? { kind: 'found', lyrics: result.lyrics } : result
      }
      try {
        writeJsonFile(fileFor(key), file)
      } catch (error) {
        // Only costs a repeat lookup next time.
        console.warn('[lyrics] Could not save to the lyrics cache.', error)
      }
    }
  }
}
