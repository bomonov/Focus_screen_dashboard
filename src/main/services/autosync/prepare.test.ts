import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LyricsState } from '../lyrics/types'
import type { AdapterCommand } from '../music/adapter'
import { AD_TRACK_ID, type PlaybackState, type Track } from '../music/types'
import { createPrepareService, decide, prepareBlocker, type PrepareService } from './prepare'
import type { AutoSyncResult } from './service'
import { playlistKind, type AutoSyncState } from './types'

const track = (id: string, durationSec = 200): Track => ({
  id,
  title: id,
  artist: 'Artist',
  album: '',
  durationSec,
  artwork: null
})

const plain = (trackId: string): LyricsState => ({
  trackId,
  status: 'found',
  lyrics: { kind: 'plain', lines: ['one', 'two'], source: 'vocadb' },
  offsetSec: 0,
  romaji: null
})
const synced = (trackId: string): LyricsState => ({
  trackId,
  status: 'found',
  lyrics: { kind: 'synced', lines: [{ timeSec: 1, text: 'one' }], source: 'lrclib' },
  offsetSec: 0,
  romaji: null
})
const status = (trackId: string, value: LyricsState['status']): LyricsState => ({
  trackId,
  status: value,
  lyrics: null,
  offsetSec: 0,
  romaji: null
})

const AUTO: AutoSyncState = {
  enabled: true,
  problem: null,
  trackId: null,
  stage: null,
  heard: 0,
  liveLine: null
}

const nowSec = (): number => Date.now() / 1000

function playing(current: Track | null, change: Partial<PlaybackState> = {}): PlaybackState {
  return {
    player: { id: 'ytmSafari', name: 'YouTube Music' },
    track: current,
    playing: true,
    positionSec: 0,
    positionAt: nowSec(),
    shuffle: false,
    repeat: 'off',
    repeatModes: ['off', 'all', 'one'],
    problem: null,
    supportedPlayers: [],
    playlistId: 'PL1',
    ...change
  }
}

describe('decide', () => {
  it('plays songs that need timing and passes the rest by', () => {
    expect(decide(track('a'), plain('a'), 0)).toBe('play')
    expect(decide(track('a'), synced('a'), 0)).toBe('skip')
    expect(decide(track('a'), status('a', 'notFound'), 0)).toBe('skip')
    const instrumental: LyricsState = {
      ...plain('a'),
      lyrics: { kind: 'instrumental', source: 'lrclib' }
    }
    expect(decide(track('a'), instrumental, 0)).toBe('skip')
    expect(decide(track('a', 900), plain('a'), 0)).toBe('skip')
  })

  it('waits for the song’s own lyrics, its length, and LRCLIB coming back', () => {
    expect(decide(track('a'), plain('b'), 0)).toBe('wait')
    expect(decide(track('a'), status('a', 'loading'), 0)).toBe('wait')
    expect(decide(track('a', 0), plain('a'), 0)).toBe('wait')
    expect(decide(track('a'), status('a', 'unavailable'), 30_000)).toBe('wait')
    expect(decide(track('a'), status('a', 'unavailable'), 61_000)).toBe('skip')
    expect(decide(track(AD_TRACK_ID), plain(AD_TRACK_ID), 0)).toBe('wait')
  })
})

