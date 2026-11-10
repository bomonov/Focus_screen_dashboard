import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { writeJsonFile } from '../jsonFile'
import type { SyncedLine } from '../lyrics/types'
import { lyricLines, parseWords } from './lines'

/** Line timings worked out on this Mac, kept apart from what LRCLIB sent. */
export interface AutoSyncedStore {
  /** The timings for `key`, if they were made for exactly these plain lyrics. */
  read(key: string, plain: readonly string[]): SyncedLine[] | null
  write(key: string, plain: readonly string[], lines: readonly SyncedLine[]): void
}

interface StoreFile {
  version: 1
  key: string
  /** Of the lyric text the timings belong to; new text from LRCLIB makes them stale. */
  textHash: string
  savedAt: number
  lines: SyncedLine[]
}

const MAX_LINES = 1000

const sha = (text: string): string => createHash('sha256').update(text).digest('hex')
const textHash = (plain: readonly string[]): string => sha(lyricLines(plain).join('\n'))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseLines(raw: unknown): SyncedLine[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_LINES) return null
  const lines: SyncedLine[] = []
  for (const item of raw as unknown[]) {
    if (!isRecord(item) || typeof item.text !== 'string') return null
    const { timeSec } = item
    if (typeof timeSec !== 'number' || !Number.isFinite(timeSec) || timeSec < 0) return null
    const words = parseWords(item.words)
    lines.push(words ? { timeSec, text: item.text, words } : { timeSec, text: item.text })
  }
  return lines
}

/** One small JSON file per song in `directory`, named by a hash of the song key like the lyrics cache. */
export function openAutoSyncedStore(
  directory: string,
  now: () => number = () => Date.now() / 1000
): AutoSyncedStore {
  const fileFor = (key: string): string => join(directory, `${sha(key).slice(0, 40)}.json`)

  return {
    read(key, plain) {
      let raw: unknown
      try {
        raw = JSON.parse(readFileSync(fileFor(key), 'utf8'))
      } catch {
        return null
      }
      if (!isRecord(raw) || raw.key !== key || raw.textHash !== textHash(plain)) return null
      return parseLines(raw.lines)
    },
    write(key, plain, lines) {
      const file: StoreFile = {
        version: 1,
        key,
        textHash: textHash(plain),
        savedAt: now(),
        lines: [...lines]
      }
      try {
        writeJsonFile(fileFor(key), file)
      } catch (error) {
        console.warn('[autosync] Could not save the timings.', error)
      }
    }
  }
}
