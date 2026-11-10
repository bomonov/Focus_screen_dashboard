import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LyricsState, SyncedLine } from '../lyrics/types'
import type { PlaybackState, Track } from '../music/types'
import type { AlignerClient, AlignResult } from './aligner'
import type { SongCapture, SongCaptureOptions } from './capture'
import type { AudioHelperClient } from './client'
import type { FollowClient, FollowEvent, FollowSong } from './follow'
import type { CaptureAccess } from './protocol'
import { createSongRecording } from './recording'
import {
  createAutoSyncService,
  needsTiming,
  PREPARE_AT,
  type AutoSyncOptions,
  type AutoSyncService
} from './service'
import type { AutoSyncedStore } from './store'

const TRACK: Track = {
  id: 'song-1',
  title: 'Song',
  artist: 'Artist',
  album: '',
  durationSec: 60,
  artwork: null
}
const PLAIN = ['夜に駆ける', '', 'さよなら']

const playback = (track: Track | null): PlaybackState => ({
  player: { id: 'ytmSafari', name: 'YouTube Music' },
  track,
  playing: true,
  positionSec: 0,
  positionAt: 0,
  shuffle: false,
  repeat: 'off',
  repeatModes: ['off'],
  problem: null,
  supportedPlayers: []
})

const plainState = (trackId = TRACK.id): LyricsState => ({
  trackId,
  status: 'found',
  lyrics: { kind: 'plain', lines: PLAIN, source: 'lrclib' },
  offsetSec: 0,
  romaji: null
})

let dir = ''
let lyricsState: LyricsState
let lyricsListeners: Set<(state: LyricsState) => void>
let musicListeners: Set<(state: PlaybackState) => void>
let captureOptions: SongCaptureOptions | null
let captures: { refreshed: number; disposed: boolean }[]
let access: ((status: CaptureAccess) => void) | null
let alignResult: AlignResult
let aligner: { prepared: number; calls: unknown[][]; disposed: boolean }
let saved: Map<string, SyncedLine[]>
let refreshed: string[]
let follow: {
  songs: FollowSong[]
  audio: number[]
  seeks: number[]
  stops: number
  disposed: boolean
  say: (event: FollowEvent) => void
}

function fakeFollow(onEvent: (event: FollowEvent) => void): FollowClient {
  follow = { songs: [], audio: [], seeks: [], stops: 0, disposed: false, say: onEvent }
  return {
    start: (song) => void follow.songs.push(song),
    audio: (songTimeSec) => void follow.audio.push(songTimeSec),
    seek: (songTimeSec) => void follow.seeks.push(songTimeSec),
    stop: () => void (follow.stops += 1),
    dispose: () => void (follow.disposed = true)
  }
}

const lyrics = {
  get: () => lyricsState,
  subscribe(listener: (state: LyricsState) => void) {
    lyricsListeners.add(listener)
    return () => lyricsListeners.delete(listener)
  },
  currentKey: () => 'artist\nsong',
  refreshAutoSynced: (key: string) => void refreshed.push(key)
}
const music = {
  get: () => playback(TRACK),
  subscribe(listener: (state: PlaybackState) => void) {
    musicListeners.add(listener)
    return () => musicListeners.delete(listener)
  }
}

function fakeHelper(): AudioHelperClient {
  return {
    access: () => null,
    start: () => Promise.resolve({ ok: true, error: null }),
    stop: () => undefined,
    mute: () => Promise.resolve({ ok: true, error: null }),
    requestAccess: () => Promise.resolve(null),
    onAudio: () => () => undefined,
    onAccess(listener) {
      access = listener
      return () => undefined
    },
    dispose: () => undefined
  }
}

function fakeAligner(): AlignerClient {
  aligner = { prepared: 0, calls: [], disposed: false }
  return {
    prepare: () => void (aligner.prepared += 1),
    align: (...args) => {
      // The recording must be on disk while the aligner reads it.
      aligner.calls.push([...args, existsSync(args[0])])
      return Promise.resolve(alignResult)
    },
    dispose: () => void (aligner.disposed = true)
  }
}