describe('prepareBlocker', () => {
  it('needs auto-sync, lyrics and YouTube Music', () => {
    expect(prepareBlocker(AUTO, true, playing(track('a')))).toBeNull()
    expect(prepareBlocker({ ...AUTO, enabled: false }, true, playing(track('a')))).toBe(
      'autoSyncOff'
    )
    expect(prepareBlocker({ ...AUTO, problem: 'denied' }, true, playing(track('a')))).toBe(
      'autoSyncOff'
    )
    expect(prepareBlocker(AUTO, false, playing(track('a')))).toBe('lyricsHidden')
    const spotify = playing(track('a'), { player: { id: 'spotify', name: 'Spotify' } })
    expect(prepareBlocker(AUTO, true, spotify)).toBe('noYouTubeMusic')
    expect(prepareBlocker(AUTO, true, playing(null))).toBe('noYouTubeMusic')
  })

  it('needs a playlist or album with an end, not a single song or a mix', () => {
    for (const playlistId of ['PLabc', 'LM', 'OLAK5uy_abc', 'RDCLAK5uy_abc']) {
      expect(prepareBlocker(AUTO, true, playing(track('a'), { playlistId }))).toBeNull()
    }
    for (const playlistId of [null, undefined, 'RDAMVMabc', 'RDMM', 'RDEMabc']) {
      expect(prepareBlocker(AUTO, true, playing(track('a'), { playlistId }))).toBe('noPlaylist')
    }
  })
})

describe('playlistKind', () => {
  it('tells playlists, albums and Liked Music from mixes', () => {
    expect(playlistKind('LM')).toBe('liked')
    expect(playlistKind('OLAK5uy_abc')).toBe('album')
    expect(playlistKind('PLabc')).toBe('playlist')
    expect(playlistKind('RDCLAK5uy_abc')).toBe('playlist')
    expect(playlistKind('RDAMVMabc')).toBe('radio')
    expect(playlistKind(null)).toBeNull()
    expect(playlistKind('')).toBeNull()
  })
})

