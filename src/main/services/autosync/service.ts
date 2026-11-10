import { randomUUID } from 'crypto'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { LyricsService } from '../lyrics/service'
import { canAutoSync, ownLyricsOf, type LyricsState } from '../lyrics/types'
import type { PlaybackState, Track } from '../music/types'
import type { AlignerClient } from './aligner'
import { createSongCapture, type SongCapture, type SongCaptureOptions } from './capture'
import type { AudioHelperClient } from './client'
import type { FollowClient, FollowEvent } from './follow'
import {
  alignLanguage,
  companionLines,
  describeTimings,
  followLines,
  lyricLines,
  sungText,
  toSyncedLines,
  type TimedLine
} from './lines'
import { SAMPLE_RATE } from './recording'
import type { AutoSyncedStore } from './store'
import type { AutoSyncProblem, AutoSyncState } from './types'
import { clearWavs, encodeWav } from './wav'

/** Loading the model takes ~30 s, so it starts while the last quarter of the song plays. */
export const PREPARE_AT = 0.75

/** How timing a fully heard song went: `timed` when its timings were saved. */
export interface AutoSyncResult {
  trackId: string
  timed: boolean
}

export interface AutoSyncService {
  get(): AutoSyncState
  subscribe(listener: (state: AutoSyncState) => void): () => void
  /** Told once per song handed to the aligner, when it's done with it (preparing counts these). */
  onResult(listener: (result: AutoSyncResult) => void): () => void
  setEnabled(on: boolean): void
  dispose(): void
}

export interface AutoSyncOptions {
  music: SongCaptureOptions['music']
  lyrics: Pick<LyricsService, 'get' | 'subscribe' | 'currentKey' | 'refreshAutoSynced'>
  enabled: boolean
  /** false on Windows; null factories mean a missing helper or aligner. */
  supported: boolean
  helper: (() => AudioHelperClient) | null
  aligner: (() => AlignerClient) | null
  /**
   * Live sync on the first play (a second aligner worker following the singing); null while
   * it's off, which it is until the approach is chosen (lyrics-sync/project_brief.md, L3).
   */
  follow?: ((onEvent: (event: FollowEvent) => void) => FollowClient) | null
  store: AutoSyncedStore
  /** Where a finished recording waits (as a WAV) for the aligner; emptied after each song. */
  tempDir: string
  createCapture?: (options: SongCaptureOptions) => SongCapture
  /** Dev builds: keeps a song whose timings were turned down, to work out why. */
  onRejected?: (song: { trackId: string; samples: Int16Array; timed: TimedLine[] }) => void
}

/**
 * The plain lyrics to time for the song playing, or null. That's LRCLIB's (or VocaDB's) words
 * with no timings, and songs auto-synced before word timing existed, timed once more for their
 * words (their line timings stay on screen meanwhile, and stay if the new ones fall short).
 */
export function needsTiming(shown: LyricsState, trackId: string): string[] | null {
  if (shown.trackId !== trackId || shown.status !== 'found') return null
  // Lines the user added are on `shown.lyrics`; auto-sync times only the lyrics' own.
  const lyrics = ownLyricsOf(shown)
  if (!lyrics) return null
  if (lyrics.kind === 'plain' && canAutoSync(lyrics.source)) {
    return lyricLines(lyrics.lines).length > 0 ? lyrics.lines : null
  }
  if (lyrics.kind === 'synced' && lyrics.source === 'autosync' && lyrics.plain) {
    const hasWords = lyrics.lines.some((line) => (line.words?.length ?? 0) > 0)
    return !hasWords && lyricLines(lyrics.plain).length > 0 ? lyrics.plain : null
  }
  return null
}

/** Already auto-synced, being timed again for its words. */
function isRetiming(shown: LyricsState): boolean {
  return shown.lyrics?.kind === 'synced' && shown.lyrics.source === 'autosync'
}

interface Running {
  helper: AudioHelperClient
  aligner: AlignerClient
  follow: FollowClient | null
  capture: SongCapture
  stopLyrics: () => void
}

/**
 * Times lyrics that only came as plain text: records the song while it plays, lines the
 * words up with the recording on this Mac, and keeps only the timings.
 */