const store: AutoSyncedStore = {
  read: () => null,
  write: (key, _plain, lines) => void saved.set(key, [...lines])
}

function service(changes: Partial<AutoSyncOptions> = {}): AutoSyncService {
  return createAutoSyncService({
    music,
    lyrics,
    enabled: true,
    supported: true,
    helper: fakeHelper,
    aligner: fakeAligner,
    store,
    tempDir: dir,
    createCapture(options) {
      captureOptions = options
      const capture = { refreshed: 0, disposed: false }
      captures.push(capture)
      return {
        refresh: () => void (capture.refreshed += 1),
        dispose: () => void (capture.disposed = true)
      } satisfies SongCapture
    },
    ...changes
  })
}

/** The capture asks about the song when it starts, and hands it over when it's done. */
function recordSong(): void {
  captureOptions?.wants('ytmSafari', TRACK)
  finishRecording()
}

function finishRecording(): void {
  const recording = createSongRecording(TRACK.durationSec)
  recording.write(0, new Int16Array(16000 * 60).fill(5))
  captureOptions?.onComplete({ player: 'ytmSafari', track: TRACK, recording })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'focus-autosync-service-'))
  lyricsState = plainState()
  lyricsListeners = new Set()
  musicListeners = new Set()
  captureOptions = null
  captures = []
  access = null
  alignResult = {
    ok: true,
    lines: [
      { start: 10, end: 14 },
      { start: 30, end: 33 }
    ]
  }
  saved = new Map()
  refreshed = []
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('needsTiming', () => {
  it('is only for LRCLIB’s or VocaDB’s plain lyrics of the song playing', () => {
    expect(needsTiming(plainState(), TRACK.id)).toEqual(PLAIN)
    const vocadb: LyricsState = {
      ...plainState(),
      lyrics: { kind: 'plain', lines: PLAIN, source: 'vocadb' }
    }
    expect(needsTiming(vocadb, TRACK.id)).toEqual(PLAIN)
    expect(needsTiming(plainState('other'), TRACK.id)).toBeNull()
    expect(needsTiming({ ...plainState(), status: 'loading', lyrics: null }, TRACK.id)).toBeNull()
    const synced: LyricsState = {
      ...plainState(),
      lyrics: { kind: 'synced', lines: [{ timeSec: 1, text: 'a' }], source: 'lrclib' }
    }
    expect(needsTiming(synced, TRACK.id)).toBeNull()
    const demo: LyricsState = {
      ...plainState(),
      lyrics: { kind: 'plain', lines: PLAIN, source: 'demo' }
    }
    expect(needsTiming(demo, TRACK.id)).toBeNull()
  })

  it('times auto-synced lyrics once more when they have no word timing, and not after', () => {
    const lines = [{ timeSec: 1, text: 'first line' }]
    const old: LyricsState = {
      ...plainState(),
      lyrics: { kind: 'synced', lines, source: 'autosync', plain: PLAIN }
    }
    expect(needsTiming(old, TRACK.id)).toEqual(PLAIN)
    const worded: LyricsState = {
      ...plainState(),
      lyrics: {
        kind: 'synced',
        lines: [{ ...lines[0]!, words: [{ text: 'first line', start: 1, end: 2 }] }],
        source: 'autosync',
        plain: PLAIN
      }
    }
    expect(needsTiming(worded, TRACK.id)).toBeNull()
    // Without the plain lyrics behind them there's nothing to time again.
    const bare: LyricsState = {
      ...plainState(),
      lyrics: { kind: 'synced', lines, source: 'autosync' }
    }
    expect(needsTiming(bare, TRACK.id)).toBeNull()
  })
})

