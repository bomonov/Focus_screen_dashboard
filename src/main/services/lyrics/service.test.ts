import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AD_TRACK_ID, type PlaybackState, type Track } from '../music/types'
import type { CachedLookup, LyricsCache } from './cache'
import type { OffsetStore } from './offsets'
import { createDemoLyricsProvider } from './mock/provider'
import type { LookupResult, LyricsProvider } from './provider'
import { lyricsQuery, nearSongKeys, songKey, type LyricsQuery } from './query'
import type { SavedRomaji } from './romajiStore'
import { createLyricsService, type LyricsService } from './service'
import { pickedLyricsKey, type LyricsPick, type PickStore } from './picks'
import type { SongColorsStore } from './singers/store'
import type { SongColors } from './singers/types'
import { OFFSET_STEP_SEC, type Lyrics, type LyricsState, type SyncedLine } from './types'
import type { LyricsVersion } from './versions'
import type { RomajiLookup } from './vocadb'

const SETTLE_MS = 800
const RETRY_MS = 60_000

const LYRICS: Lyrics = {
  kind: 'synced',
  lines: [{ timeSec: 10, text: 'Hello' }],
  source: 'lrclib'
}

function track(id: string, title = 'City', change: Partial<Track> = {}): Track {
  return {
    id,
    title,
    artist: 'Vivid BAD SQUAD',
    album: 'Moonlight/City',
    durationSec: 220,
    artwork: null,
    ...change
  }
}

function playback(
  current: Track | null,
  player: 'ytmSafari' | 'demo' = 'ytmSafari'
): PlaybackState {
  return {
    player: current ? { id: player, name: 'YouTube Music' } : null,
    track: current,
    playing: true,
    positionSec: 0,
    positionAt: 0,
    shuffle: false,
    repeat: 'off',
    repeatModes: ['off'],
    problem: null,
    supportedPlayers: []
  }
}

/** A provider whose answers the test hands out one at a time. */
function fakeProvider(cacheable = true): LyricsProvider & {
  queries: LyricsQuery[]
  answer(result: LookupResult): Promise<void>
} {
  const waiting: ((result: LookupResult) => void)[] = []
  const queries: LyricsQuery[] = []
  return {
    cacheable,
    queries,
    lookup(query) {
      queries.push(query)
      return new Promise((resolve) => waiting.push(resolve))
    },
    async answer(result) {
      waiting.shift()?.(result)
      // Let the service's await continue.
      await Promise.resolve()
      await Promise.resolve()
    }
  }
}

/** `stale`: keys saved by an older lookup, wanting a re-check until written again. */
function memoryCache(): LyricsCache & { entries: Map<string, CachedLookup>; stale: Set<string> } {
  const entries = new Map<string, CachedLookup>()
  const stale = new Set<string>()
  return {
    entries,
    stale,
    read: (key) => entries.get(key) ?? null,
    write(key, result) {
      stale.delete(key)
      entries.set(key, result)
    },
    needsRecheck: (key) => stale.has(key)
  }
}

/** Like the real store: a pick saved a second longer or shorter is found too. */
function memoryPicks(): PickStore & { values: Map<string, LyricsPick> } {
  const values = new Map<string, LyricsPick>()
  return {
    values,
    get(key) {
      for (const near of nearSongKeys(key)) {
        const pick = values.get(near)
        if (pick) return pick
      }
      return null
    },
    set(key, pick) {
      for (const near of nearSongKeys(key)) values.delete(near)
      if (pick) values.set(key, pick)
    }
  }
}

/** A version the user picks in the list (Nightcord's irony, say). */
const PICKED: Lyrics = {
  kind: 'synced',
  lines: [{ timeSec: 0.55, text: '少し歩き疲れたんだ' }],
  source: 'lrclib',
  from: { id: 10604292, artist: '25時、ナイトコードで。', durationSec: 220, credit: 'singers' }
}

function versionOf(id: number, lyrics: Lyrics): LyricsVersion {
  return {
    id,
    title: 'City',
    artist: 'Vivid BAD SQUAD',
    album: '',
    durationSec: 220,
    credit: 'singers',
    lyrics
  }
}

function memoryOffsets(): OffsetStore & { values: Map<string, number> } {
  const values = new Map<string, number>()
  return {
    values,
    get: (key) => values.get(key) ?? 0,
    set: (key, offset) => void (offset === 0 ? values.delete(key) : values.set(key, offset))
  }
}