describe('createPrepareService', () => {
  let playback: PlaybackState
  let lyricsState: LyricsState
  let auto: AutoSyncState
  let commands: AdapterCommand['kind'][]
  let muted: string[][]
  let unmuted: number
  let awake: number
  let muteWorks: boolean
  let service: PrepareService
  const musicListeners = new Set<(state: PlaybackState) => void>()
  const lyricsListeners = new Set<(state: LyricsState) => void>()
  const autoListeners = new Set<(state: AutoSyncState) => void>()
  const resultListeners = new Set<(result: AutoSyncResult) => void>()

  const setPlayback = (next: PlaybackState): void => {
    playback = next
    for (const listener of musicListeners) listener(next)
  }
  const setLyrics = (next: LyricsState): void => {
    lyricsState = next
    for (const listener of lyricsListeners) listener(next)
  }
  const result = (trackId: string, timed: boolean): void => {
    for (const listener of resultListeners) listener({ trackId, timed })
  }

  async function begin(): Promise<void> {
    service.start()
    await vi.advanceTimersByTimeAsync(0)
  }

  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000_000 })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    playback = playing(track('a'))
    lyricsState = status('a', 'loading')
    auto = AUTO
    commands = []
    muted = []
    unmuted = 0
    awake = 0
    muteWorks = true
    musicListeners.clear()
    lyricsListeners.clear()
    autoListeners.clear()
    resultListeners.clear()
    service = createPrepareService({
      music: {
        get: () => playback,
        subscribe: (listener) => (
          musicListeners.add(listener),
          () => void musicListeners.delete(listener)
        )
      },
      lyrics: {
        get: () => lyricsState,
        subscribe: (listener) => (
          lyricsListeners.add(listener),
          () => void lyricsListeners.delete(listener)
        )
      },
      autoSync: {
        get: () => auto,
        subscribe: (listener) => (
          autoListeners.add(listener),
          () => void autoListeners.delete(listener)
        ),
        onResult: (listener) => (
          resultListeners.add(listener),
          () => void resultListeners.delete(listener)
        )
      },
      showLyrics: () => true,
      command: (_player, command) => void commands.push(command.kind),
      mute: (bundles) => {
        muted.push(bundles)
        return Promise.resolve(muteWorks ? () => void (unmuted += 1) : null)
      },
      keepAwake: () => {
        awake += 1
        return () => void (awake -= 1)
      }
    })
  })

  afterEach(() => {
    service.dispose()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('mutes the player and keeps the Mac awake while it runs', async () => {
    setPlayback(playing(track('a'), { repeat: 'all', playing: false }))
    await begin()
    expect(muted).toEqual([['com.apple.WebKit.GPU', 'com.apple.Safari']])
    expect(commands).toEqual(['setRepeat', 'playPause'])
    expect(awake).toBe(1)
    expect(service.get()).toMatchObject({ running: true, blocker: null, ended: null })
  })

  it('skips songs that need nothing, and lets songs that need timing play', async () => {
    await begin()
    setLyrics(synced('a'))
    expect(commands).toEqual(['next'])
    setPlayback(playing(track('b')))
    setLyrics(plain('b'))
    expect(commands).toEqual(['next'])
    expect(service.get()).toMatchObject({ skipped: 1, pending: 1 })
    result('b', true)
    expect(service.get()).toMatchObject({ timed: 1, pending: 0 })
  })

  it('starts a song that needs timing over when the run begins part-way into it', async () => {
    setPlayback(playing(track('a'), { positionSec: 40 }))
    await begin()
    setLyrics(plain('a'))
    expect(commands).toEqual(['restart'])
  })

  it('tries a skip again, and ends once there is no next song', async () => {
    await begin()
    setLyrics(status('a', 'notFound'))
    for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(5000)
    expect(commands.filter((kind) => kind === 'next')).toHaveLength(3)
    expect(service.get()).toMatchObject({ running: false, ended: 'done' })
  })

  it('passes a song by when it comes round again', async () => {
    await begin()
    setLyrics(plain('a'))
    setPlayback(playing(track('b')))
    setLyrics(synced('b'))
    setPlayback(playing(track('a')))
    expect(commands).toEqual(['next', 'next'])
  })

  it('ends when the playlist runs out into something else, pausing before the sound comes back', async () => {
    await begin()
    setPlayback(playing(track('z'), { playlistId: 'RDAMVMxyz' }))
    expect(service.get()).toMatchObject({ running: false, ended: 'done' })
    expect(commands).toEqual(['playPause'])
    expect(unmuted).toBe(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(unmuted).toBe(1)
    expect(awake).toBe(0)
  })

  it('ends when the player stops at the end of the last song', async () => {
    await begin()
    setLyrics(plain('a'))
    setPlayback(playing(track('a', 200), { playing: false, positionSec: 199.5 }))
    await vi.advanceTimersByTimeAsync(6000)
    expect(service.get().ended).toBe('done')
  })

  it('ends after a long pause it didn’t ask for, or when YouTube Music goes away', async () => {
    await begin()
    setPlayback(playing(track('a'), { playing: false, positionSec: 50 }))
    await vi.advanceTimersByTimeAsync(119_000)
    expect(service.get().running).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(service.get().ended).toBe('paused')

    setPlayback(playing(track('a')))
    await begin()
    setPlayback({ ...playing(null), player: null })
    await vi.advanceTimersByTimeAsync(61_000)
    expect(service.get().ended).toBe('disconnected')
  })

  it('stops when asked or when auto-sync is turned off, and keeps counting late results', async () => {
    await begin()
    setLyrics(plain('a'))
    service.stop()
    expect(service.get()).toMatchObject({ running: false, ended: 'stopped', pending: 1 })
    result('a', false)
    expect(service.get()).toMatchObject({ failed: 1, pending: 0 })

    await begin()
    auto = { ...AUTO, enabled: false }
    for (const listener of autoListeners) listener(auto)
    expect(service.get().ended).toBe('autoSyncOff')
  })

  it('plays nothing when the player can’t be muted', async () => {
    muteWorks = false
    await begin()
    expect(service.get()).toMatchObject({ running: false, ended: 'muteFailed' })
    expect(commands).toEqual([])
    expect(awake).toBe(0)
  })

  it('doesn’t start when something is missing', async () => {
    setPlayback(playing(track('a'), { player: { id: 'spotify', name: 'Spotify' } }))
    await begin()
    expect(service.get()).toMatchObject({ running: false, blocker: 'noYouTubeMusic' })
    expect(muted).toEqual([])
  })
})
