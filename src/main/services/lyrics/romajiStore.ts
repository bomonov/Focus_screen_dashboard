import { createHash } from 'crypto'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { writeJsonFile } from '../jsonFile'

/** VocaDB's lyrics and their romanization, as asked for once per song. */
export type SavedRomaji =
  { kind: 'found'; original: string; romanized: string } | { kind: 'notFound' }

export interface RomajiStore {
  /** null when the song hasn't been asked about, or was too long ago. */
  read(key: string): SavedRomaji | null
  write(key: string, result: SavedRomaji): void
}

/** People keep adding romanizations to VocaDB, so a miss is asked again after this long. */
export const ROMAJI_NOT_FOUND_TTL_SEC = 7 * 24 * 3600
const MAX_CHARS = 100_000

interface RomajiFile {
  version: 1
  /** The song key itself, so a file is never mistaken for another song's. */
  key: string
  savedAt: number
  result: SavedRomaji
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseResult(raw: unknown): SavedRomaji | null {
  if (!isRecord(raw)) return null
  if (raw.kind === 'notFound') return { kind: 'notFound' }
  const { original, romanized } = raw
  return raw.kind === 'found' &&
    typeof original === 'string' &&
    typeof romanized === 'string' &&
    original.length <= MAX_CHARS &&
    romanized.length <= MAX_CHARS
    ? { kind: 'found', original, romanized }
    : null
}

/** One small JSON file per song in `directory`, named by a hash of its key (keys hold titles). */
export function openRomajiStore(
  directory: string,
  now: () => number = () => Date.now() / 1000
): RomajiStore {
  const fileFor = (key: string): string =>
    join(directory, `${createHash('sha256').update(key).digest('hex').slice(0, 40)}.json`)

  return {
    read(key) {
      let raw: unknown
      try {
        raw = JSON.parse(readFileSync(fileFor(key), 'utf8'))
      } catch {
        return null
      }
      if (!isRecord(raw) || raw.key !== key || typeof raw.savedAt !== 'number') return null
      const result = parseResult(raw.result)
      if (result?.kind === 'notFound' && now() - raw.savedAt > ROMAJI_NOT_FOUND_TTL_SEC) return null
      return result
    },
    write(key, result) {
      const file: RomajiFile = { version: 1, key, savedAt: Math.floor(now()), result }
      try {
        writeJsonFile(fileFor(key), file)
      } catch (error) {
        // Only costs asking VocaDB again next time.
        console.warn('[lyrics] Could not save romaji.', error)
      }
    }
  }
}

const SAVED_FILE = /^[0-9a-f]{40}\.json$/

/**
 * Changes only when there's a romanization not saved before, so what the romaji maker learned is
 * learned again then (a miss, or a song saved again at another length, teaches nothing new).
 */
export function savedRomajiStamp(directory: string): string {
  const originals = [...new Set(savedRomanizations(directory).map((song) => song.original))]
  const hash = createHash('sha256').update(originals.sort().join('\u0000')).digest('hex')
  return `${originals.length}:${hash.slice(0, 16)}`
}

/**
 * Every romanization VocaDB has given so far (files whose key and content check out), for the
 * romaji maker to learn readings from.
 */
export function savedRomanizations(directory: string): { original: string; romanized: string }[] {
  let names: string[]
  try {
    names = readdirSync(directory)
  } catch {
    return []
  }
  const out: { original: string; romanized: string }[] = []
  for (const name of names) {
    if (!SAVED_FILE.test(name)) continue
    try {
      const raw: unknown = JSON.parse(readFileSync(join(directory, name), 'utf8'))
      if (!isRecord(raw) || typeof raw.key !== 'string') continue
      const result = parseResult(raw.result)
      if (result?.kind === 'found')
        out.push({ original: result.original, romanized: result.romanized })
    } catch {
      // A damaged file teaches nothing.
    }
  }
  return out
}
