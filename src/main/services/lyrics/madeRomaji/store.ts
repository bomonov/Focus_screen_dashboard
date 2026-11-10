import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { writeJsonFile } from '../../jsonFile'
import { parseReadings, type LearnedStore } from './client'

/**
 * Romaji made for a song's lines, saved so the dictionary is only loaded once for it. Kept with
 * the lines it was made for: another version of the lyrics gets its own.
 */
export interface MadeRomajiStore {
  read(key: string, lines: readonly string[]): (string | null)[] | null
  write(key: string, lines: readonly string[], romaji: readonly (string | null)[]): void
}

/** Bumped when the way romaji is made changes, so what was saved is made again. */
export const MADE_ROMAJI_REVISION = 1
const MAX_LINE_CHARS = 2000

interface MadeFile {
  version: typeof MADE_ROMAJI_REVISION
  /** The song key itself, so a file is never mistaken for another song's. */
  key: string
  /** A hash of the lines the romaji was made for. */
  lines: string
  romaji: (string | null)[]
}

const hash = (text: string): string => createHash('sha256').update(text).digest('hex')
const linesHash = (lines: readonly string[]): string => hash(lines.join('\n')).slice(0, 32)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One small JSON file per song in `directory`, named by a hash of its key (keys hold titles). */
export function openMadeRomajiStore(directory: string): MadeRomajiStore {
  const fileFor = (key: string): string => join(directory, `${hash(key).slice(0, 40)}.json`)
  return {
    read(key, lines) {
      let raw: unknown
      try {
        raw = JSON.parse(readFileSync(fileFor(key), 'utf8'))
      } catch {
        return null
      }
      if (
        !isRecord(raw) ||
        raw.version !== MADE_ROMAJI_REVISION ||
        raw.key !== key ||
        raw.lines !== linesHash(lines) ||
        !Array.isArray(raw.romaji) ||
        raw.romaji.length !== lines.length
      ) {
        return null
      }
      const romaji: (string | null)[] = []
      for (const line of raw.romaji as unknown[]) {
        if (line !== null && (typeof line !== 'string' || line.length > MAX_LINE_CHARS)) return null
        romaji.push(line)
      }
      return romaji
    },
    write(key, lines, romaji) {
      const file: MadeFile = {
        version: MADE_ROMAJI_REVISION,
        key,
        lines: linesHash(lines),
        romaji: [...romaji]
      }
      try {
        writeJsonFile(fileFor(key), file)
      } catch (error) {
        // Only costs making it again next time.
        console.warn('[lyrics] Could not save the romaji made for a song.', error)
      }
    }
  }
}

/** The readings learned from the saved VocaDB romaji, kept in one file. */
export function openLearnedReadings(file: string): LearnedStore {
  return {
    read() {
      let raw: unknown
      try {
        raw = JSON.parse(readFileSync(file, 'utf8'))
      } catch {
        return null
      }
      if (!isRecord(raw) || raw.version !== MADE_ROMAJI_REVISION || typeof raw.stamp !== 'string') {
        return null
      }
      const readings = parseReadings(raw.readings)
      return readings && { stamp: raw.stamp, readings }
    },
    write(stamp, readings) {
      try {
        writeJsonFile(file, { version: MADE_ROMAJI_REVISION, stamp, readings })
      } catch (error) {
        // Only costs learning them again next time.
        console.warn('[lyrics] Could not save the learned romaji readings.', error)
      }
    }
  }
}
