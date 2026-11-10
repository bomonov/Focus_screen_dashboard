// "Time by listening": one run of the aligner over a stretch the editor heard. This is the only
// place the editor's heard audio touches the disk (the privacy rule of 2026-11-05): the stretch
// goes to a temporary WAV for the aligner and is deleted when the reply comes or the run fails.
import { randomUUID } from 'crypto'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AlignerClient } from '../../autosync/aligner'
import { sungText, type AlignLanguage, type TimedLine } from '../../autosync/lines'
import { SAMPLE_RATE } from '../../autosync/recording'
import { clearWavs, encodeWav } from '../../autosync/wav'
import type { HeardLine } from './listen'

/** The aligner rounds to the millisecond, so a line ending on the clip's last sample can read a hair past it. */
const ROUNDING_SEC = 0.001

export interface ListenAsk {
  /** The lines' text as coded; the runner takes out what isn't sung (sungText). */
  texts: string[]
  /** 16 kHz mono: the stretch with its padding. */
  samples: Int16Array
  /** Where `samples` starts in the song, in seconds. */
  clipStart: number
  language: AlignLanguage | null
}

export interface ListenRunner {
  readonly installed: boolean
  busy(): boolean
  /** Each line's span on the song's clock, null where it couldn't be placed; null when the run failed or the add-on isn't installed. */
  run(ask: ListenAsk): Promise<(HeardLine | null)[] | null>
  /** Stops its aligner and deletes any WAV left. */
  dispose(): void
}

/**
 * The aligner's span, which runs on the clip's own clock, on the song's. A span outside the clip
 * is no placing. Words reaching past it don't check out, so they're dropped and the line keeps
 * its span, as the aligner client drops words that don't parse.
 */
function onSongClock(span: TimedLine, clipStart: number, clipSec: number): HeardLine | null {
  if (!span) return null
  const { start, end, words } = span
  if (start < 0 || start >= clipSec || end <= start || end > clipSec + ROUNDING_SEC) return null
  const at = (seconds: number): number => clipStart + Math.min(seconds, clipSec)
  const line: HeardLine = { start: at(start), end: at(end) }
  if (words && words.every((word) => word.end <= clipSec + ROUNDING_SEC)) {
    line.words = words.map((word) => ({
      text: word.text,
      start: at(word.start),
      end: at(word.end)
    }))
  }
  return line
}

/**
 * A system error's code (ENOSPC), never its message: messages carry the WAV's path, and the
 * aligner's own can quote the lyrics, which stay out of the logs.
 */
function errorCode(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : null
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,40}$/.test(code) ? code : 'unknown'
}

/** Never throws: a run answers, whatever the disk does. */
function removeWav(path: string): void {
  try {
    rmSync(path, { force: true })
  } catch (error) {
    // Under a file rather than a folder, it was never written.
    if (errorCode(error) !== 'ENOTDIR') {
      console.warn(`[lyrics] Couldn't delete a timing run's WAV (${errorCode(error)}).`)
    }
  }
}

export function createListenRunner(options: {
  aligner: (() => AlignerClient) | null
  tempDir: string
}): ListenRunner {
  const { tempDir } = options
  /** Made on the first run; it stops its worker by itself after 3 minutes without one (R6). */
  let client: AlignerClient | null = null
  let out = 0
  let disposed = false
  // A crash mid-run leaves its WAV behind.
  clearWavs(tempDir)

  return {
    installed: options.aligner !== null,
    busy: () => out > 0,
    async run(ask) {
      if (!options.aligner || disposed) return null
      const wav = join(tempDir, `${randomUUID()}.wav`)
      out += 1
      try {
        client ??= options.aligner()
        const aligner = client
        mkdirSync(tempDir, { recursive: true })
        writeFileSync(wav, encodeWav(ask.samples, SAMPLE_RATE))
        const result = await aligner.align(wav, ask.texts.map(sungText), ask.language)
        // Stopped mid-run: the window closed, which is no failure.
        if (disposed) return null
        if (!result.ok) {
          console.warn("[lyrics] The aligner couldn't time these lines by listening.")
          return null
        }
        const clipSec = ask.samples.length / SAMPLE_RATE
        return ask.texts.map((_, index) =>
          onSongClock(result.lines[index] ?? null, ask.clipStart, clipSec)
        )
      } catch (error) {
        if (!disposed) {
          console.warn(`[lyrics] Couldn't time these lines by listening (${errorCode(error)}).`)
        }
        return null
      } finally {
        out -= 1
        removeWav(wav)
      }
    },
    dispose() {
      disposed = true
      client?.dispose()
      client = null
      clearWavs(tempDir)
    }
  }
}