export function createAutoSyncService(options: AutoSyncOptions): AutoSyncService {
  const { music, lyrics, store, tempDir } = options
  const createCapture = options.createCapture ?? createSongCapture
  const listeners = new Set<(state: AutoSyncState) => void>()
  let running: Running | null = null
  let denied = false
  let state: AutoSyncState = {
    enabled: options.enabled,
    problem: null,
    trackId: null,
    stage: null,
    heard: 0,
    liveLine: null
  }

  function problem(): AutoSyncProblem | null {
    if (!options.supported) return 'unsupported'
    if (!options.helper || !options.aligner) return 'notInstalled'
    return denied ? 'denied' : null
  }

  function publish(change: Partial<AutoSyncState>): void {
    const next = { ...state, ...change, problem: problem() }
    // A lit line belongs to its song: never carry it over to another.
    if (next.trackId !== state.trackId && change.liveLine === undefined) next.liveLine = null
    if (JSON.stringify(next) === JSON.stringify(state)) return
    state = next
    for (const listener of listeners) listener(state)
  }

  /**
   * The lyrics of each song being recorded, kept from when it started: by the time a song is
   * done the card has often moved on to the next one.
   */
  const recorded = new Map<string, { plain: string[]; key: string; retiming: boolean }>()
  /** Songs whose timing again (for words) fell short this run: not tried again until restart. */
  const retimeFailed = new Set<string>()

  function remember(trackId: string): boolean {
    const shown = lyrics.get()
    const plain = needsTiming(shown, trackId)
    const key = lyrics.currentKey()
    if (!plain || !key) return false
    const retiming = isRetiming(shown)
    if (retiming && retimeFailed.has(key)) return false
    recorded.delete(trackId)
    recorded.set(trackId, { plain, key, retiming })
    // Only the few songs that can be part-heard at once.
    while (recorded.size > 8) {
      const oldest = recorded.keys().next().value
      if (oldest === undefined) break
      recorded.delete(oldest)
    }
    return true
  }

  /** The song live sync is following, and where each of its sung lines sits in the plain lyrics. */
  let followed: { trackId: string; plainIndexes: number[] } | null = null

  function startFollowing(follow: FollowClient, track: Track): void {
    const song = recorded.get(track.id)
    followed = { trackId: track.id, plainIndexes: [] }
    if (!song) return
    const { lines, plainIndexes } = followLines(song.plain)
    followed.plainIndexes = plainIndexes
    follow.start({
      lines,
      language: alignLanguage(lyricLines(song.plain)),
      durationSec: track.durationSec
    })
  }

  function stopFollowing(): void {
    if (!followed) return
    followed = null
    running?.follow?.stop()
    publish({ liveLine: null })
  }

  function onFollowEvent(event: FollowEvent): void {
    if (!followed || state.trackId !== followed.trackId) return
    publish({
      liveLine: event.type === 'line' ? (followed.plainIndexes[event.index] ?? null) : null
    })
  }

  const resultListeners = new Set<(result: AutoSyncResult) => void>()

  function report(trackId: string, timed: boolean): void {
    for (const listener of resultListeners) listener({ trackId, timed })
  }

  /** Whether the song's timings were saved. */
  async function align(
    current: Running,
    trackId: string,
    durationSec: number,
    samples: Int16Array
  ): Promise<boolean> {
    const song = recorded.get(trackId)
    if (!song) {
      console.warn("[autosync] Lost track of this song's lyrics; not timing it.")
      return false
    }
    const { plain, key, retiming } = song
    const keeping = retiming ? 'keeping the line timings' : 'keeping the plain lyrics'
    const texts = lyricLines(plain)
    publish({ trackId, stage: 'aligning', heard: 1 })
    const started = Date.now()
    const wav = join(tempDir, `${randomUUID()}.wav`)
    try {
      mkdirSync(tempDir, { recursive: true })
      writeFileSync(wav, encodeWav(samples, SAMPLE_RATE))
      // Translations and romaji under the lines aren't sung, so the aligner never sees them.
      const companions = companionLines(texts)
      const sung = texts.filter((_, index) => !companions[index]).map(sungText)
      const result = await current.aligner.align(wav, sung, alignLanguage(texts))
      if (!result.ok) {
        console.warn(`[autosync] Couldn't time this song's lyrics (${keeping}): ${result.error}`)
        if (retiming) retimeFailed.add(key)
        return false
      }
      let next = 0
      const timed = companions.map((companion) =>
        companion ? null : (result.lines[next++] ?? null)
      )
      const synced = toSyncedLines(plain, timed, durationSec, companions)
      if (!synced) {
        console.warn(
          `[autosync] The timings didn't hold together (${describeTimings(result.lines, durationSec)}); ${keeping}.`
        )
        options.onRejected?.({ trackId, samples, timed: result.lines })
        if (retiming) retimeFailed.add(key)
        return false
      }
      store.write(key, plain, synced)
      lyrics.refreshAutoSynced(key)
      console.log(
        `[autosync] Timed ${texts.length} lines in ${Math.round((Date.now() - started) / 1000)} s.`
      )
      return true
    } finally {
      rmSync(wav, { force: true })
      if (state.trackId === trackId) publish({ trackId: null, stage: null, heard: 0 })
    }
  }

  function start(): void {
    if (running || !options.helper || !options.aligner) return
    clearWavs(tempDir)
    const helper = options.helper()
    const aligner = options.aligner()
    const follow = options.follow ? options.follow(onFollowEvent) : null
    /** The song the aligner was last warmed up for. */
    let preparedFor: string | null = null
    helper.onAccess((access) => {
      denied = access === 'denied'
      publish({})
    })
    const capture = createCapture({
      music,
      helper,
      // The card moves on to the next song a moment before the player says so. Until it does,
      // the song being recorded is still wanted, so one left nearly all heard gets timed.
      wants: (_player, track) =>
        remember(track.id) || (lyrics.get().trackId !== track.id && recorded.has(track.id)),
      // Following goes on until the song is left, even once it's all been heard.
      live: follow
        ? {
            audio(track, songTimeSec, samples) {
              if (followed?.trackId !== track.id) startFollowing(follow, track)
              follow.audio(songTimeSec, samples)
            },
            seek(track, songTimeSec) {
              if (followed?.trackId === track.id) follow.seek(songTimeSec)
            }
          }
        : undefined,
      onProgress(coverage) {
        const trackId = music.get().track?.id ?? null
        if (state.trackId !== trackId) console.log('[autosync] Listening to time this song.')
        publish({ trackId, stage: 'listening', heard: coverage })
        if (coverage >= PREPARE_AT && trackId !== preparedFor) {
          preparedFor = trackId
          aligner.prepare()
        }
      },
      onComplete(song) {
        preparedFor = null
        if (!running) return
        const trackId = song.track.id
        void align(running, trackId, song.track.durationSec, song.recording.samples())
          .catch((error: unknown) => {
            console.warn('[autosync] Timing failed.', error)
            return false
          })
          .then((timed) => report(trackId, timed))
      }
    })
    // LRCLIB answers a moment after the song starts; that's when it's known to need timing.
    const stopLyrics = lyrics.subscribe(() => capture.refresh())
    running = { helper, aligner, follow, capture, stopLyrics }
  }

  function stop(): void {
    if (!running) return
    running.stopLyrics()
    running.capture.dispose()
    running.helper.dispose()
    running.aligner.dispose()
    running.follow?.dispose()
    running = null
    followed = null
    denied = false
    publish({ trackId: null, stage: null, heard: 0 })
  }

  // A song that stops being worked on (skipped, or its lyrics turned out synced) leaves the note.
  const stopMusic = music.subscribe((playback: PlaybackState) => {
    if (followed && playback.track?.id !== followed.trackId) stopFollowing()
    if (state.stage === 'listening' && playback.track?.id !== state.trackId) {
      publish({ trackId: null, stage: null, heard: 0 })
    }
  })

  publish({})
  if (options.enabled) start()

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    onResult(listener) {
      resultListeners.add(listener)
      return () => {
        resultListeners.delete(listener)
      }
    },
    setEnabled(on) {
      if (on === state.enabled) return
      publish({ enabled: on })
      if (on) start()
      else stop()
    },
    dispose() {
      stopMusic()
      stop()
      listeners.clear()
      resultListeners.clear()
    }
  }
}
