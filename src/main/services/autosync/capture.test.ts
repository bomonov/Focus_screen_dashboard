import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaybackState, PlayerId } from '../music/types'
import { createSongCapture, type CapturedSong } from './capture'
import type { AudioHelperClient, StartResult } from './client'
import { SAMPLE_RATE } from './recording'

const T0 = 1_760_000_000
const CHUNK_SEC = 0.1

function state(
  changes: Partial<PlaybackState> & { trackId?: string; duration?: number }
): PlaybackState {
  const { trackId = 'song-1', duration = 20, ...rest } = changes
  return {
    player: { id: 'appleMusic', name: 'Apple Music' },
    track: {
      id: trackId,
      title: 'Song',
      artist: 'Artist',
      album: '',
      durationSec: duration,
      artwork: null
    },
    playing: true,
    positionSec: 0,
    positionAt: T0,
    shuffle: false,
    repeat: 'off',
    repeatModes: ['off'],
    problem: null,
    supportedPlayers: [],
    ...rest
  }
}

function fakeMusic(initial: PlaybackState): {
  get(): PlaybackState
  subscribe(listener: (state: PlaybackState) => void): () => void
  set(next: PlaybackState): void
} {
  let current = initial
  const listeners = new Set<(state: PlaybackState) => void>()
  return {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next) {
      current = next
      for (const listener of listeners) listener(next)
    }
  }
}

