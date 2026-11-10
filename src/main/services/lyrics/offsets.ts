import { readFileSync } from 'fs'
import { writeJsonFile } from '../jsonFile'
import { clampOffset } from './parse'
import { nearSongKeys as nearKeys } from './query'

/** Lyrics timing fixes the user made, one per song. */
export interface OffsetStore {
  /** 0 when the song has none. */
  get(key: string): number
  set(key: string, offsetSec: number): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function load(filePath: string): Map<string, number> {
  const offsets = new Map<string, number>()
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    // Missing on first run; a broken file only loses timing fixes, never anything else.
    return offsets
  }
  const saved = isRecord(raw) && isRecord(raw.offsets) ? raw.offsets : {}
  for (const [key, value] of Object.entries(saved)) {
    if (typeof value === 'number') {
      const offset = clampOffset(value)
      if (offset !== 0) offsets.set(key, offset)
    }
  }
  return offsets
}

/** Kept apart from the cache: clearing cached lyrics shouldn't undo the user's timing fixes. */
export function openOffsetStore(filePath: string): OffsetStore {
  const offsets = load(filePath)

  return {
    get(key) {
      for (const near of nearKeys(key)) {
        const offset = offsets.get(near)
        if (offset !== undefined) return offset
      }
      return 0
    },
    set(key, offsetSec) {
      const offset = clampOffset(offsetSec)
      const near = nearKeys(key)
      const saved = near.filter((k) => offsets.has(k))
      if (offset === 0 ? saved.length === 0 : saved.length === 1 && offsets.get(key) === offset)
        return
      // One fix per song: the one a second away is replaced, never kept beside it.
      for (const k of saved) offsets.delete(k)
      if (offset !== 0) offsets.set(key, offset)
      try {
        writeJsonFile(filePath, { version: 1, offsets: Object.fromEntries(offsets) })
      } catch (error) {
        console.warn('[lyrics] Could not save the lyrics timing.', error)
      }
    }
  }
}