/** Like the real store: a coding saved a second longer or shorter is found too, and writes tell subscribers. */
function memoryColors(): SongColorsStore & { values: Map<string, SongColors> } {
  const values = new Map<string, SongColors>()
  const listeners = new Set<(key: string) => void>()
  const forget = (key: string): void => {
    for (const near of nearSongKeys(key)) values.delete(near)
  }
  const notify = (key: string): void => {
    for (const listener of [...listeners]) listener(key)
  }
  return {
    values,
    read(key) {
      for (const near of nearSongKeys(key)) {
        const colors = values.get(near)
        if (colors) return colors
      }
      return null
    },
    write(key, colors) {
      forget(key)
      values.set(key, colors)
      notify(key)
      return true
    },
    remove(key) {
      forget(key)
      notify(key)
      return true
    },
    readWaveform: () => null,
    writeWaveform: () => {},
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

let music: PlaybackState
let musicListeners: Set<(state: PlaybackState) => void>
let provider: ReturnType<typeof fakeProvider>
let demo: ReturnType<typeof fakeProvider>
let cache: ReturnType<typeof memoryCache>
let offsets: ReturnType<typeof memoryOffsets>
let service: LyricsService
let pushes: LyricsState[]
let picks: PickStore & { values: Map<string, LyricsPick> }
let colorStore: ReturnType<typeof memoryColors>
let fetched: number[]
/** What `fetchVersion` answers next (found for any id when unset). */
let fetchAnswer: Awaited<
  ReturnType<NonNullable<Parameters<typeof createLyricsService>[0]['fetchVersion']>>
> | null

function play(state: PlaybackState): void {
  music = state
  for (const listener of musicListeners) listener(state)
}

function start(
  visible = true,
  autoSynced?: { read(key: string, plain: readonly string[]): SyncedLine[] | null },
  colors?: SongColorsStore
): void {
  service = createLyricsService({
    music: {
      get: () => music,
      subscribe(listener) {
        musicListeners.add(listener)
        return () => musicListeners.delete(listener)
      }
    },
    visible,
    providerFor: (player) => (player === 'demo' ? demo : provider),
    cache,
    offsets,
    autoSynced,
    colors,
    picks,
    async fetchVersion(id) {
      fetched.push(id)
      return fetchAnswer ?? { kind: 'found', version: versionOf(id, PICKED) }
    },
    settleMs: SETTLE_MS,
    retryMs: RETRY_MS
  })
  service.subscribe((state) => pushes.push(state))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  music = playback(null)
  musicListeners = new Set()
  provider = fakeProvider()
  demo = fakeProvider(false)
  cache = memoryCache()
  offsets = memoryOffsets()
  pushes = []
  picks = memoryPicks()
  colorStore = memoryColors()
  fetched = []
  fetchAnswer = null
})

afterEach(() => {
  service.dispose()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('lyrics service', () => {
  it('is idle with nothing playing', () => {
    start()
    expect(service.get()).toEqual({
      trackId: null,
      status: 'idle',
      lyrics: null,
      offsetSec: 0,
      romaji: null
    })
  })

  it('looks a song up once it has settled, then shows what it found', async () => {
    start()
    play(playback(track('a')))
    expect(service.get()).toMatchObject({ trackId: 'a', status: 'loading' })
    expect(provider.queries).toHaveLength(0)
    vi.advanceTimersByTime(SETTLE_MS)
    expect(provider.queries[0]).toMatchObject({ title: 'City', artist: 'Vivid BAD SQUAD' })
    await provider.answer({ kind: 'found', lyrics: LYRICS })
    expect(service.get()).toEqual({
      trackId: 'a',
      status: 'found',
      lyrics: LYRICS,
      offsetSec: 0,
      romaji: null,
      colors: null
    })
  })

  it('only looks up the song the user stops on', () => {
    start()
    play(playback(track('a', 'One')))
    vi.advanceTimersByTime(300)
    play(playback(track('b', 'Two')))
    vi.advanceTimersByTime(300)
    play(playback(track('c', 'Three')))
    vi.advanceTimersByTime(SETTLE_MS)
    expect(provider.queries.map((query) => query.title)).toEqual(['Three'])
  })

  it('caches answers and serves them straight away next time', async () => {
    start()
    play(playback(track('a')))
    vi.advanceTimersByTime(SETTLE_MS)
    await provider.answer({ kind: 'notFound' })
    expect(cache.entries.size).toBe(1)
    play(playback(null))
    play(playback(track('a')))
    expect(service.get()).toMatchObject({ trackId: 'a', status: 'notFound' })
    expect(provider.queries).toHaveLength(1)
  })

  it('drops a slow answer for a song that is no longer playing, but still caches it', async () => {
    start()
    play(playback(track('a', 'One')))
    vi.advanceTimersByTime(SETTLE_MS)
    play(playback(track('b', 'Two')))
    await provider.answer({ kind: 'found', lyrics: LYRICS })
    expect(service.get()).toMatchObject({ trackId: 'b', status: 'loading' })
    expect(cache.entries.size).toBe(1)
  })

  it('never caches "unavailable", and asks again later', async () => {
    start()
    play(playback(track('a')))
    vi.advanceTimersByTime(SETTLE_MS)
    await provider.answer({ kind: 'unavailable' })
    expect(service.get().status).toBe('unavailable')
    expect(cache.entries.size).toBe(0)
    vi.advanceTimersByTime(RETRY_MS)
    expect(provider.queries).toHaveLength(2)
    await provider.answer({ kind: 'found', lyrics: LYRICS })
    expect(service.get().status).toBe('found')
  })

  it('looks the next song up a minute before it starts, and finds it under the player’s length', async () => {
    vi.setSystemTime(1_000_000_000_000)
    start()
    const upNext = { title: 'Ready Steady', artist: 'Leo/need', durationSec: 199, artwork: null }
    const at = Date.now() / 1000
    play({ ...playback(track('a')), positionSec: 100, positionAt: at, next: upNext })
    vi.advanceTimersByTime(SETTLE_MS)
    await provider.answer({ kind: 'found', lyrics: LYRICS })
    // 220 s in all, 100 s in: the next song is looked up at 160 s.
    vi.advanceTimersByTime(59_000 - SETTLE_MS)
    expect(provider.queries).toHaveLength(1)
    vi.advanceTimersByTime(1_000)
    expect(provider.queries.at(-1)).toMatchObject({ title: 'Ready Steady', durationSec: 199 })
    await provider.answer({ kind: 'found', lyrics: LYRICS })
    // The player then gives the length to the millisecond, which rounds to 200 s.
    const next = track('b', 'Ready Steady', { artist: 'Leo/need', durationSec: 199.6 })
    play({ ...playback(next), positionAt: Date.now() / 1000 })
    expect(service.get()).toMatchObject({ trackId: 'b', status: 'found', lyrics: LYRICS })
    expect(provider.queries).toHaveLength(2)
  })

  it('doesn’t look ahead while paused, or with the lyrics hidden', async () => {
    const upNext = { title: 'Ready Steady', artist: 'Leo/need', durationSec: 199, artwork: null }
    start(false)
    play({ ...playback(track('a')), positionSec: 200, positionAt: Date.now() / 1000, next: upNext })
    vi.advanceTimersByTime(120_000)
    expect(provider.queries).toHaveLength(0)
    service.setVisible(true)
    play({
      ...playback(track('a')),
      playing: false,
      positionSec: 200,
      positionAt: Date.now() / 1000,
      next: upNext
    })
    vi.advanceTimersByTime(SETTLE_MS)
    await provider.answer({ kind: 'notFound' })
    vi.advanceTimersByTime(120_000)
    expect(provider.queries).toHaveLength(1)
  })

  it('shows stand-in words while LRCLIB is down, never saves them, and asks again', async () => {
    const standIn = { kind: 'plain' as const, lines: ['a'], source: 'vocadb' as const }
    start()
    play(playback(track('a')))
    vi.advanceTimersByTime(SETTLE_MS)
    await provider.answer({ kind: 'interim', lyrics: standIn })
    expect(service.get()).toMatchObject({ status: 'found', lyrics: standIn })
    expect(cache.entries.size).toBe(0)
    vi.advanceTimersByTime(5_000)
    expect(provider.queries).toHaveLength(2)
    await provider.answer({ kind: 'found', lyrics: LYRICS })
    expect(service.get()).toMatchObject({ status: 'found', lyrics: LYRICS })
    expect(cache.entries.size).toBe(1)
  })

  it('asks again sooner after the first failures: 5 s, 15 s, 30 s, then every minute', async () => {
    start()
    play(playback(track('a')))
    vi.advanceTimersByTime(SETTLE_MS)
    const asksAfter = async (ms: number): Promise<number> => {
      await provider.answer({ kind: 'unavailable' })
      const before = provider.queries.length
      vi.advanceTimersByTime(ms - 1)
      const early = provider.queries.length
      vi.advanceTimersByTime(1)
      expect(early).toBe(before)
      return provider.queries.length - before
    }
    expect(await asksAfter(5_000)).toBe(1)
    expect(await asksAfter(15_000)).toBe(1)
    expect(await asksAfter(30_000)).toBe(1)
    expect(await asksAfter(RETRY_MS)).toBe(1)
    expect(await asksAfter(RETRY_MS)).toBe(1)
  })

  it('treats a provider that throws as unavailable', async () => {
    provider.lookup = () => Promise.reject(new Error('boom'))
    start()
    play(playback(track('a')))
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    expect(service.get().status).toBe('unavailable')
  })

  it('skips ads', () => {
    start()
    play(playback(track(AD_TRACK_ID, 'Ad')))
    vi.advanceTimersByTime(SETTLE_MS)
    expect(service.get().status).toBe('idle')
    expect(provider.queries).toHaveLength(0)
  })

  it('looks nothing up while lyrics are hidden, and catches up when shown', () => {
    start(false)
    play(playback(track('a')))
    vi.advanceTimersByTime(SETTLE_MS)
    expect(provider.queries).toHaveLength(0)
    service.setVisible(true)
    vi.advanceTimersByTime(SETTLE_MS)
    expect(provider.queries).toHaveLength(1)
    service.setVisible(false)
    expect(service.get().status).toBe('idle')
  })

  it('uses the demo provider for the demo player and keeps it out of the cache', async () => {
    start()
    play(playback(track('demo:low-sun-hours', 'Low Sun Hours'), 'demo'))
    vi.advanceTimersByTime(SETTLE_MS)
    expect(demo.queries).toHaveLength(1)
    expect(provider.queries).toHaveLength(0)
    await demo.answer({ kind: 'found', lyrics: { ...LYRICS, source: 'demo' } })
    expect(service.get().status).toBe('found')
    expect(cache.entries.size).toBe(0)
  })

  it('keeps lyrics up while the player fills in the length of the same song', async () => {
    start()
    play(playback(track('a', 'City', { durationSec: 0 })))
    vi.advanceTimersByTime(SETTLE_MS)
    await provider.answer({ kind: 'found', lyrics: LYRICS })
    play(playback(track('a')))
    expect(service.get()).toMatchObject({ status: 'found', lyrics: LYRICS })
    vi.advanceTimersByTime(SETTLE_MS)
    expect(provider.queries.map((query) => query.durationSec)).toEqual([0, 220])
  })

  it('reuses the cache when only the album shows up', async () => {
    start()
    play(playback(track('a', 'City', { album: '' })))
    vi.advanceTimersByTime(SETTLE_MS)
    await provider.answer({ kind: 'found', lyrics: LYRICS })
    play(playback(track('a')))
    vi.advanceTimersByTime(SETTLE_MS)
    expect(service.get()).toMatchObject({ status: 'found', lyrics: LYRICS })
    expect(provider.queries).toHaveLength(1)
  })

  it('saves timing per song and restores it when the song comes back', async () => {
    start()
    play(playback(track('a', 'One')))
    service.command({ kind: 'nudgeOffset', direction: 'earlier' })
    service.command({ kind: 'nudgeOffset', direction: 'earlier' })
    expect(service.get().offsetSec).toBe(1)
    play(playback(track('b', 'Two')))
    expect(service.get().offsetSec).toBe(0)
    service.command({ kind: 'nudgeOffset', direction: 'later' })
    expect(service.get().offsetSec).toBe(-0.5)
    play(playback(track('a', 'One')))
    expect(service.get().offsetSec).toBe(1)
    service.command({ kind: 'resetOffset' })
    expect(service.get().offsetSec).toBe(0)
    expect(offsets.values.size).toBe(1)
  })

  it('ignores timing keys with no song', () => {
    start()
    service.command({ kind: 'nudgeOffset', direction: 'earlier' })
    expect(service.get().offsetSec).toBe(0)
    expect(offsets.values.size).toBe(0)
    expect(pushes).toHaveLength(0)
  })

  it('pushes only real changes', () => {
    start()
    play(playback(track('a')))
    play(playback(track('a')))
    expect(pushes).toHaveLength(1)
  })

  describe('auto-synced timings', () => {
    const PLAIN: Lyrics = { kind: 'plain', lines: ['Hello', '', 'Goodbye'], source: 'lrclib' }
    const TIMED: SyncedLine[] = [
      { timeSec: 12, text: 'Hello' },
      { timeSec: 40, text: 'Goodbye' }
    ]

    function memoryTimings(): {
      read(key: string, plain: readonly string[]): SyncedLine[] | null
      saved: Map<string, SyncedLine[]>
    } {
      const saved = new Map<string, SyncedLine[]>()
      return { saved, read: (key) => saved.get(key) ?? null }
    }

    it('shows plain lyrics with timings made on this Mac as synced', async () => {
      const timings = memoryTimings()
      start(true, timings)
      play(playback(track('a')))
      const key = service.currentKey()
      if (!key) throw new Error('no song key')
      timings.saved.set(key, TIMED)
      vi.advanceTimersByTime(SETTLE_MS)
      await provider.answer({ kind: 'found', lyrics: PLAIN })
      // With the plain lyrics behind them, so the song can be timed again for its words.
      expect(service.get().lyrics).toEqual({
        kind: 'synced',
        lines: TIMED,
        source: 'autosync',
        plain: PLAIN.lines
      })
      // The cache keeps LRCLIB's own answer; the timings are layered on when shown.
      expect(cache.entries.get(key)).toEqual({ kind: 'found', lyrics: PLAIN })
      play(playback(null))
      play(playback(track('a')))
      expect(service.get().lyrics?.source).toBe('autosync')
    })

    it('switches the song on screen as soon as its timings are ready', async () => {
      const timings = memoryTimings()
      start(true, timings)
      play(playback(track('a')))
      vi.advanceTimersByTime(SETTLE_MS)
      await provider.answer({ kind: 'found', lyrics: PLAIN })
      expect(service.get().lyrics?.kind).toBe('plain')
      const key = service.currentKey()
      if (!key) throw new Error('no song key')
      service.refreshAutoSynced('another song')
      expect(service.get().lyrics?.kind).toBe('plain')
      timings.saved.set(key, TIMED)
      service.refreshAutoSynced(key)
      expect(service.get().lyrics).toMatchObject({ kind: 'synced', source: 'autosync' })
    })

    it('leaves LRCLIB’s own synced lyrics alone', async () => {
      const timings = memoryTimings()
      start(true, timings)
      play(playback(track('a')))
      const key = service.currentKey()
      if (key) timings.saved.set(key, TIMED)
      vi.advanceTimersByTime(SETTLE_MS)
      await provider.answer({ kind: 'found', lyrics: LYRICS })
      expect(service.get().lyrics).toEqual(LYRICS)
    })

    it('times VocaDB’s words too, and remembers where they came from', async () => {
      const timings = memoryTimings()
      start(true, timings)
      play(playback(track('a')))
      const key = service.currentKey()
      if (!key) throw new Error('no song key')
      timings.saved.set(key, TIMED)
      vi.advanceTimersByTime(SETTLE_MS)
      await provider.answer({ kind: 'found', lyrics: { ...PLAIN, source: 'vocadb' } })
      expect(service.get().lyrics).toEqual({
        kind: 'synced',
        lines: TIMED,
        source: 'autosync',
        wordsFrom: 'vocadb',
        plain: PLAIN.lines
      })
    })
  })
})

describe('singer colors', () => {
  /** A line the user colored and timed. */
  const HELLO: SongColors = {
    version: 1,
    cast: ['ichika', 'miku'],
    extra: [],
    lines: [
      {
        text: 'Hello',
        start: 10.5,
        end: 12,
        timed: true,
        words: [{ text: 'Hello', start: 10.5, end: 12, singers: ['ichika'] }]
      }
    ]
  }
  /** The same line given to Miku instead. */
  const HELLO_MIKU: SongColors = {
    ...HELLO,
    lines: HELLO.lines.map((line) => ({
      ...line,
      words: line.words.map((word) => ({ ...word, singers: ['miku'] }))
    }))
  }

  function keyOfSong(): string {
    const key = service.currentKey()
    if (!key) throw new Error('no song key')
    return key
  }

  async function playAndFind(lyrics: Lyrics = LYRICS, title = 'City'): Promise<void> {
    play(playback(track('a', title)))
    vi.advanceTimersByTime(SETTLE_MS)
    await provider.answer({ kind: 'found', lyrics })
  }

  it('publishes the song’s colors when it has some', async () => {
    start(true, undefined, colorStore)
    play(playback(track('a')))
    colorStore.values.set(keyOfSong(), HELLO)
    vi.advanceTimersByTime(SETTLE_MS)
    await provider.answer({ kind: 'found', lyrics: LYRICS })
    expect(service.get().colors).toEqual({
      lines: [[['ichika']]],
      voices: [],
      romajiSplits: [null],
      extra: []
    })
    // The line sits where the user timed it, words and all.
    expect(service.get().lyrics).toEqual({
      kind: 'synced',
      lines: [{ timeSec: 10.5, text: 'Hello', words: [{ text: 'Hello', start: 10.5, end: 12 }] }],
      source: 'lrclib'
    })
    // What's saved is still LRCLIB's own answer: the coding is laid over it when shown.
    expect(cache.entries.get(keyOfSong())).toEqual({ kind: 'found', lyrics: LYRICS })
  })

  it('has none for a song nobody colored, or whose lines no longer match', async () => {
    start(true, undefined, colorStore)
    play(playback(track('a')))
    colorStore.values.set(keyOfSong(), {
      ...HELLO,
      lines: HELLO.lines.map((line) => ({ ...line, text: 'Goodbye' }))
    })
    vi.advanceTimersByTime(SETTLE_MS)
    await provider.answer({ kind: 'found', lyrics: LYRICS })
    expect(service.get()).toMatchObject({ status: 'found', colors: null })
    expect(service.get().lyrics).toEqual(LYRICS)
  })

  it('drops colors on the next song', async () => {
    start(true, undefined, colorStore)
    play(playback(track('a', 'One')))
    colorStore.values.set(keyOfSong(), HELLO)
    vi.advanceTimersByTime(SETTLE_MS)
    await provider.answer({ kind: 'found', lyrics: LYRICS })
    expect(service.get().colors).not.toBeNull()
    play(playback(track('b', 'Two')))
    expect(service.get()).toMatchObject({ trackId: 'b', status: 'loading', colors: null })
    vi.advanceTimersByTime(SETTLE_MS)
    await provider.answer({ kind: 'found', lyrics: LYRICS })
    expect(service.get()).toMatchObject({ trackId: 'b', status: 'found', colors: null })
    play(playback(null))
    expect(service.get().colors ?? null).toBeNull()
  })

  it('doesn’t keep a song’s colors when its lyrics become unavailable', async () => {
    const standIn = { kind: 'plain' as const, lines: ['Hello'], source: 'vocadb' as const }
    start(true, undefined, colorStore)
    play(playback(track('a')))
    colorStore.values.set(keyOfSong(), HELLO)
    vi.advanceTimersByTime(SETTLE_MS)
    await provider.answer({ kind: 'interim', lyrics: standIn })
    expect(service.get().colors).not.toBeNull()
    vi.advanceTimersByTime(5_000)
    await provider.answer({ kind: 'unavailable' })
    expect(service.get()).toMatchObject({ status: 'unavailable', lyrics: null, colors: null })
  })

  it('re-publishes when the song’s colors are saved', async () => {
    start(true, undefined, colorStore)
    await playAndFind()
    expect(service.get().colors).toBeNull()
    service.command({ kind: 'nudgeOffset', direction: 'earlier' })
    const key = keyOfSong()
    pushes.length = 0

    colorStore.write(key, HELLO)
    expect(pushes).toHaveLength(1)
    expect(service.get()).toMatchObject({
      trackId: 'a',
      status: 'found',
      offsetSec: OFFSET_STEP_SEC,
      colors: { lines: [[['ichika']]] }
    })
    // Laid over the lyrics already found: nothing is asked of LRCLIB again.
    vi.advanceTimersByTime(RETRY_MS)
    expect(provider.queries).toHaveLength(1)

    // A coding saved a second away is the same song's.
    const song = key.slice(0, key.lastIndexOf('|'))
    colorStore.write(`${song}|221`, HELLO_MIKU)
    expect(service.get().colors?.lines).toEqual([[['miku']]])

    // Someone else's song changing says nothing about this one.
    pushes.length = 0
    colorStore.write('another singer|another song|200', HELLO)
    expect(pushes).toHaveLength(0)

    colorStore.remove(key)
    expect(service.get().colors).toBeNull()
    expect(service.get().lyrics).toEqual(LYRICS)
    expect(provider.queries).toHaveLength(1)
  })

  it('keeps the colors when auto-sync’s timings arrive for plain lyrics', async () => {
    const plain: Lyrics = { kind: 'plain', lines: ['Hello', '', 'Goodbye'], source: 'lrclib' }
    const timings = {
      saved: new Map<string, SyncedLine[]>(),
      read(key: string) {
        return this.saved.get(key) ?? null
      }
    }
    start(true, timings, colorStore)
    play(playback(track('a')))
    const key = keyOfSong()
    colorStore.values.set(key, HELLO)
    vi.advanceTimersByTime(SETTLE_MS)
    await provider.answer({ kind: 'found', lyrics: plain })
    // Only one of its lines is coded, so it stays plain for auto-sync to time.
    expect(service.get().lyrics?.kind).toBe('plain')
    expect(service.get().colors?.lines).toEqual([[['ichika']], null, null])

    timings.saved.set(key, [
      { timeSec: 12, text: 'Hello' },
      { timeSec: 40, text: 'Goodbye' }
    ])
    service.refreshAutoSynced(key)
    const { lyrics, colors } = service.get()
    if (lyrics?.kind !== 'synced') throw new Error('not synced')
    expect(lyrics.source).toBe('autosync')
    // Timed lyrics have no blank line, and the colors follow the lines now shown.
    expect(colors?.lines).toEqual([[['ichika']], null])
    // Hello is where the user timed it; the line after it moved along with it (1.5 s earlier).
    expect(lyrics.lines.map((line) => line.timeSec)).toEqual([10.5, 38.5])
  })

  const HOSHIZORA = track('demo:hoshizora-letter', '星空レター', {
    artist: 'Tempe Night Choir',
    album: 'Desert Radio',
    durationSec: 196
  })

  function startDemo(): void {
    service = createLyricsService({
      music: {
        get: () => music,
        subscribe(listener) {
          musicListeners.add(listener)
          return () => musicListeners.delete(listener)
        }
      },
      visible: true,
      providerFor: () => createDemoLyricsProvider(),
      cache,
      offsets,
      colors: colorStore,
      romaji: {
        store: { read: () => null, write: () => {} },
        lookUp: async () => ({ kind: 'unavailable' }),
        enabled: true
      },
      settleMs: SETTLE_MS,
      retryMs: RETRY_MS
    })
  }

  it('the demo’s 星空レター comes colored by its own coding, with its romaji lined up', async () => {
    const read = vi.spyOn(colorStore, 'read')
    startDemo()
    play(playback(HOSHIZORA, 'demo'))
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    const state = service.get()
    if (state.status !== 'found' || state.lyrics?.kind !== 'synced') throw new Error('not found')
    const { lines } = state.lyrics
    // The demo's own coding: Ichika and Miku, one entry per shown line, as the romaji is.
    expect(state.colors?.lines).toHaveLength(lines.length)
    expect(state.romaji).toHaveLength(lines.length)
    expect(state.colors?.lines[0]).toEqual([['ichika'], ['ichika']])
    expect(state.colors?.voices).toHaveLength(1)
    expect(JSON.stringify(state.colors)).toContain('miku')
    expect(state.romaji?.[0]).toBe('yoru no eki de kimi wo matteta')
    // Its instrumental breaks stay uncolored, and without romaji.
    lines.forEach((line, i) => {
      if (line.text === '') {
        expect(state.colors?.lines[i]).toBeNull()
        expect(state.romaji?.[i]).toBe('')
      }
    })
    // The store was asked first: nothing saved, so the demo's own is the fallback.
    expect(read).toHaveBeenCalledWith(keyOfSong())
    const query = service.currentSong()?.query
    if (!query) throw new Error('no song')
    const own = createDemoLyricsProvider().colors?.(query)
    expect(service.currentCoding()).toEqual(own)
  })

  it('the demo’s romaji stays under its own lines when the user added one', async () => {
    startDemo()
    play(playback(HOSHIZORA, 'demo'))
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    const before = service.get()
    const own = service.currentCoding()
    if (!own || before.lyrics?.kind !== 'synced') throw new Error('no demo coding')
    const last = own.lines[own.lines.length - 1]
    const start = (last?.end ?? 190) + 1
    colorStore.write(keyOfSong(), {
      ...own,
      lines: [
        ...own.lines,
        {
          text: 'まだない行',
          start,
          end: start + 3,
          added: true,
          guessed: true,
          words: [{ text: 'まだない行', start, end: start + 3, singers: ['ichika'] }]
        }
      ]
    })

    const after = service.get()
    if (after.lyrics?.kind !== 'synced') throw new Error('not synced')
    expect(after.lyrics.lines).toHaveLength(before.lyrics.lines.length + 1)
    expect(after.romaji).toEqual([...(before.romaji ?? []), ''])
  })

  it('a coding saved for the demo song wins over its own, and shows as soon as it’s saved', async () => {
    startDemo()
    play(playback(HOSHIZORA, 'demo'))
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    const own = service.currentCoding()
    if (!own) throw new Error('no demo coding')
    // Everyone's words given to Saki, as the editor would save them.
    const edited: SongColors = {
      ...own,
      lines: own.lines.map((line) => ({
        ...line,
        words: line.words.map((word) => ({ ...word, singers: ['saki'] }))
      }))
    }
    colorStore.write(keyOfSong(), edited)
    expect(service.get().colors?.lines[0]).toEqual([['saki'], ['saki']])
    expect(service.currentCoding()).toEqual(edited)

    // Removed, the demo's own comes back.
    colorStore.remove(keyOfSong())
    expect(service.get().colors?.lines[0]).toEqual([['ichika'], ['ichika']])
    expect(service.currentCoding()).toEqual(own)
  })

  it('has no current coding for a song nobody colored', async () => {
    start(true, undefined, colorStore)
    await playAndFind()
    expect(service.currentCoding()).toBeNull()
  })
})

describe('romaji', () => {
  // Made-up lines, written for these tests.
  const SUNG = ['あさのひかりがまどをてらす', 'きみのこえがきこえたきがした']
  const ROMAJI = ['asa no hikari ga mado wo terasu', 'kimi no koe ga kikoeta ki ga shita']
  const JAPANESE: Lyrics = {
    kind: 'synced',
    lines: [
      { timeSec: 5, text: SUNG[0] ?? '' },
      { timeSec: 9, text: '' },
      { timeSec: 12, text: SUNG[1] ?? '' }
    ],
    source: 'lrclib'
  }
  const FOUND: RomajiLookup = {
    kind: 'found',
    original: SUNG.join('\n'),
    romanized: ROMAJI.join('\n')
  }

  let saved: Map<string, SavedRomaji>
  let asked: LyricsQuery[]
  let answers: ((result: RomajiLookup) => void)[]
  let madeSaved: Map<string, { lines: string; romaji: (string | null)[] }>
  let madeAsked: string[][]
  let madeAnswers: ((romaji: (string | null)[] | null) => void)[]
  let madeSaveFails: boolean

  const keyFor = (current: Track): string => {
    const query = lyricsQuery(current)
    if (!query) throw new Error('no query')
    return songKey(query)
  }

  async function answer(result: RomajiLookup): Promise<void> {
    answers.shift()?.(result)
    for (let i = 0; i < 4; i++) await Promise.resolve()
  }

  async function made(romaji: (string | null)[] | null): Promise<void> {
    madeAnswers.shift()?.(romaji)
    for (let i = 0; i < 4; i++) await Promise.resolve()
  }

  function startWithRomaji(enabled = true, withMaker = false, colors?: SongColorsStore): void {
    service = createLyricsService({
      music: {
        get: () => music,
        subscribe(listener) {
          musicListeners.add(listener)
          return () => musicListeners.delete(listener)
        }
      },
      visible: true,
      providerFor: (player) => (player === 'demo' ? demo : provider),
      cache,
      offsets,
      colors,
      romaji: {
        store: {
          read: (key) => saved.get(key) ?? null,
          write: (key, result) => saved.set(key, result)
        },
        lookUp(query) {
          asked.push(query)
          return new Promise((resolve) => answers.push(resolve))
        },
        enabled,
        ...(withMaker
          ? {
              made: {
                store: {
                  read(key: string, lines: readonly string[]) {
                    const entry = madeSaved.get(key)
                    return entry?.lines === lines.join('\n') ? entry.romaji : null
                  },
                  write(key: string, lines: readonly string[], romaji: readonly (string | null)[]) {
                    if (!madeSaveFails)
                      madeSaved.set(key, { lines: lines.join('\n'), romaji: [...romaji] })
                  }
                },
                make(lines: readonly string[]) {
                  madeAsked.push([...lines])
                  return new Promise<(string | null)[] | null>((resolve) =>
                    madeAnswers.push(resolve)
                  )
                }
              }
            }
          : {})
      },
      settleMs: SETTLE_MS,
      retryMs: RETRY_MS
    })
  }

  beforeEach(() => {
    saved = new Map()
    asked = []
    answers = []
    madeSaved = new Map()
    madeAsked = []
    madeAnswers = []
    madeSaveFails = false
  })

  it('asks for a Japanese song’s romaji once, keeps it, and shows it under its lines', async () => {
    const song = track('a', 'あさのうた')
    cache.entries.set(keyFor(song), { kind: 'found', lyrics: JAPANESE })
    startWithRomaji()
    play(playback(song))
    expect(service.get()).toMatchObject({ status: 'found', romaji: null })
    expect(asked.map((query) => query.title)).toEqual(['あさのうた'])

    await answer(FOUND)
    expect(service.get().romaji).toEqual([ROMAJI[0], '', ROMAJI[1]])
    expect(saved.get(keyFor(song))).toEqual(FOUND)

    play(playback(track('b', 'City')))
    play(playback(song))
    expect(service.get().romaji).toEqual([ROMAJI[0], '', ROMAJI[1]])
    expect(asked).toHaveLength(1)
  })

  it('asks nothing for lyrics that aren’t Japanese, or while romaji is off', async () => {
    const english = track('a')
    cache.entries.set(keyFor(english), { kind: 'found', lyrics: LYRICS })
    const japanese = track('b', 'あさのうた')
    cache.entries.set(keyFor(japanese), { kind: 'found', lyrics: JAPANESE })
    startWithRomaji(false)
    play(playback(english))
    play(playback(japanese))
    expect(asked).toHaveLength(0)

    service.setRomaji(true)
    expect(asked).toHaveLength(1)
    await answer(FOUND)
    expect(service.get().romaji).toEqual([ROMAJI[0], '', ROMAJI[1]])
    service.setRomaji(false)
    expect(service.get().romaji).toBeNull()
  })

  it('shows the demo’s own romaji, never asking VocaDB, while romaji is on', async () => {
    const builtIn = [ROMAJI[0] ?? '', '', ROMAJI[1] ?? '']
    demo.romaji = () => builtIn
    startWithRomaji()
    play(playback(track('demo:hoshizora-letter', '星空レター'), 'demo'))
    vi.advanceTimersByTime(SETTLE_MS)
    await demo.answer({ kind: 'found', lyrics: { ...JAPANESE, source: 'demo' } })
    expect(service.get()).toMatchObject({ status: 'found', romaji: builtIn })
    expect(asked).toHaveLength(0)
    expect(saved.size).toBe(0)

    service.setRomaji(false)
    expect(service.get().romaji).toBeNull()
  })

  it('keeps nothing when VocaDB can’t be reached, and asks again next time', async () => {
    const song = track('a', 'あさのうた')
    cache.entries.set(keyFor(song), { kind: 'found', lyrics: JAPANESE })
    startWithRomaji()
    play(playback(song))
    await answer({ kind: 'unavailable' })
    expect(saved.size).toBe(0)
    expect(service.get().romaji).toBeNull()
    // Not again at once: a VocaDB that's down isn't asked over and over.
    expect(asked).toHaveLength(1)

    play(playback(track('b', 'City')))
    play(playback(song))
    expect(asked).toHaveLength(2)
  })

  it('asks VocaDB again when romaji is turned back on after it couldn’t be reached', async () => {
    const song = track('a', 'あさのうた')
    cache.entries.set(keyFor(song), { kind: 'found', lyrics: JAPANESE })
    startWithRomaji()
    play(playback(song))
    await answer({ kind: 'unavailable' })
    service.setRomaji(false)
    service.setRomaji(true)
    expect(asked).toHaveLength(2)
  })

  describe('made from a dictionary', () => {
    const EXTRA = 'よるのそらにほしがひとつ'
    const MORE: Lyrics = {
      ...JAPANESE,
      lines: [...(JAPANESE.kind === 'synced' ? JAPANESE.lines : []), { timeSec: 20, text: EXTRA }]
    }
    const lines = [SUNG[0] ?? '', '', SUNG[1] ?? '', EXTRA]

    it('waits for VocaDB, then fills only the lines it has no romaji for', async () => {
      const song = track('a', 'あさのうた')
      cache.entries.set(keyFor(song), { kind: 'found', lyrics: MORE })
      startWithRomaji(true, true)
      play(playback(song))
      expect(madeAsked).toHaveLength(0)

      await answer(FOUND)
      expect(madeAsked).toEqual([lines])
      expect(service.get()).toMatchObject({ romaji: [ROMAJI[0], '', ROMAJI[1], ''] })
      await made(['ours', '', 'ours too', 'yoru no sora ni hoshi ga hitotsu'])
      expect(service.get()).toMatchObject({
        romaji: [ROMAJI[0], '', ROMAJI[1], 'yoru no sora ni hoshi ga hitotsu'],
        romajiFrom: 'both'
      })
    })

    it('an added line gets romaji made on this computer', async () => {
      const verse = 'ふたつめの星'
      const song = track('a', 'あさのうた')
      cache.entries.set(keyFor(song), { kind: 'found', lyrics: JAPANESE })
      const colors = memoryColors()
      const word = (
        text: string,
        start: number,
        end: number
      ): SongColors['lines'][number]['words'][number] => ({
        text,
        start,
        end,
        singers: ['ichika']
      })
      colors.values.set(keyFor(song), {
        version: 1,
        cast: ['ichika'],
        extra: [],
        lines: [
          {
            text: SUNG[0] ?? '',
            start: 5,
            end: 8,
            timed: true,
            words: [word(SUNG[0] ?? '', 5, 8)]
          },
          {
            text: verse,
            start: 8,
            end: 11,
            added: true,
            guessed: true,
            words: [word(verse, 8, 11)]
          },
          {
            text: SUNG[1] ?? '',
            start: 12,
            end: 15,
            timed: true,
            words: [word(SUNG[1] ?? '', 12, 15)]
          }
        ]
      })
      startWithRomaji(true, true, colors)
      play(playback(song))
      await answer(FOUND)

      expect(madeAsked[0]?.[1]).toBe(verse)
      await made(['ours', 'futatsume no hoshi', null, 'ours too'])
      const state = service.get()
      expect(state.romaji?.[1]).toBe('futatsume no hoshi')
      expect(state.lyrics?.kind === 'synced' && state.lyrics.lines[1]?.text).toBe(verse)
    })

    it('makes romaji once for a song VocaDB hasn’t got, and keeps it', async () => {
      const song = track('a', 'あさのうた')
      cache.entries.set(keyFor(song), { kind: 'found', lyrics: JAPANESE })
      startWithRomaji(true, true)
      play(playback(song))
      await answer({ kind: 'notFound' })
      await made(['asa no hikari', '', null])
      expect(service.get()).toMatchObject({
        romaji: ['asa no hikari', '', ''],
        romajiFrom: 'dictionary'
      })

      play(playback(track('b', 'City')))
      play(playback(song))
      expect(service.get()).toMatchObject({ romaji: ['asa no hikari', '', ''] })
      expect(madeAsked).toHaveLength(1)
    })

    it('shows what was made, and makes it only once, when it can’t be saved', async () => {
      const song = track('a', 'あさのうた')
      cache.entries.set(keyFor(song), { kind: 'found', lyrics: JAPANESE })
      madeSaveFails = true
      startWithRomaji(true, true)
      play(playback(song))
      await answer({ kind: 'notFound' })
      await made(['asa no hikari', '', 'kimi no koe'])
      expect(service.get()).toMatchObject({ romaji: ['asa no hikari', '', 'kimi no koe'] })
      expect(madeAsked).toHaveLength(1)
    })

    it('makes none when VocaDB has romaji for every line', async () => {
      const song = track('a', 'あさのうた')
      cache.entries.set(keyFor(song), { kind: 'found', lyrics: JAPANESE })
      startWithRomaji(true, true)
      play(playback(song))
      await answer(FOUND)
      expect(madeAsked).toHaveLength(0)
      expect(service.get()).toMatchObject({ romajiFrom: 'vocadb' })
    })

    it('makes romaji while VocaDB can’t be reached', async () => {
      const song = track('a', 'あさのうた')
      cache.entries.set(keyFor(song), { kind: 'found', lyrics: JAPANESE })
      startWithRomaji(true, true)
      play(playback(song))
      await answer({ kind: 'unavailable' })
      await made(['asa no hikari', '', 'kimi no koe'])
      expect(service.get()).toMatchObject({
        romaji: ['asa no hikari', '', 'kimi no koe'],
        romajiFrom: 'dictionary'
      })
      expect(asked).toHaveLength(1)
    })

    it('shows none when nothing could be made, and never puts a late answer on the next song', async () => {
      const song = track('a', 'あさのうた')
      cache.entries.set(keyFor(song), { kind: 'found', lyrics: JAPANESE })
      const next = track('b', 'よるのうた')
      cache.entries.set(keyFor(next), { kind: 'found', lyrics: JAPANESE })
      startWithRomaji(true, true)
      play(playback(song))
      await answer({ kind: 'notFound' })
      play(playback(next))
      await answer({ kind: 'notFound' })
      expect(madeAsked).toHaveLength(2)

      await made(['asa', '', 'kimi'])
      expect(service.get()).toMatchObject({ trackId: 'b', romaji: null })
      expect(madeSaved.has(keyFor(song))).toBe(true)
      await made(null)
      expect(service.get()).toMatchObject({ trackId: 'b', romaji: null })
      expect(madeAsked).toHaveLength(2)
    })
  })
})

describe('YouTube Music’s own lyrics', () => {
  const WORDS = { text: 'First line\nSecond line', credit: 'Musixmatch' }
  const FROM_PAGE = {
    kind: 'found',
    lyrics: {
      kind: 'plain',
      lines: ['First line', 'Second line'],
      source: 'ytmusic',
      credit: 'Musixmatch'
    }
  }
  let page: Map<string, { text: string; credit: string | null }>
  let pageListeners: Set<(trackId: string) => void>

  function startWithPage(): void {
    service = createLyricsService({
      music: {
        get: () => music,
        subscribe(listener) {
          musicListeners.add(listener)
          return () => musicListeners.delete(listener)
        }
      },
      visible: true,
      providerFor: (player) => (player === 'demo' ? demo : provider),
      cache,
      offsets,
      pageLyrics: {
        get: (trackId) => page.get(trackId) ?? null,
        subscribe(listener) {
          pageListeners.add(listener)
          return () => pageListeners.delete(listener)
        }
      },
      settleMs: SETTLE_MS,
      retryMs: RETRY_MS
    })
  }
  const pageShows = (trackId: string): void => {
    page.set(trackId, WORDS)
    for (const listener of pageListeners) listener(trackId)
  }

  beforeEach(() => {
    page = new Map()
    pageListeners = new Set()
  })

  it('fills in for a song nobody else has, and keeps them', async () => {
    page.set('a', WORDS)
    startWithPage()
    play(playback(track('a')))
    vi.advanceTimersByTime(SETTLE_MS)
    await provider.answer({ kind: 'notFound' })
    expect(service.get()).toMatchObject({ status: 'found', lyrics: FROM_PAGE.lyrics })
    expect([...cache.entries.values()]).toEqual([FROM_PAGE])
  })

  it('shows them when they arrive after "no lyrics found"', async () => {
    startWithPage()
    play(playback(track('a')))
    vi.advanceTimersByTime(SETTLE_MS)
    await provider.answer({ kind: 'notFound' })
    expect(service.get().status).toBe('notFound')
    pageShows('b')
    expect(service.get().status).toBe('notFound')
    pageShows('a')
    expect(service.get()).toMatchObject({ status: 'found', lyrics: FROM_PAGE.lyrics })
    expect([...cache.entries.values()]).toEqual([FROM_PAGE])
  })

  it('never takes the place of another source’s words', async () => {
    startWithPage()
    play(playback(track('b')))
    vi.advanceTimersByTime(SETTLE_MS)
    await provider.answer({ kind: 'found', lyrics: LYRICS })
    pageShows('b')
    expect(service.get().lyrics).toEqual(LYRICS)
  })

  it('takes them over a song saved as not found, without asking again', () => {
    const song = track('a', 'Ghost Town')
    const query = lyricsQuery(song)
    if (!query) throw new Error('no query')
    cache.entries.set(songKey(query), { kind: 'notFound' })
    page.set('a', WORDS)
    startWithPage()
    play(playback(song))
    expect(service.get()).toMatchObject({ status: 'found', lyrics: FROM_PAGE.lyrics })
    expect(cache.entries.get(songKey(query))).toEqual(FROM_PAGE)
    vi.advanceTimersByTime(SETTLE_MS)
    expect(provider.queries).toHaveLength(0)
  })

  describe('re-checking a save from an older lookup', () => {
    const query = lyricsQuery(track('a'))
    if (!query) throw new Error('no query')
    const key = songKey(query)
    const scop: Lyrics = {
      kind: 'synced',
      lines: [{ timeSec: 5.44, text: '少し歩き疲れたんだ 少し歩き疲れたんだ' }],
      source: 'lrclib'
    }
    const nightcord: Lyrics = {
      kind: 'synced',
      lines: [{ timeSec: 0.55, text: '少し歩き疲れたんだ' }],
      source: 'lrclib',
      from: { id: 10604292, artist: '25時、ナイトコードで。', durationSec: 220, credit: 'singers' }
    }
    const seen = [
      {
        id: 20951492,
        title: 'アイロニ',
        artist: 'すこっぷ',
        album: '',
        durationSec: 220,
        credit: 'others' as const,
        lyrics: scop
      },
      {
        id: 10604292,
        title: 'アイロニ',
        artist: '25時、ナイトコードで。',
        album: '',
        durationSec: 220,
        credit: 'singers' as const,
        lyrics: nightcord
      }
    ]

    beforeEach(() => {
      cache.entries.set(key, { kind: 'found', lyrics: scop })
      cache.stale.add(key)
      offsets.values.set(key, -0.5)
    })

    it("shows the old save at once and swaps it for the singers' version the re-check finds", async () => {
      start()
      play(playback(track('a')))
      expect(service.get()).toMatchObject({ status: 'found', lyrics: scop, offsetSec: -0.5 })
      vi.advanceTimersByTime(SETTLE_MS)
      expect(provider.queries).toHaveLength(1)
      await provider.answer({ kind: 'found', lyrics: nightcord, seen })
      expect(service.get()).toMatchObject({ status: 'found', lyrics: nightcord, offsetSec: 0 })
      // Saved without the other versions, and no more re-checks.
      expect(cache.entries.get(key)).toEqual({ kind: 'found', lyrics: nightcord })
      expect(cache.stale.has(key)).toBe(false)
      expect(offsets.values.has(key)).toBe(false)
    })

    it('keeps the old save when the re-check finds no better, and stops asking', async () => {
      start()
      play(playback(track('a')))
      vi.advanceTimersByTime(SETTLE_MS)
      await provider.answer({
        kind: 'found',
        lyrics: { ...scop, from: { ...nightcord.from!, credit: 'others' } },
        seen
      })
      expect(service.get()).toMatchObject({ lyrics: scop, offsetSec: -0.5 })
      expect(cache.entries.get(key)).toEqual({ kind: 'found', lyrics: scop })
      play(playback(null))
      play(playback(track('a')))
      vi.advanceTimersByTime(SETTLE_MS)
      expect(provider.queries).toHaveLength(1)
    })

    it('keeps the old save while LRCLIB is down, and asks again next time', async () => {
      start()
      play(playback(track('a')))
      vi.advanceTimersByTime(SETTLE_MS)
      await provider.answer({ kind: 'unavailable' })
      expect(service.get()).toMatchObject({ status: 'found', lyrics: scop })
      expect(cache.stale.has(key)).toBe(true)
    })

    it('never re-checks a song auto-sync has timed', () => {
      const plain: Lyrics = { kind: 'plain', lines: ['少し歩き疲れたんだ'], source: 'lrclib' }
      cache.entries.set(key, { kind: 'found', lyrics: plain })
      start(true, { read: () => [{ timeSec: 0.5, text: '少し歩き疲れたんだ' }] })
      play(playback(track('a')))
      vi.advanceTimersByTime(SETTLE_MS * 2)
      expect(provider.queries).toHaveLength(0)
    })
  })

  describe('picks', () => {
    const query = lyricsQuery(track('a'))
    if (!query) throw new Error('no query')
    const key = songKey(query)

    it('shows a picked version, keeps it over re-checks and automatic answers, and clears the timing', async () => {
      cache.entries.set(key, { kind: 'found', lyrics: LYRICS })
      offsets.values.set(key, 1)
      start()
      play(playback(track('a')))
      service.pick({ kind: 'version', id: 10604292 }, versionOf(10604292, PICKED))
      expect(service.get()).toMatchObject({ status: 'found', lyrics: PICKED, offsetSec: 0 })
      // Kept apart from the automatic save, which stays for Back to automatic.
      expect(cache.entries.get(pickedLyricsKey(key, 10604292))).toEqual({
        kind: 'found',
        lyrics: PICKED
      })
      expect(cache.entries.get(key)).toEqual({ kind: 'found', lyrics: LYRICS })
      expect(picks.values.get(key)).toEqual({ kind: 'version', id: 10604292 })
      expect(offsets.values.has(key)).toBe(false)
      // An older save asking for a re-check, next time round: the pick stands, nothing asked.
      cache.stale.add(key)
      play(playback(null))
      play(playback(track('a')))
      vi.advanceTimersByTime(SETTLE_MS * 2)
      expect(service.get()).toMatchObject({ lyrics: PICKED })
      expect(provider.queries).toHaveLength(0)
      expect(fetched).toHaveLength(0)
    })

    it('back to automatic forgets the pick and looks the song up again', async () => {
      picks.values.set(key, { kind: 'none' })
      start()
      play(playback(track('a')))
      service.pick(null)
      expect(picks.values.has(key)).toBe(false)
      vi.advanceTimersByTime(SETTLE_MS)
      expect(provider.queries).toHaveLength(1)
      await provider.answer({ kind: 'found', lyrics: LYRICS })
      expect(service.get()).toMatchObject({ status: 'found', lyrics: LYRICS })
    })

    it('shows no lyrics for a song picked as having none', () => {
      cache.entries.set(key, { kind: 'found', lyrics: LYRICS })
      picks.values.set(key, { kind: 'none' })
      start()
      play(playback(track('a')))
      expect(service.get()).toMatchObject({ trackId: 'a', status: 'notFound', lyrics: null })
      vi.advanceTimersByTime(SETTLE_MS * 2)
      expect(provider.queries).toHaveLength(0)
    })

    it('turns the shown lyrics into words for auto-sync to time, when picked to time by listening', () => {
      cache.entries.set(key, { kind: 'found', lyrics: LYRICS })
      start()
      play(playback(track('a')))
      service.pick({ kind: 'listen' })
      expect(service.get()).toMatchObject({
        status: 'found',
        lyrics: { kind: 'plain', lines: ['Hello'], source: 'lrclib' }
      })
    })

    it("refetches a picked version whose save is gone, and keeps what it has when LRCLIB can't say", async () => {
      picks.values.set(key, { kind: 'version', id: 10604292 })
      start()
      play(playback(track('a')))
      expect(service.get()).toMatchObject({ trackId: 'a', status: 'notFound' })
      await vi.runAllTimersAsync()
      expect(fetched).toEqual([10604292])
      expect(service.get()).toMatchObject({ status: 'found', lyrics: PICKED })
      expect(cache.entries.get(pickedLyricsKey(key, 10604292))).toEqual({
        kind: 'found',
        lyrics: PICKED
      })
      expect(provider.queries).toHaveLength(0)

      // Its save gone again and LRCLIB without it (or down), with an older save: that shows.
      for (const answer of [{ kind: 'notFound' }, { kind: 'unavailable' }] as const) {
        cache.entries.delete(pickedLyricsKey(key, 10604292))
        cache.entries.set(key, { kind: 'found', lyrics: LYRICS })
        fetchAnswer = answer
        play(playback(null))
        play(playback(track('a')))
        await vi.runAllTimersAsync()
        expect(service.get()).toMatchObject({ status: 'found', lyrics: LYRICS })
        expect(provider.queries).toHaveLength(0)
      }
    })

    it('finds a pick made when the song came a second longer, over the automatic save', () => {
      const longer = songKey({ ...query, durationSec: 221 })
      picks.values.set(longer, { kind: 'version', id: 10604292 })
      cache.entries.set(pickedLyricsKey(longer, 10604292), { kind: 'found', lyrics: PICKED })
      cache.entries.set(key, { kind: 'found', lyrics: LYRICS })
      start()
      play(playback(track('a')))
      expect(service.get()).toMatchObject({ status: 'found', lyrics: PICKED })
      expect(fetched).toEqual([])
    })

    it('back to automatic shows the automatic save at once, LRCLIB or not', () => {
      cache.entries.set(key, { kind: 'found', lyrics: LYRICS })
      start()
      play(playback(track('a')))
      service.pick({ kind: 'version', id: 10604292 }, versionOf(10604292, PICKED))
      expect(service.get()).toMatchObject({ lyrics: PICKED })
      service.pick(null)
      expect(service.get()).toMatchObject({ status: 'found', lyrics: LYRICS })
      vi.advanceTimersByTime(SETTLE_MS * 2)
      expect(provider.queries).toHaveLength(0)
      // Going back from "none" too.
      service.pick({ kind: 'none' })
      expect(service.get()).toMatchObject({ status: 'notFound' })
      service.pick(null)
      expect(service.get()).toMatchObject({ status: 'found', lyrics: LYRICS })
    })

    it('a re-check still running when the user picks never shows over the pick', async () => {
      const scop: Lyrics = {
        kind: 'synced',
        lines: [{ timeSec: 5.44, text: 'scop' }],
        source: 'lrclib'
      }
      const theirs: Lyrics = {
        kind: 'synced',
        lines: [{ timeSec: 0.55, text: 'nightcord' }],
        source: 'lrclib',
        from: {
          id: 11170932,
          artist: '25時、ナイトコードで。',
          durationSec: 220,
          credit: 'singers'
        }
      }
      cache.entries.set(key, { kind: 'found', lyrics: scop })
      cache.stale.add(key)
      start()
      play(playback(track('a')))
      vi.advanceTimersByTime(SETTLE_MS)
      expect(provider.queries).toHaveLength(1)
      service.pick({ kind: 'version', id: 10604292 }, versionOf(10604292, PICKED))
      await provider.answer({
        kind: 'found',
        lyrics: theirs,
        seen: [versionOf(1, scop), versionOf(11170932, theirs)].map((v, i) => ({
          ...v,
          credit: i === 0 ? ('others' as const) : ('singers' as const)
        }))
      })
      expect(service.get()).toMatchObject({ lyrics: PICKED })
      expect(cache.entries.get(pickedLyricsKey(key, 10604292))).toEqual({
        kind: 'found',
        lyrics: PICKED
      })
      play(playback(null))
      play(playback(track('a')))
      expect(service.get()).toMatchObject({ lyrics: PICKED })
    })

    it('never re-checks a song auto-sync timed, wherever its save sits', () => {
      const longer = songKey({ ...query, durationSec: 221 })
      const plain: Lyrics = { kind: 'plain', lines: ['Hello'], source: 'lrclib' }
      cache.entries.set(longer, { kind: 'found', lyrics: plain })
      cache.stale.add(longer)
      // Auto-sync timed it under the length it plays at now.
      start(true, { read: (at) => (at === key ? [{ timeSec: 1, text: 'Hello' }] : null) })
      play(playback(track('a')))
      vi.advanceTimersByTime(SETTLE_MS * 2)
      expect(provider.queries).toHaveLength(0)
    })

    it('says which song is on screen, for the picker', () => {
      start()
      expect(service.currentSong()).toBeNull()
      play(playback(track('a')))
      expect(service.currentSong()).toMatchObject({ key, trackId: 'a', cacheable: true })
    })
  })
})
