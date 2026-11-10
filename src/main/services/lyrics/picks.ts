// The user's own choice of lyrics for a song, from "Pick Other Lyrics…": a version on LRCLIB,
// its words timed by listening, or none at all. It wins over the automatic choice until the user
// goes back to automatic. Kept on this Mac only, apart from the cache (clearing that keeps picks).
import { readFileSync } from 'fs'
import { writeJsonFile } from '../jsonFile'
import { nearSongKeys } from './query'

export type LyricsPick = { kind: 'version'; id: number } | { kind: 'listen' } | { kind: 'none' }

export interface PickStore {
  get(key: string): LyricsPick | null
  /** null goes back to automatic. */
  set(key: string, pick: LyricsPick | null): void
}

/** More than anyone picks by hand; a file past it was written by something else. */
const MAX_PICKS = 5000
const MAX_KEY = 500

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsePick(raw: unknown): LyricsPick | null {
  if (!isRecord(raw)) return null
  if (raw.kind === 'listen' || raw.kind === 'none') return { kind: raw.kind }
  if (raw.kind !== 'version') return null
  const id = raw.id
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? { kind: 'version', id } : null
}

/** The picks file, read as untrusted: anything off-shape is no pick for that song. */
export function parsePicks(raw: unknown): Map<string, LyricsPick> {
  const picks = new Map<string, LyricsPick>()
  const saved = isRecord(raw) && isRecord(raw.picks) ? raw.picks : {}
  for (const [key, value] of Object.entries(saved)) {
    if (picks.size >= MAX_PICKS) break
    const pick = key.length <= MAX_KEY ? parsePick(value) : null
    if (pick) picks.set(key, pick)
  }
  return picks
}

export function openPickStore(filePath: string): PickStore {
  let raw: unknown = null
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    // Missing on first run; a broken file only loses picks, never anything else.
  }
  const picks = parsePicks(raw)

  return {
    get(key) {
      for (const near of nearSongKeys(key)) {
        const pick = picks.get(near)
        if (pick) return pick
      }
      return null
    },
    set(key, pick) {
      // One pick per song: the one saved a second away is replaced, never kept beside it.
      for (const near of nearSongKeys(key)) picks.delete(near)
      if (pick) picks.set(key, pick)
      try {
        writeJsonFile(filePath, { version: 1, picks: Object.fromEntries(picks) })
      } catch (error) {
        console.warn('[lyrics] Could not save the lyrics pick.', error)
      }
    }
  }
}

/**
 * Where a picked version's lyrics are saved in the lyrics cache: apart from the song's automatic
 * save, so Back to automatic has it at once, and nothing automatic (a re-check, a lookup) can
 * write over the pick.
 */
export function pickedLyricsKey(key: string, id: number): string {
  return `${key}#pick-${id}`
}