function fakeHelper(result: StartResult = { ok: true, error: null }): AudioHelperClient & {
  starts: string[][]
  stops: number
  hear(at: number, samples: Int16Array): void
} {
  const listeners = new Set<(at: number, samples: Int16Array) => void>()
  const helper = {
    starts: [] as string[][],
    stops: 0,
    access: () => 'granted' as const,
    start(bundles: string[]) {
      helper.starts.push(bundles)
      return Promise.resolve(result)
    },
    stop() {
      helper.stops += 1
    },
    mute: () => Promise.resolve({ ok: true, error: null }),
    requestAccess: () => Promise.resolve('granted' as const),
    onAudio(listener: (at: number, samples: Int16Array) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onAccess: () => () => {},
    dispose: () => undefined,
    hear(at: number, samples: Int16Array) {
      for (const listener of listeners) listener(at, samples)
    }
  }
  return helper
}

/** A chunk whose samples say which song second they came from (in tenths). */
const chunkFrom = (songSec: number): Int16Array =>
  new Int16Array(CHUNK_SEC * SAMPLE_RATE).fill(Math.round(songSec * 10))

const nowSec = (): number => Date.now() / 1000

/** Plays `seconds` of audio in real time: the player is at `songSec` when this starts. */
async function play(
  helper: ReturnType<typeof fakeHelper>,
  songSecAtStart: number,
  seconds: number
): Promise<void> {
  for (let step = 0; step < Math.round(seconds / CHUNK_SEC); step++) {
    const at = nowSec()
    await vi.advanceTimersByTimeAsync(CHUNK_SEC * 1000)
    helper.hear(at, chunkFrom(songSecAtStart + step * CHUNK_SEC))
  }
}

const valueAt = (song: CapturedSong, songSec: number): number =>
  song.recording.samples()[Math.round(songSec * SAMPLE_RATE)] ?? -1

beforeEach(() => {
  vi.useFakeTimers({ now: T0 * 1000 })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('createSongCapture', () => {
  it('records a wanted song as it plays and hands it over once it ends', async () => {
    const music = fakeMusic(state({}))
    const helper = fakeHelper()
    const done: CapturedSong[] = []
    const progress: number[] = []
    createSongCapture({
      music,
      helper,
      wants: () => true,
      onComplete: (song) => done.push(song),
      onProgress: (coverage) => progress.push(Math.floor(coverage * 10))
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(helper.starts).toEqual([['com.apple.Music']])

    await play(helper, 0, 19)
    // Not all heard yet (the first moments are left out), so it waits for the end of the song…
    expect(done).toHaveLength(0)
    await play(helper, 19, 1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(done).toHaveLength(1)
    music.set(state({ trackId: 'song-2', positionAt: nowSec() }))
    const [song] = done
    if (!song) return
    expect(song.recording.coverage()).toBeGreaterThanOrEqual(0.9)
    // Each spot holds the audio that was playing there.
    for (const at of [3, 10.05, 17.5])
      expect(Math.abs(valueAt(song, at) - at * 10)).toBeLessThanOrEqual(1)
    // The first moments, while the position settles, are left out.
    expect(valueAt(song, 0.2)).toBe(0)
    // …then the next song starts at nothing heard.
    expect(progress).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0])
  })

  it('drops audio heard around a seek, even before the player reports it', async () => {
    const music = fakeMusic(state({}))
    const helper = fakeHelper()
    const done: CapturedSong[] = []
    // Each seek costs about two seconds of audio, so this song is done a little earlier.
    createSongCapture({
      music,
      helper,
      wants: () => true,
      onComplete: (song) => done.push(song),
      completeAt: 0.7
    })
    await vi.advanceTimersByTimeAsync(0)

    await play(helper, 0, 5)
    // The listener jumps to 12 s, but the player only reports it half a second later.
    await play(helper, 12, 0.5)
    music.set(state({ positionSec: 12.5, positionAt: nowSec() }))
    await play(helper, 12.5, 7.5)
    // Then back to 5 s for the rest.
    music.set(state({ positionSec: 5, positionAt: nowSec() }))
    await play(helper, 5, 7.5)
    await vi.advanceTimersByTimeAsync(2000)

    const [song] = done
    expect(song).toBeDefined()
    if (!song) return
    // Nothing from 12 s landed at 5 s, where the old position would have put it.
    for (let at = 4.5; at < 5.6; at += 0.1) {
      const value = valueAt(song, at)
      expect(value === 0 || Math.abs(value - at * 10) <= 1).toBe(true)
    }
    expect(Math.abs(valueAt(song, 14) - 140)).toBeLessThanOrEqual(1)
    expect(Math.abs(valueAt(song, 8) - 80)).toBeLessThanOrEqual(1)
  })

  it('opens the tap only while the song plays', async () => {
    const music = fakeMusic(state({}))
    const helper = fakeHelper()
    createSongCapture({ music, helper, wants: () => true, onComplete: () => {} })
    await vi.advanceTimersByTimeAsync(0)
    music.set(state({ playing: false, positionSec: 1, positionAt: nowSec() }))
    expect(helper.stops).toBe(1)
    music.set(state({ positionSec: 1, positionAt: nowSec() }))
    await vi.advanceTimersByTimeAsync(0)
    expect(helper.starts).toHaveLength(2)
  })

  it('listens again when the player goes quiet while playing', async () => {
    const helper = fakeHelper()
    createSongCapture({
      music: fakeMusic(state({})),
      helper,
      wants: () => true,
      onComplete: () => {}
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(helper.starts).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(3500)
    expect(helper.starts).toHaveLength(2)
  })

  it('keeps what was heard of a song when the listener comes back to it', async () => {
    const music = fakeMusic(state({}))
    const helper = fakeHelper()
    const progress: number[] = []
    createSongCapture({
      music,
      helper,
      wants: () => true,
      onComplete: () => {},
      onProgress: (coverage) => progress.push(Math.floor(coverage * 10))
    })
    await vi.advanceTimersByTimeAsync(0)
    await play(helper, 0, 9)
    await vi.advanceTimersByTimeAsync(2000)
    music.set(state({ trackId: 'song-2', positionAt: nowSec() }))
    music.set(state({ positionSec: 11, positionAt: nowSec() }))
    // Back on the first song: it picks up where it was, not at nothing.
    expect(progress.at(-1)).toBeGreaterThanOrEqual(3)
  })

  it('picks up a song whose length only arrives after it starts', async () => {
    const music = fakeMusic(state({ duration: 0 }))
    const helper = fakeHelper()
    createSongCapture({ music, helper, wants: () => true, onComplete: () => {} })
    await vi.advanceTimersByTimeAsync(0)
    expect(helper.starts).toHaveLength(0)
    music.set(state({ positionSec: 1, positionAt: nowSec() }))
    await vi.advanceTimersByTimeAsync(0)
    expect(helper.starts).toHaveLength(1)
  })

  it('finishes while the song is still on once nearly all of it was heard', async () => {
    const music = fakeMusic(state({ duration: 10 }))
    const helper = fakeHelper()
    const done: CapturedSong[] = []
    createSongCapture({
      music,
      helper,
      wants: () => true,
      onComplete: (song) => done.push(song),
      completeAt: 0.9
    })
    await vi.advanceTimersByTimeAsync(0)
    await play(helper, 0, 10)
    await vi.advanceTimersByTimeAsync(2000)
    expect(done).toHaveLength(1)
    // The tap closes once the song is done.
    expect(helper.stops).toBe(1)
  })

  it('times a nearly all heard song that is asked about again just before it is left', async () => {
    const music = fakeMusic(state({}))
    const helper = fakeHelper()
    const done: CapturedSong[] = []
    const capture = createSongCapture({
      music,
      helper,
      wants: () => true,
      onComplete: (song) => done.push(song)
    })
    await vi.advanceTimersByTimeAsync(0)
    await play(helper, 0, 18)
    await vi.advanceTimersByTimeAsync(2000)
    // The lyrics move on first (the song is still wanted), then the player reports the next song.
    capture.refresh()
    expect(done).toHaveLength(0)
    music.set(state({ trackId: 'song-2', positionAt: nowSec() }))
    expect(done).toHaveLength(1)
  })

  it('keeps a song heard only in part for later instead of timing it', async () => {
    const music = fakeMusic(state({}))
    const helper = fakeHelper()
    const done: CapturedSong[] = []
    createSongCapture({ music, helper, wants: () => true, onComplete: (song) => done.push(song) })
    await vi.advanceTimersByTimeAsync(0)
    await play(helper, 0, 12)
    await vi.advanceTimersByTimeAsync(2000)
    music.set(state({ trackId: 'song-2', positionAt: nowSec() }))
    expect(done).toHaveLength(0)
  })

  it('leaves alone songs it shouldn’t record', async () => {
    const helper = fakeHelper()
    const cases: { player?: PlayerId; trackId?: string; duration?: number; wanted?: boolean }[] = [
      { wanted: false },
      { trackId: 'ytm:ad' },
      { duration: 0 },
      { duration: 900 },
      { player: 'demo' }
    ]
    for (const { player = 'appleMusic', trackId, duration, wanted = true } of cases) {
      const capture = createSongCapture({
        music: fakeMusic({ ...state({ trackId, duration }), player: { id: player, name: player } }),
        helper,
        wants: () => wanted,
        onComplete: () => {}
      })
      await vi.advanceTimersByTimeAsync(0)
      capture.dispose()
    }
    expect(helper.starts).toEqual([])
  })

  it('starts over for a new song and doesn’t record a finished one twice', async () => {
    const music = fakeMusic(state({ duration: 10 }))
    const helper = fakeHelper()
    const done: CapturedSong[] = []
    createSongCapture({ music, helper, wants: () => true, onComplete: (song) => done.push(song) })
    await vi.advanceTimersByTimeAsync(0)
    await play(helper, 0, 11)
    await vi.advanceTimersByTimeAsync(2000)
    music.set(state({ trackId: 'song-2', duration: 10, positionAt: nowSec() }))
    expect(done).toHaveLength(1)
    music.set(state({ trackId: 'song-1', duration: 10, positionAt: nowSec() }))
    await vi.advanceTimersByTimeAsync(0)
    const startsBefore = helper.starts.length
    await play(helper, 0, 11)
    expect(done).toHaveLength(1)
    expect(helper.starts.length).toBe(startsBefore)
  })

  it('hands live sync each bit of audio at once, at its song time, and says when the listener seeks', async () => {
    const music = fakeMusic(state({}))
    const helper = fakeHelper()
    const heard: { songSec: number; value: number }[] = []
    const seeks: number[] = []
    createSongCapture({
      music,
      helper,
      wants: () => true,
      onComplete: () => {},
      live: {
        audio: (_track, songSec, samples) => heard.push({ songSec, value: samples[0] ?? -1 }),
        seek: (_track, songSec) => seeks.push(songSec)
      }
    })
    await vi.advanceTimersByTimeAsync(0)
    await play(helper, 0, 2)
    // Nothing while the position settles, then every chunk right away, where it belongs.
    expect(heard[0]?.songSec).toBeGreaterThanOrEqual(0.49)
    expect(heard.length).toBeGreaterThanOrEqual(13)
    for (const chunk of heard)
      expect(Math.abs(chunk.value - chunk.songSec * 10)).toBeLessThanOrEqual(1)
    const before = heard.length

    music.set(state({ positionSec: 12, positionAt: nowSec() }))
    expect(seeks).toEqual([12])
    await play(helper, 12, 2)
    const after = heard.slice(before)
    expect(after[0]?.songSec).toBeGreaterThanOrEqual(12.49)
    for (const chunk of after)
      expect(Math.abs(chunk.value - chunk.songSec * 10)).toBeLessThanOrEqual(1)

    // Paused: nothing goes out.
    music.set(state({ playing: false, positionSec: 14, positionAt: nowSec() }))
    const paused = heard.length
    await play(helper, 14, 1)
    expect(heard).toHaveLength(paused)
  })
})