describe('createAutoSyncService', () => {
  it('records only songs that need timing, and checks again when lyrics arrive', () => {
    service()
    expect(captureOptions?.wants('ytmSafari', TRACK)).toBe(true)
    lyricsState = { ...plainState(), status: 'loading', lyrics: null }
    expect(captureOptions?.wants('ytmSafari', TRACK)).toBe(false)
    for (const listener of lyricsListeners) listener(plainState())
    expect(captures[0]?.refreshed).toBe(1)
  })

  it('still wants the song being recorded while the card has moved on to the next one', () => {
    service()
    expect(captureOptions?.wants('ytmSafari', TRACK)).toBe(true)
    // The lyrics service hears about the next song before the capture does.
    lyricsState = { ...plainState('song-2'), status: 'loading', lyrics: null }
    expect(captureOptions?.wants('ytmSafari', TRACK)).toBe(true)
    // A song it never started on isn't wanted that way.
    expect(captureOptions?.wants('ytmSafari', { ...TRACK, id: 'song-3' })).toBe(false)
    // Lyrics for the same song that turn out timed still end the recording.
    lyricsState = {
      ...plainState(),
      lyrics: { kind: 'synced', lines: [{ timeSec: 1, text: 'a' }], source: 'lrclib' }
    }
    expect(captureOptions?.wants('ytmSafari', TRACK)).toBe(false)
  })

  it('warms the aligner up while the song is still playing', () => {
    const autosync = service()
    captureOptions?.onProgress?.(0.3)
    expect(aligner.prepared).toBe(0)
    captureOptions?.onProgress?.(PREPARE_AT)
    captureOptions?.onProgress?.(0.8)
    expect(aligner.prepared).toBe(1)
    expect(autosync.get()).toMatchObject({ trackId: TRACK.id, stage: 'listening', heard: 0.8 })
  })

  it('times the lyrics, keeps only the timings, and shows them', async () => {
    const autosync = service()
    recordSong()
    expect(autosync.get().stage).toBe('aligning')
    await vi.waitFor(() => expect(refreshed).toEqual(['artist\nsong']))
    const [wav, lines, language, existed] = aligner.calls[0] ?? []
    expect(lines).toEqual(['夜に駆ける', 'さよなら'])
    expect(language).toBe('ja')
    expect(existed).toBe(true)
    expect(existsSync(String(wav))).toBe(false)
    expect(readdirSync(dir)).toEqual([])
    // The 16 s between the lines shows the ♪ break.
    expect(saved.get('artist\nsong')).toEqual([
      { timeSec: 10, text: '夜に駆ける' },
      { timeSec: 14, text: '' },
      { timeSec: 30, text: 'さよなら' }
    ])
    expect(autosync.get()).toMatchObject({ trackId: null, stage: null })
  })

  it('keeps the plain lyrics when timing fails or doesn’t hold together', async () => {
    alignResult = { ok: false, error: 'bad audio' }
    service()
    recordSong()
    await vi.waitFor(() => expect(aligner.calls).toHaveLength(1))
    await Promise.resolve()
    alignResult = { ok: true, lines: [null, null] }
    recordSong()
    await vi.waitFor(() => expect(aligner.calls).toHaveLength(2))
    await Promise.resolve()
    expect(saved.size).toBe(0)
    expect(refreshed).toEqual([])
    expect(readdirSync(dir)).toEqual([])
  })

  it('times a song that ended after the card moved on to the next one', async () => {
    service()
    captureOptions?.wants('ytmSafari', TRACK)
    lyricsState = plainState('the next song')
    finishRecording()
    await vi.waitFor(() => expect(saved.size).toBe(1))
    expect(aligner.calls[0]?.[1]).toEqual(['夜に駆ける', 'さよなら'])
  })

  it('doesn’t time a song it never had lyrics for', async () => {
    service()
    lyricsState = plainState('another song')
    captureOptions?.wants('ytmSafari', TRACK)
    finishRecording()
    await Promise.resolve()
    expect(aligner.calls).toHaveLength(0)
  })

  it('records nothing while off, and lets go of everything when turned off', () => {
    const autosync = service({ enabled: false })
    expect(captures).toHaveLength(0)
    autosync.setEnabled(true)
    expect(captures).toHaveLength(1)
    autosync.setEnabled(false)
    expect(captures[0]?.disposed).toBe(true)
    expect(aligner.disposed).toBe(true)
    expect(autosync.get().enabled).toBe(false)
  })

  it('says why it can’t work', () => {
    expect(service({ supported: false }).get().problem).toBe('unsupported')
    expect(service({ aligner: null }).get().problem).toBe('notInstalled')
    const autosync = service()
    expect(autosync.get().problem).toBeNull()
    access?.('denied')
    expect(autosync.get().problem).toBe('denied')
    access?.('granted')
    expect(autosync.get().problem).toBeNull()
  })

  it('clears the note when the listener moves on', () => {
    const autosync = service()
    captureOptions?.onProgress?.(0.3)
    for (const listener of musicListeners) listener(playback({ ...TRACK, id: 'song-2' }))
    expect(autosync.get()).toMatchObject({ trackId: null, stage: null })
  })

  it('doesn’t follow the singing while live sync is off', () => {
    service()
    expect(captureOptions?.live).toBeUndefined()
  })

  it('follows the singing on the first play and lights the line being sung', () => {
    const autosync = service({ follow: fakeFollow })
    captureOptions?.wants('ytmSafari', TRACK)
    captureOptions?.onProgress?.(0.1)
    const chunk = new Int16Array(1600)
    captureOptions?.live?.audio(TRACK, 1, chunk)
    captureOptions?.live?.audio(TRACK, 1.1, chunk)
    // Started once, with the lines exactly as the aligner gets them.
    expect(follow.songs).toEqual([
      { lines: ['夜に駆ける', 'さよなら'], language: 'ja', durationSec: 60 }
    ])
    expect(follow.audio).toEqual([1, 1.1])
    // The second sung line is the third of the plain lyrics, after the stanza break.
    follow.say({ type: 'line', index: 1, start: 30, confidence: 0.9 })
    expect(autosync.get().liveLine).toBe(2)
    follow.say({ type: 'lost' })
    expect(autosync.get().liveLine).toBeNull()
    follow.say({ type: 'line', index: 0, start: 10, confidence: null })
    captureOptions?.live?.seek(TRACK, 40)
    expect(follow.seeks).toEqual([40])
  })

  it('lets go of the song when the listener moves on, and of the worker when turned off', () => {
    const autosync = service({ follow: fakeFollow })
    captureOptions?.wants('ytmSafari', TRACK)
    captureOptions?.onProgress?.(0.1)
    captureOptions?.live?.audio(TRACK, 1, new Int16Array(1600))
    follow.say({ type: 'line', index: 0, start: 1, confidence: null })
    expect(autosync.get().liveLine).toBe(0)
    for (const listener of musicListeners) listener(playback({ ...TRACK, id: 'song-2' }))
    expect(follow.stops).toBe(1)
    expect(autosync.get().liveLine).toBeNull()
    // A late word about the old song lights nothing.
    follow.say({ type: 'line', index: 1, start: 30, confidence: null })
    expect(autosync.get().liveLine).toBeNull()
    autosync.setEnabled(false)
    expect(follow.disposed).toBe(true)
  })

  it('keeps following once the song has all been heard, while it’s still on', async () => {
    const autosync = service({ follow: fakeFollow })
    captureOptions?.wants('ytmSafari', TRACK)
    captureOptions?.onProgress?.(0.9)
    captureOptions?.live?.audio(TRACK, 50, new Int16Array(1600))
    follow.say({ type: 'line', index: 1, start: 49, confidence: null })
    finishRecording()
    expect(follow.stops).toBe(0)
    expect(autosync.get().liveLine).toBe(2)
    await vi.waitFor(() => expect(saved.size).toBe(1))
  })
})
