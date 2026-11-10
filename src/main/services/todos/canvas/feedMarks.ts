import { readFileSync, rmSync } from 'fs'
import { writeJsonFile } from '../../jsonFile'

/** Hard cap on saved check-offs; a feed holds at most 1,000 entries. */
const MAX_MARKS = 2000

/**
 * Check-offs for the read-only Canvas calendar feed, kept on this computer only. Keyed by
 * the feed entry's UID; the value is when it was checked off (epoch seconds).
 */
export interface FeedMarks {
  get(uid: string): number | undefined
  /** null takes the check-off back. */
  set(uid: string, at: number | null): void
  /** Forgets entries that left the feed. */
  keepOnly(uids: ReadonlySet<string>): void
  clear(): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function load(filePath: string): Map<string, number> {
  const marks = new Map<string, number>()
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    // Missing until the first check-off; a broken file only loses those check-offs.
    return marks
  }
  const saved = isRecord(raw) && isRecord(raw.done) ? raw.done : {}
  for (const [uid, at] of Object.entries(saved)) {
    if (typeof at === 'number' && Number.isFinite(at) && marks.size < MAX_MARKS) marks.set(uid, at)
  }
  return marks
}

export function openFeedMarks(filePath: string): FeedMarks {
  const marks = load(filePath)

  function save(): void {
    try {
      if (marks.size === 0) rmSync(filePath, { force: true })
      else writeJsonFile(filePath, { version: 1, done: Object.fromEntries(marks) })
    } catch (error) {
      console.warn('[todos] Could not save Canvas check-offs.', error)
    }
  }

  return {
    get: (uid) => marks.get(uid),
    set(uid, at) {
      if (at === null) {
        if (!marks.delete(uid)) return
      } else {
        if (!marks.has(uid) && marks.size >= MAX_MARKS) return
        marks.set(uid, at)
      }
      save()
    },
    keepOnly(uids) {
      let changed = false
      for (const uid of marks.keys()) {
        if (!uids.has(uid)) {
          marks.delete(uid)
          changed = true
        }
      }
      if (changed) save()
    },
    clear() {
      if (marks.size === 0) return
      marks.clear()
      save()
    }
  }
}
