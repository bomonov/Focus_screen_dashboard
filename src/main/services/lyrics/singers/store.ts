import { createHash } from 'crypto'
import { readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { writeFileAtomic, writeJsonFile } from '../../jsonFile'
import { nearSongKeys } from '../query'
import { castSinger } from './cast'
import { parseSongColors } from './parse'
import type { SongColors } from './types'

/** The user's singer colors and the waveform outlines they were timed against, one of each per song. */
export interface SongColorsStore {
  read(key: string): SongColors | null
  /** Whether it was written: a full disk or a locked folder says no. */
  write(key: string, colors: SongColors): boolean
  /** Deletes the song's colors and its waveform; whether all of it went. */
  remove(key: string): boolean
  readWaveform(key: string): Uint8Array | null
  /** Doesn't tell subscribers: the waveform fills in all the while a song plays. */
  writeWaveform(key: string, peaks: Uint8Array): void
  /** Fires with the song's key after write/remove. */
  subscribe(listener: (key: string) => void): () => void
}

/** The file's own format, apart from the coding's inside it. */
const FILE_VERSION = 1

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Only the system's error code: the rest of an error's text can carry paths and names. */
function errorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === 'string' ? error.code : 'unknown'
}

/**
 * One JSON file per song in `dir`, and the waveform outline beside it in `dir/waveforms`. Song
 * keys hold titles in any script, so files are named by a hash, and the key is kept inside the
 * coding so a hash match is confirmed. Like the timing fixes, a song saved a second longer or
 * shorter is the same song (`nearSongKeys`): reads find it and a write replaces it.
 */
export function openSongColorsStore(dir: string): SongColorsStore {
  const listeners = new Set<(key: string) => void>()

  const fileName = (key: string): string => createHash('sha1').update(key).digest('hex')
  const colorsPath = (key: string): string => join(dir, `${fileName(key)}.json`)
  const waveformPath = (key: string): string => join(dir, 'waveforms', `${fileName(key)}.bin`)

  /** Never the key or the title, and not the error's text: those can name the song. */
  function warnFailed(what: string, error: unknown): void {
    console.warn(`[lyrics] Could not ${what} (${errorCode(error)}).`)
  }

  function notify(key: string): void {
    // A copy, so a listener that stops listening as it's told doesn't skip the next one.
    for (const listener of [...listeners]) listener(key)
  }

  /** The coding saved under exactly this key; null when there's none or it can't be trusted. */
  function load(key: string): SongColors | null {
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(colorsPath(key), 'utf8'))
    } catch {
      // Missing for a song that was never colored; a broken file only loses that song's colors.
      return null
    }
    if (!isRecord(raw) || raw.key !== key) return null
    return parseSongColors(raw.colors, (id) => castSinger(id) !== undefined)
  }

  /** One entry per song: the one a second away is replaced, never kept beside it. */
  function dropNear(key: string, pathFor: (key: string) => string): void {
    for (const near of nearSongKeys(key)) {
      if (near === key) continue
      try {
        rmSync(pathFor(near), { force: true })
      } catch {
        // The exact key is read first, so a leftover only costs a few bytes of disk.
      }
    }
  }

  return {
    read(key) {
      for (const near of nearSongKeys(key)) {
        const colors = load(near)
        if (colors) return colors
      }
      return null
    },
    write(key, colors) {
      try {
        writeJsonFile(colorsPath(key), { version: FILE_VERSION, key, colors })
      } catch (error) {
        // The coding it was meant to replace is still there; the editor keeps what's on screen.
        warnFailed('save the singer colors', error)
        return false
      }
      dropNear(key, colorsPath)
      notify(key)
      return true
    },
    remove(key) {
      let failure: unknown
      let failed = false
      for (const near of nearSongKeys(key)) {
        for (const path of [colorsPath(near), waveformPath(near)]) {
          try {
            rmSync(path, { force: true })
          } catch (error) {
            // The rest are still tried, so one stuck file doesn't keep the others.
            failed = true
            failure = error
          }
        }
      }
      if (failed) {
        warnFailed('remove the singer colors', failure)
        return false
      }
      notify(key)
      return true
    },
    readWaveform(key) {
      for (const near of nearSongKeys(key)) {
        try {
          // A copy: a read buffer can be a window onto a shared pool, which would travel whole.
          return new Uint8Array(readFileSync(waveformPath(near)))
        } catch {
          // Missing until the song has played with the editor open.
        }
      }
      return null
    },
    writeWaveform(key, peaks) {
      try {
        writeFileAtomic(waveformPath(key), peaks)
      } catch (error) {
        warnFailed('save the waveform outline', error)
        return
      }
      dropNear(key, waveformPath)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
