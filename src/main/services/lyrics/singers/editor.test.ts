import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { AlignerClient, AlignResult } from '../../autosync/aligner'
import type { StartResult } from '../../autosync/client'
import type { AlignLanguage } from '../../autosync/lines'
import type { CaptureAccess } from '../../autosync/protocol'
import { positionAt, type MusicCommand, type PlaybackState, type Track } from '../../music/types'
import type { LyricsQuery } from '../query'
import type { Lyrics, LyricsState } from '../types'
import {
  createColorEditor,
  CRAMPED_NOTE,
  missedNote,
  NOT_HEARD_NOTE,
  REMOVE_FAILED_NOTE,
  SAVE_DELAY_MS,
  SAVE_FAILED_NOTE,
  TIMING_FAILED_NOTE,
  type ColorEditor,
  type ColorEditorOptions
} from './editor'
import { parseColorEditorCommand } from './editorCommand'
import type { SingerPictures, SingerTap } from './editorDeps'
import type { ColorEditorState } from './editorTypes'
import type { SongColorsStore } from './store'
import type { CodedLine, ShownLine, SongColors } from './types'
import { emptyPeaks } from './waveform'

const T0 = 1_800_000_000

const TRACK_A: Track = {
  id: 'a',
  title: 'Song A',
  artist: 'Leo/need',
  album: '',
  durationSec: 200,
  artwork: null
}
const TRACK_B: Track = { ...TRACK_A, id: 'b', title: 'Song B', durationSec: 180 }

const KEY_A = 'leo/need|song a|200'
const KEY_B = 'leo/need|song b|180'

interface FakeSong {
  key: string
  query: LyricsQuery
  lines: string[]
  romaji: string[] | null
}

function query(track: Track): LyricsQuery {
  return {
    title: track.title,
    coreTitle: track.title,
    artist: track.artist,
    primaryArtist: track.artist,
    album: '',
    durationSec: track.durationSec
  }
}

const SONGS: Record<string, FakeSong> = {
  a: {
    key: KEY_A,
    query: query(TRACK_A),
    lines: ['one two three', 'four five'],
    romaji: ['ichi ni san', '']
  },
  b: { key: KEY_B, query: query(TRACK_B), lines: ['other song'], romaji: null }
}

function codedLine(text: string, start: number, end: number, cuts: number[]): CodedLine {
  const pieces = text.split(' ')
  const edges = [start, ...cuts, end]
  return {
    text,
    start,
    end,
    words: pieces.map((piece, i) => ({
      text: i < pieces.length - 1 ? `${piece} ` : piece,
      start: edges[i] ?? start,
      end: edges[i + 1] ?? end,
      singers: null
    }))
  }
}

function codingA(): SongColors {
  return {
    version: 1,
    lines: [codedLine('one two three', 9, 14, [10, 12]), codedLine('four five', 20, 25, [22])],
    cast: ['ichika', 'saki'],
    extra: []
  }
}

/** The same, its lines' times real (from synced lyrics, or the user's). */
function timedA(): SongColors {
  const coding = codingA()
  return { ...coding, lines: coding.lines.map((line) => ({ ...line, timed: true })) }
}

function codingB(): SongColors {
  return { version: 1, lines: [codedLine('other song', 5, 8, [6])], cast: [], extra: [] }
}

// --- fakes -------------------------------------------------------------------------------

interface FakeMusic {
  get(): PlaybackState
  subscribe(listener: (state: PlaybackState) => void): () => void
  command: Mock<(command: MusicCommand) => void>
  set(change: Partial<PlaybackState>): void
  /** The player moves to `track`, playing from `positionSec`. */
  play(track: Track, positionSec?: number): void
  /** A seek made in the player itself. */
  seekTo(positionSec: number): void
}

function fakeMusic(start: Partial<PlaybackState> = {}): FakeMusic {
  let state: PlaybackState = {
    player: { id: 'appleMusic', name: 'Music' },
    track: TRACK_A,
    playing: false,
    positionSec: 0,
    positionAt: Date.now() / 1000,
    shuffle: false,
    repeat: 'off',
    repeatModes: ['off'],
    problem: null,
    supportedPlayers: [],
    ...start
  }
  const listeners = new Set<(state: PlaybackState) => void>()
  function set(change: Partial<PlaybackState>): void {
    state = { ...state, ...change }
    for (const listener of [...listeners]) listener(state)
  }
  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    // Acts like a player that does what it's told at once.
    command: vi.fn((command: MusicCommand) => {
      const now = Date.now() / 1000
      if (command.kind === 'seek') set({ positionSec: command.positionSec, positionAt: now })
      if (command.kind === 'playPause') {
        set({ playing: !state.playing, positionSec: positionAt(state, now), positionAt: now })
      }
    }),
    set,
    play(track, positionSec = 0) {
      set({ track, playing: true, positionSec, positionAt: Date.now() / 1000 })
    },
    seekTo(positionSec) {
      set({ positionSec, positionAt: Date.now() / 1000 })
    }
  }
}

interface FakeOffsets {
  saved: Map<string, number>
  get: Mock<(key: string) => number>
  set: Mock<(key: string, offsetSec: number) => void>
}

function fakeOffsets(start: Record<string, number> = {}): FakeOffsets {
  const saved = new Map(Object.entries(start))
  return {
    saved,
    get: vi.fn((key: string) => saved.get(key) ?? 0),
    set: vi.fn((key: string, offsetSec: number) => {
      if (offsetSec === 0) saved.delete(key)
      else saved.set(key, offsetSec)
    })
  }
}

interface FakeLyrics {
  get(): LyricsState
  currentSong(): { key: string; trackId: string; query: LyricsQuery } | null
  subscribe(listener: (state: LyricsState) => void): () => void
  command: Mock<(command: { kind: 'resetOffset' }) => void>
  currentCoding(): SongColors | null
}

/** `own` is a coding the lyrics bring for a song (the demo's), by track id. */
function fakeLyrics(
  music: FakeMusic,
  offsets: FakeOffsets,
  own: Record<string, SongColors> = {},
  /** Lines the user added, shown after the song's own (as the real service does), by track id. */
  addedRows: Record<string, string[]> = {},
  /** The lyrics' own lines' times, by track id ('plain' for none); else 10 s apart from 0. */
  ownTimes: Record<string, number[] | 'plain'> = {}
): FakeLyrics {
  const listeners = new Set<(state: LyricsState) => void>()
  function currentSong(): { key: string; trackId: string; query: LyricsQuery } | null {
    const track = music.get().track
    const song = track ? SONGS[track.id] : undefined
    return track && song ? { key: song.key, trackId: track.id, query: song.query } : null
  }
  function get(): LyricsState {
    const track = music.get().track
    const song = track ? SONGS[track.id] : undefined
    if (!track || !song) {
      return { trackId: null, status: 'idle', lyrics: null, offsetSec: 0, romaji: null }
    }
    const times = ownTimes[track.id]
    const ownLyrics: Extract<Lyrics, { kind: 'synced' | 'plain' }> =
      times === 'plain'
        ? { kind: 'plain', lines: [...song.lines], source: 'lrclib' }
        : {
            kind: 'synced',
            lines: song.lines.map((text, i) => ({ timeSec: times?.[i] ?? 10 * i, text })),
            source: 'lrclib'
          }
    const extra = addedRows[track.id]
    if (!extra) {
      return {
        trackId: track.id,
        status: 'found',
        lyrics: ownLyrics,
        offsetSec: offsets.get(song.key),
        romaji: song.romaji
      }
    }
    const rows = [...song.lines, ...extra]
    return {
      trackId: track.id,
      status: 'found',
      lyrics: {
        kind: 'synced',
        source: 'lrclib',
        lines: rows.map((text, i) => ({ timeSec: 10 * i, text }))
      },
      offsetSec: offsets.get(song.key),
      romaji: rows.map((_, i) => song.romaji?.[i] ?? ''),
      colors: {
        lines: rows.map(() => null),
        voices: [],
        romajiSplits: rows.map(() => null),
        extra: [],
        own: ownLyrics
      }
    }
  }
  // Like the real service: the lyrics follow the player.
  music.subscribe(() => {
    for (const listener of [...listeners]) listener(get())
  })
  return {
    get,
    currentSong,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    // Like the real service: the song on screen drops its fix.
    command: vi.fn((command: { kind: 'resetOffset' }) => {
      const song = currentSong()
      if (command.kind === 'resetOffset' && song) offsets.set(song.key, 0)
    }),
    currentCoding() {
      const track = music.get().track
      return (track && own[track.id]) ?? null
    }
  }
}

interface FakeStore extends SongColorsStore {
  saved: Map<string, SongColors>
  waveforms: Map<string, Uint8Array>
  /** While set, writes and removes fail as a full disk's would. */
  refuse: boolean
  read: Mock<(key: string) => SongColors | null>
  write: Mock<(key: string, colors: SongColors) => boolean>
  remove: Mock<(key: string) => boolean>
  readWaveform: Mock<(key: string) => Uint8Array | null>
  writeWaveform: Mock<(key: string, peaks: Uint8Array) => void>
}

function fakeStore(
  colors: Record<string, SongColors> = {},
  waves: Record<string, Uint8Array> = {}
): FakeStore {
  const saved = new Map(Object.entries(colors))
  const waveforms = new Map(Object.entries(waves))
  const store: FakeStore = {
    saved,
    waveforms,
    refuse: false,
    read: vi.fn((key: string) => saved.get(key) ?? null),
    write: vi.fn((key: string, value: SongColors) => {
      if (store.refuse) return false
      saved.set(key, value)
      return true
    }),
    remove: vi.fn((key: string) => {
      if (store.refuse) return false
      saved.delete(key)
      waveforms.delete(key)
      return true
    }),
    readWaveform: vi.fn((key: string) => waveforms.get(key) ?? null),
    writeWaveform: vi.fn((key: string, peaks: Uint8Array) => {
      waveforms.set(key, new Uint8Array(peaks))
    }),
    subscribe: () => () => undefined
  }
  return store
}

interface FakeTap extends SingerTap {
  start: Mock<(bundles: string[]) => Promise<StartResult>>
  stop: Mock<() => void>
  access: Mock<() => CaptureAccess | null>
  dispose: Mock<() => void>
  /** Audio heard at `at` (epoch seconds): a tenth of a second, loud, unless told otherwise. */
  hear(at: number, level?: number, seconds?: number): void
}

function fakeTap(): FakeTap {
  const listeners = new Set<(at: number, samples: Int16Array) => void>()
  return {
    start: vi.fn(async (): Promise<StartResult> => ({ ok: true, error: null })),
    stop: vi.fn(),
    onAudio(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    access: vi.fn((): CaptureAccess | null => 'granted'),
    dispose: vi.fn(),
    hear(at, level = 20_000, seconds = 0.1) {
      const samples = new Int16Array(Math.round(seconds * 16_000)).fill(level)
      for (const listener of [...listeners]) listener(at, samples)
    }
  }
}

interface FakePictures extends SingerPictures {
  all: Mock<() => Record<string, string>>
  choose: Mock<SingerPictures['choose']>
  fromPath: Mock<SingerPictures['fromPath']>
  remove: Mock<(id: string) => void>
}

function fakePictures(): FakePictures {
  const listeners = new Set<() => void>()
  let pictures: Record<string, string> = { ichika: 'data:image/png;base64,AAAA' }
  return {
    all: vi.fn(() => pictures),
    choose: vi.fn(async () => ({ ok: true as const })),
    fromPath: vi.fn(() => ({ ok: true as const })),
    remove: vi.fn((id: string) => {
      pictures = Object.fromEntries(Object.entries(pictures).filter(([key]) => key !== id))
      for (const listener of [...listeners]) listener()
    }),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

interface Setup {
  editor: ColorEditor
  music: FakeMusic
  lyrics: FakeLyrics
  store: FakeStore
  offsets: FakeOffsets
  tap: FakeTap
  pictures: FakePictures
  pushes: ColorEditorState[]
}

let current: Setup | null = null

function setup(
  options: {
    music?: Partial<PlaybackState>
    colors?: Record<string, SongColors>
    waves?: Record<string, Uint8Array>
    offsets?: Record<string, number>
    own?: Record<string, SongColors>
    addedRows?: Record<string, string[]>
    ownTimes?: Record<string, number[] | 'plain'>
    listen?: ColorEditorOptions['listen']
  } = {}
): Setup {
  const music = fakeMusic(options.music)
  const offsets = fakeOffsets(options.offsets)
  const lyrics = fakeLyrics(music, offsets, options.own, options.addedRows, options.ownTimes)
  const store = fakeStore(options.colors, options.waves)
  const tap = fakeTap()
  const pictures = fakePictures()
  const editor = createColorEditor({
    store,
    music,
    lyrics,
    offsets,
    openTap: () => tap,
    pictures,
    ...(options.listen ? { listen: options.listen } : {})
  })
  const pushes: ColorEditorState[] = []
  editor.subscribe((state) => pushes.push(state))
  current = { editor, music, lyrics, store, offsets, tap, pictures, pushes }
  return current
}

function colorsOf(editor: ColorEditor): SongColors {
  const colors = editor.state().colors
  if (!colors) throw new Error('no colors')
  return colors
}

/** Temporary folders made for timing runs, deleted after each test. */
const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'focus-screen-listen-test-'))
  tempDirs.push(dir)
  return dir
}

interface FakeAligner {
  /** The factory the editor's runner is given. */
  start: Mock<() => AlignerClient>
  client: AlignerClient & { dispose: Mock<() => void> }
  /** What each run asked, with the size of the WAV it was given. */
  asks: { lines: string[]; language: AlignLanguage | null; bytes: number }[]
  /** Answers the oldest run still out, and lets its answer land. */
  answer(result: AlignResult): Promise<void>
}

function fakeAligner(): FakeAligner {
  const asks: FakeAligner['asks'] = []
  const waiting: ((result: AlignResult) => void)[] = []
  const client = {
    prepare: () => undefined,
    align: (wav: string, lines: string[], language: AlignLanguage | null) => {
      asks.push({ lines, language, bytes: statSync(wav).size })
      return new Promise<AlignResult>((resolve) => waiting.push(resolve))
    },
    dispose: vi.fn()
  }
  return {
    start: vi.fn(() => client),
    client,
    asks,
    async answer(result) {
      waiting.shift()?.(result)
      await vi.advanceTimersByTimeAsync(0)
    }
  }
}

function peaksOf(editor: ColorEditor): Uint8Array {
  const waveform = editor.state().waveform
  if (waveform === null) throw new Error('no waveform')
  return new Uint8Array(Buffer.from(waveform, 'base64'))
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 * 1000 })
})

afterEach(() => {
  current?.editor.dispose()
  current = null
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// --- tests --------------------------------------------------------------------------------

describe('createColorEditor', () => {
  it('opens on the song on screen with its saved colors', () => {
    const { editor, pictures } = setup({ colors: { [KEY_A]: codingA() } })
    expect(editor.state().open).toBe(false)

    editor.open()

    const state = editor.state()
    expect(state.open).toBe(true)
    expect(state.song).toEqual({
      key: KEY_A,
      title: 'Song A',
      artist: 'Leo/need',
      durationSec: 200
    })
    expect(state.colors).toEqual(codingA())
    expect(state.shownLines).toEqual(['one two three', 'four five'])
    expect(state.romaji).toEqual(['ichi ni san', ''])
    expect(state.playingThis).toBe(true)
    expect(state.canSwitch).toBe(false)
    expect(state.canUndo).toBe(false)
    expect(state.canSeek).toBe(true)
    expect(state.pictures).toEqual(pictures.all())
    expect(state.waveformNote).toBeNull()
    expect(peaksOf(editor)).toEqual(emptyPeaks(200))
  })

  it('opens on the lyrics’ own coding when none is saved (the demo’s), and saves only edits', () => {
    const { editor, store } = setup({ own: { a: codingA() } })
    editor.open()
    expect(editor.state().colors).toEqual(codingA())

    // Closing untouched writes nothing: the demo keeps bringing its own.
    editor.close()
    expect(store.write).not.toHaveBeenCalled()

    editor.open()
    editor.command({
      kind: 'edit',
      edit: { kind: 'assign', line: 0, from: 0, to: 1, singers: ['saki'] }
    })
    vi.advanceTimersByTime(500)
    expect(store.write).toHaveBeenCalledWith(KEY_A, colorsOf(editor))
  })

  it('a saved coding wins over the lyrics’ own', () => {
    const saved = { ...codingA(), cast: ['saki', 'ichika'] }
    const { editor } = setup({ colors: { [KEY_A]: saved }, own: { a: codingA() } })
    editor.open()
    expect(editor.state().colors).toEqual(saved)
  })

  it('waits for the renderer to begin a song with no colors yet', () => {
    const { editor } = setup()
    editor.open()
    expect(editor.state().open).toBe(true)
    expect(editor.state().colors).toBeNull()

    editor.command({ kind: 'begin', colors: codingA() })
    expect(editor.state().colors).toEqual(codingA())
  })

  it('stays closed while no song with lyrics is on', () => {
    const { editor } = setup({ music: { track: null } })
    editor.open()
    expect(editor.state().open).toBe(false)
  })

  it('saves half a second after the last edit, once', () => {
    const { editor, store } = setup({ colors: { [KEY_A]: codingA() } })
    editor.open()

    editor.command({
      kind: 'edit',
      edit: { kind: 'assign', line: 0, from: 0, to: 1, singers: ['ichika'] }
    })
    vi.advanceTimersByTime(300)
    editor.command({
      kind: 'edit',
      edit: { kind: 'assign', line: 0, from: 1, to: 2, singers: ['saki'] }
    })
    vi.advanceTimersByTime(499)
    expect(store.write).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(store.write).toHaveBeenCalledTimes(1)
    expect(store.write).toHaveBeenCalledWith(KEY_A, colorsOf(editor))
    expect(colorsOf(editor).lines[0]?.words[1]?.singers).toEqual(['saki'])

    vi.advanceTimersByTime(5000)
    expect(store.write).toHaveBeenCalledTimes(1)
  })

  it('a timing edit clears the song’s offset', () => {
    const { editor, offsets, lyrics } = setup({
      colors: { [KEY_A]: codingA() },
      offsets: { [KEY_A]: 1.5 }
    })
    editor.open()

    // Who sings isn't timing: the fix stays.
    editor.command({
      kind: 'edit',
      edit: { kind: 'assign', line: 0, from: 0, to: 1, singers: ['ichika'] }
    })
    vi.advanceTimersByTime(500)
    expect(offsets.get(KEY_A)).toBe(1.5)

    editor.command({ kind: 'edit', edit: { kind: 'lineTime', line: 1, start: 19.5 } })
    vi.advanceTimersByTime(500)
    expect(offsets.get(KEY_A)).toBe(0)
    // Through the lyrics service, so the Focus Screen drops the fix at once.
    expect(lyrics.command).toHaveBeenCalledWith({ kind: 'resetOffset' })
  })

  it('refuses heard times from the window', () => {
    const { editor } = setup({ colors: { [KEY_A]: codingA() }, music: { playing: true } })
    editor.open()
    const before = colorsOf(editor)
    editor.command({
      kind: 'edit',
      edit: {
        kind: 'heardTimes',
        lines: [
          {
            line: 1,
            start: 21,
            end: 24,
            words: [
              { start: 21, end: 22 },
              { start: 22, end: 24 }
            ]
          }
        ]
      }
    })
    // Only a timing run makes them.
    expect(colorsOf(editor)).toBe(before)
    expect(editor.state().canUndo).toBe(false)
  })

  describe('added lines and the timing fix', () => {
    function withAdded(): SongColors {
      const base = timedA()
      const added: CodedLine = {
        ...codedLine('extra verse', 40, 43, [41]),
        added: true,
        guessed: true
      }
      return { ...base, lines: [...base.lines, added] }
    }

    it('keeps the new edit kinds', () => {
      expect(
        parseColorEditorCommand({
          kind: 'edit',
          edit: { kind: 'moveLine', line: 0, delta: 1, start: 1, end: 2 }
        })
      ).not.toBeNull()
      for (const kind of ['addLines', 'retype', 'removeLine']) {
        expect(parseColorEditorCommand({ kind: 'edit', edit: { kind } })).not.toBeNull()
      }
    })

    it('adds lines only while its song is on', () => {
      const added = (): ShownLine => ({
        text: 'new verse',
        start: 30,
        end: 33,
        words: [
          { text: 'new ', start: 30, end: 31.5 },
          { text: 'verse', start: 31.5, end: 33 }
        ]
      })
      const send = (editor: ReturnType<typeof setup>['editor']): void =>
        editor.command({
          kind: 'edit',
          edit: { kind: 'addLines', at: 2, lines: [added(), added()] }
        })

      for (const away of [
        (m: FakeMusic) => m.play(TRACK_B),
        (m: FakeMusic) => m.set({ track: null })
      ]) {
        const { editor, music } = setup({ colors: { [KEY_A]: timedA() }, music: { playing: true } })
        editor.open()
        const before = colorsOf(editor)
        away(music)
        send(editor)
        expect(colorsOf(editor)).toBe(before)
      }

      // Paused on its own song, then playing: both add.
      for (const playing of [false, true]) {
        const { editor } = setup({ colors: { [KEY_A]: timedA() }, music: { playing } })
        editor.open()
        const count = colorsOf(editor).lines.length
        send(editor)
        expect(colorsOf(editor).lines.length).toBe(count + 2)
      }
    })

    it('moving an added line doesn’t clear the song’s timing fix', () => {
      const { editor, offsets } = setup({
        colors: { [KEY_A]: withAdded() },
        offsets: { [KEY_A]: 0.5 }
      })
      editor.open()
      editor.command({
        kind: 'edit',
        edit: { kind: 'moveLine', line: 2, delta: -1, start: 14.1, end: 17.1 }
      })
      vi.advanceTimersByTime(500)
      expect(offsets.get(KEY_A)).toBe(0.5)
      expect(colorsOf(editor).lines[1]?.start).toBe(14.1)

      editor.command({ kind: 'undo' })
      vi.advanceTimersByTime(500)
      expect(offsets.get(KEY_A)).toBe(0.5)
    })

    it('a move that shifts a voice keeps the fix', () => {
      const base = timedA()
      const x: CodedLine = { ...codedLine('extra verse', 40, 43, [41]), added: true, timed: true }
      const v: CodedLine = { ...codedLine('echo', 39, 40, []), under: 2, timed: true }
      const { editor, offsets } = setup({
        colors: { [KEY_A]: { ...base, lines: [...base.lines, x, v] } },
        offsets: { [KEY_A]: 0.5 }
      })
      editor.open()
      editor.command({
        kind: 'edit',
        edit: { kind: 'moveLine', line: 2, delta: -1, start: 14.1, end: 17.1 }
      })
      vi.advanceTimersByTime(500)
      expect(offsets.get(KEY_A)).toBe(0.5)
    })

    it.each([
      ['one word', 'extra', []],
      ['two words', 'extra verse', [41]]
    ])('undoing a move of a timed added line of %s keeps the fix', (_name, text, cuts) => {
      const base = timedA()
      const x: CodedLine = { ...codedLine(text, 40, 43, cuts), added: true, timed: true }
      const { editor, offsets } = setup({
        colors: { [KEY_A]: { ...base, lines: [...base.lines, x] } },
        offsets: { [KEY_A]: 0.5 }
      })
      editor.open()
      editor.command({
        kind: 'edit',
        edit: { kind: 'moveLine', line: 2, delta: -1, start: 14.1, end: 17.1 }
      })
      vi.advanceTimersByTime(500)
      editor.command({ kind: 'undo' })
      vi.advanceTimersByTime(500)
      expect(offsets.get(KEY_A)).toBe(0.5)
    })

    it('retyping an added line doesn’t clear the song’s timing fix', () => {
      const { editor, offsets } = setup({
        colors: { [KEY_A]: withAdded() },
        offsets: { [KEY_A]: 0.5 }
      })
      editor.open()
      editor.command({
        kind: 'edit',
        edit: {
          kind: 'retype',
          line: 2,
          shown: {
            text: 'extra poem',
            start: 0,
            end: 2,
            words: [
              { text: 'extra ', start: 0, end: 1 },
              { text: 'poem', start: 1, end: 2 }
            ]
          }
        }
      })
      vi.advanceTimersByTime(500)
      expect(colorsOf(editor).lines[2]?.text).toBe('extra poem')
      expect(colorsOf(editor).lines[2]?.words.map((w) => [w.start, w.end])).toStrictEqual([
        [40, 41.5],
        [41.5, 43]
      ])
      expect(offsets.get(KEY_A)).toBe(0.5)
    })
  })

  it('an undone timing edit counts as timing too', () => {
    const { editor, offsets } = setup({
      colors: { [KEY_A]: codingA() },
      offsets: { [KEY_A]: 1.5 }
    })
    editor.open()
    editor.command({ kind: 'edit', edit: { kind: 'wordTime', line: 0, word: 1, start: 10.5 } })
    vi.advanceTimersByTime(500)
    offsets.set(KEY_A, 1) // nudged again afterwards

    editor.command({ kind: 'undo' })
    vi.advanceTimersByTime(500)
    expect(offsets.get(KEY_A)).toBe(0)
    expect(colorsOf(editor).lines[0]?.words[1]?.start).toBe(10)
  })

  it('a timing edit to a song no longer on screen clears its stored offset', () => {
    const { editor, music, offsets, lyrics } = setup({
      colors: { [KEY_A]: codingA() },
      offsets: { [KEY_A]: 1.5 }
    })
    editor.open()
    music.play(TRACK_B)

    editor.command({ kind: 'edit', edit: { kind: 'lineTime', line: 1, end: 26 } })
    vi.advanceTimersByTime(500)
    expect(offsets.set).toHaveBeenCalledWith(KEY_A, 0)
    expect(offsets.get(KEY_A)).toBe(0)
    expect(lyrics.command).not.toHaveBeenCalled()
  })

  it('begin clears the offset at once, and saves the start so the screen doesn’t jump', () => {
    const { editor, offsets, store } = setup({ offsets: { [KEY_A]: 2 } })
    editor.open()
    editor.command({ kind: 'begin', colors: timedA() })

    expect(offsets.get(KEY_A)).toBe(0)
    expect(store.write).toHaveBeenCalledWith(KEY_A, timedA())
  })

  it('begin keeps the offset when no line is timed: the screen still shows the lyrics’ times', () => {
    const { editor, offsets, store } = setup({ offsets: { [KEY_A]: 2 } })
    editor.open()
    editor.command({ kind: 'begin', colors: codingA() })

    expect(editor.state().colors).toEqual(codingA())
    expect(offsets.get(KEY_A)).toBe(2)
    expect(store.write).not.toHaveBeenCalled()
  })

  it('begin with no offset to clear saves nothing until an edit', () => {
    const { editor, store, offsets, music } = setup()
    editor.open()
    editor.command({ kind: 'begin', colors: codingA() })
    vi.advanceTimersByTime(2000)

    // Moving on, and closing, don't write a starting coding nobody touched either.
    music.play(TRACK_B)
    editor.command({ kind: 'switchToPlaying' })
    expect(editor.state().song?.key).toBe(KEY_B)
    editor.command({ kind: 'begin', colors: codingB() })
    expect(editor.state().colors).toEqual(codingB())
    editor.close()
    vi.advanceTimersByTime(2000)

    expect(store.write).not.toHaveBeenCalled()
    expect(offsets.set).not.toHaveBeenCalled()
  })

  it('begin is ignored while another song plays', () => {
    const { editor, music } = setup()
    editor.open()
    music.play(TRACK_B)
    editor.command({ kind: 'begin', colors: codingA() })
    expect(editor.state().colors).toBeNull()
  })

  it('the window gets the lyrics’ own lines, and the shown ones the romaji is under', () => {
    const { editor } = setup({ addedRows: { a: ['a verse the user added'] } })
    editor.open()
    const state = editor.state()
    expect(state.shownLines).toEqual(['one two three', 'four five'])
    expect(state.romajiLines).toEqual(['one two three', 'four five', 'a verse the user added'])
    expect(state.romaji).toEqual(['ichi ni san', '', ''])

    editor.command({ kind: 'begin', colors: codingA() })
    expect(editor.state().colors).not.toBeNull()
  })

  it('begin is ignored when its lines aren’t the song’s', () => {
    const { editor } = setup()
    editor.open()
    editor.command({ kind: 'begin', colors: codingB() })
    expect(editor.state().colors).toBeNull()
    const oneOff = codingA()
    editor.command({
      kind: 'begin',
      colors: { ...oneOff, lines: [oneOff.lines[0], codedLine('four six', 20, 25, [22])] }
    })
    expect(editor.state().colors).toBeNull()
  })

  it('begin checks only the main lines, not second voices', () => {
    const { editor } = setup()
    editor.open()
    const start = codingA()
    const voice: CodedLine = { ...codedLine('echo', 9, 10, []), under: 0 }
    const withVoice = { ...start, lines: [start.lines[0], voice, start.lines[1]] }
    const blank = { ...start, lines: [...start.lines, codedLine('', 30, 31, [])] }
    editor.command({ kind: 'begin', colors: withVoice })
    expect(editor.state().colors?.lines).toHaveLength(3)
    editor.command({ kind: 'removeAll' })
    editor.command({ kind: 'begin', colors: blank })
    expect(editor.state().colors?.lines).toHaveLength(3)
  })

  it('begin with garbage is ignored', () => {
    const { editor, offsets, store } = setup({ offsets: { [KEY_A]: 2 } })
    editor.open()

    editor.command({ kind: 'begin', colors: 'nope' })
    editor.command({ kind: 'begin', colors: { version: 1, lines: 'x', cast: [], extra: [] } })
    editor.command({ kind: 'begin', colors: { ...codingA(), version: 2 } })

    expect(editor.state().colors).toBeNull()
    expect(offsets.get(KEY_A)).toBe(2)
    expect(store.write).not.toHaveBeenCalled()
  })

  it('begin is ignored once the song has colors', () => {
    const { editor } = setup({ colors: { [KEY_A]: codingA() } })
    editor.open()
    const other = { ...codingA(), cast: ['saki'] }
    editor.command({ kind: 'begin', colors: other })
    expect(editor.state().colors).toEqual(codingA())
  })

  it('ignores taps and audio while another song plays', async () => {
    const { editor, music, tap, store } = setup({
      colors: { [KEY_A]: codingA() },
      music: { playing: true, positionSec: 10 }
    })
    editor.open()
    await vi.advanceTimersByTimeAsync(0)
    expect(tap.start).toHaveBeenCalledWith(['com.apple.Music'])

    music.play(TRACK_B, 30)
    const state = editor.state()
    expect(state.playingThis).toBe(false)
    expect(state.canSwitch).toBe(true)
    expect(state.song?.key).toBe(KEY_A)
    // Not listening while it's another song.
    expect(tap.stop).toHaveBeenCalled()

    const before = colorsOf(editor)
    editor.command({ kind: 'tap', phase: 'down', line: 0, word: 1 })
    vi.advanceTimersByTime(300)
    editor.command({ kind: 'tap', phase: 'up', line: 0, word: 1 })
    editor.command({ kind: 'playLine', line: 0 })
    tap.hear(Date.now() / 1000)
    await vi.advanceTimersByTimeAsync(6000)

    expect(colorsOf(editor)).toBe(before)
    expect(music.command).not.toHaveBeenCalled()
    expect(peaksOf(editor)).toEqual(emptyPeaks(200))
    expect(store.writeWaveform).not.toHaveBeenCalled()

    // Who sings can still be changed, and it's saved for its own song.
    editor.command({
      kind: 'edit',
      edit: { kind: 'assign', line: 1, from: 0, to: 2, singers: ['saki'] }
    })
    vi.advanceTimersByTime(500)
    expect(store.write).toHaveBeenCalledWith(KEY_A, colorsOf(editor))

    // Back on its song, taps count again.
    music.play(TRACK_A, 10)
    expect(editor.state().playingThis).toBe(true)
    vi.advanceTimersByTime(500)
    editor.command({ kind: 'tap', phase: 'down', line: 0, word: 1 })
    expect(colorsOf(editor).lines[0]?.words[1]?.start).toBeCloseTo(10.5, 3)
  })

  it('ignores taps while its song is paused', () => {
    const { editor } = setup({ colors: { [KEY_A]: codingA() }, music: { positionSec: 10 } })
    editor.open()
    const before = colorsOf(editor)
    editor.command({ kind: 'tap', phase: 'down', line: 0, word: 1 })
    expect(colorsOf(editor)).toBe(before)
  })

  it('play line seeks, plays, and pauses past the end', () => {
    const { editor, music } = setup({
      colors: { [KEY_A]: codingA() },
      music: { positionSec: 50 }
    })
    editor.open()

    // Line 1 runs 20–25 s.
    editor.command({ kind: 'playLine', line: 1 })
    expect(music.command.mock.calls.map(([command]) => command)).toEqual([
      { kind: 'seek', positionSec: 20 },
      { kind: 'playPause' }
    ])
    expect(music.get().playing).toBe(true)

    vi.advanceTimersByTime(4900)
    expect(music.command).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(200)
    expect(music.command).toHaveBeenCalledTimes(3)
    expect(music.command).toHaveBeenLastCalledWith({ kind: 'playPause' })
    expect(music.get().playing).toBe(false)
  })

  it('replay plays from the line before and pauses past the line', () => {
    const { editor, music } = setup({
      colors: { [KEY_A]: codingA() },
      music: { positionSec: 50 }
    })
    editor.open()

    // Line 1 runs 20–25 s; the line before starts at 9 s.
    editor.command({ kind: 'replayLine', line: 1 })
    expect(music.command.mock.calls.map(([command]) => command)).toEqual([
      { kind: 'seek', positionSec: 9 },
      { kind: 'playPause' }
    ])
    vi.advanceTimersByTime(15_900)
    expect(music.command).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(200)
    expect(music.command).toHaveBeenLastCalledWith({ kind: 'playPause' })
    expect(music.get().playing).toBe(false)
  })

  it('play line follows a seek made while it plays', () => {
    const { editor, music } = setup({
      colors: { [KEY_A]: codingA() },
      music: { playing: true, positionSec: 50 }
    })
    editor.open()
    editor.command({ kind: 'playLine', line: 1 })
    // Already playing: a seek and nothing else.
    expect(music.command).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(2000)
    // Back to the line's start by hand: a bare 5 s timer would pause 2 s too early.
    music.seekTo(20)
    vi.advanceTimersByTime(3500)
    expect(music.get().playing).toBe(true)
    vi.advanceTimersByTime(1600)
    expect(music.get().playing).toBe(false)
    expect(music.command).toHaveBeenCalledTimes(2)
  })

  it('play line is off when the player can’t seek', () => {
    const { editor, music } = setup({
      colors: { [KEY_A]: codingA() },
      music: { track: { ...TRACK_A, durationSec: 0 } }
    })
    editor.open()
    expect(editor.state().canSeek).toBe(false)
    editor.command({ kind: 'playLine', line: 0 })
    expect(music.command).not.toHaveBeenCalled()
  })

  it('a seek between a tap’s down and up drops the down', () => {
    const { editor, music } = setup({
      colors: { [KEY_A]: codingA() },
      music: { playing: true, positionSec: 10 }
    })
    editor.open()
    vi.advanceTimersByTime(500)
    editor.command({ kind: 'tap', phase: 'down', line: 0, word: 1 })
    vi.advanceTimersByTime(200)
    music.seekTo(10.7)
    vi.advanceTimersByTime(300)
    music.seekTo(50)
    vi.advanceTimersByTime(200)
    editor.command({ kind: 'tap', phase: 'up', line: 0, word: 1 })
    // Where the down left it (10–12 moved to start at 10.5), not at 50.
    expect(colorsOf(editor).lines[0]?.words[1]?.end).toBeCloseTo(12.5, 3)
  })

  it('tap down and up time a word', () => {
    const { editor } = setup({
      colors: { [KEY_A]: codingA() },
      music: { playing: true, positionSec: 10 }
    })
    editor.open()

    vi.advanceTimersByTime(500)
    editor.command({ kind: 'tap', phase: 'down', line: 0, word: 1 })
    expect(colorsOf(editor).lines[0]?.words[1]?.start).toBeCloseTo(10.5, 3)

    // A quick press is only the start: the word keeps its length (10–12), moved along.
    vi.advanceTimersByTime(100)
    editor.command({ kind: 'tap', phase: 'up', line: 0, word: 1 })
    expect(colorsOf(editor).lines[0]?.words[1]?.end).toBeCloseTo(12.5, 3)

    vi.advanceTimersByTime(400)
    editor.command({ kind: 'tap', phase: 'down', line: 0, word: 1 })
    vi.advanceTimersByTime(400)
    editor.command({ kind: 'tap', phase: 'up', line: 0, word: 1 })
    const word = colorsOf(editor).lines[0]?.words[1]
    expect(word?.start).toBeCloseTo(11, 3)
    expect(word?.end).toBeCloseTo(11.4, 3)
    expect(editor.state().canUndo).toBe(true)
  })

  it('a late tap lands where it was tapped, past the next word’s old start', () => {
    const { editor } = setup({
      colors: { [KEY_A]: codingA() },
      music: { playing: true, positionSec: 11 }
    })
    editor.open()

    // Words start at 9, 10 and 12; the first is tapped at 11, after the second's old start.
    editor.command({ kind: 'tap', phase: 'down', line: 0, word: 0 })

    const words = colorsOf(editor).lines[0]?.words ?? []
    expect(words.map((word) => word.start)).toEqual([11, 12, 14])
    expect(colorsOf(editor).lines[0]?.timed).toBe(true)
  })

  describe('taps snap to sound', () => {
    /** Song A playing from 9 s, the tap listening; the player's audio quiet, then loud from 10.24 s. */
    async function playing(coding: SongColors = codingA()): Promise<Setup> {
      const ready = setup({
        colors: { [KEY_A]: coding },
        music: { playing: true, positionSec: 9 }
      })
      ready.editor.open()
      await vi.advanceTimersByTimeAsync(0)
      expect(ready.tap.start).toHaveBeenCalled()
      // Song time 9 s is T0, so 10.24 s is T0 + 1.24.
      ready.tap.hear(T0, 300, 1.24)
      ready.tap.hear(T0 + 1.24, 20_000, 1)
      return ready
    }

    it('a tap lands on the sound it was meant for', async () => {
      const { editor } = await playing()
      const start = colorsOf(editor)

      // Pressed at 10.2 s, a little early: the outline there isn't heard yet.
      await vi.advanceTimersByTimeAsync(1200)
      editor.command({ kind: 'tap', phase: 'down', line: 0, word: 0 })
      expect(colorsOf(editor)).toBe(start)

      await vi.advanceTimersByTimeAsync(2000)
      const landed = colorsOf(editor).lines[0]?.words[0]?.start ?? 0
      expect(Math.abs(landed - 10.24)).toBeLessThanOrEqual(0.02)
      expect(editor.state().canUndo).toBe(true)
    })

    it('undo right after a tap undoes that tap', async () => {
      const { editor } = await playing()
      const start = colorsOf(editor)
      await vi.advanceTimersByTimeAsync(1200)
      editor.command({ kind: 'tap', phase: 'down', line: 0, word: 0 })
      expect(colorsOf(editor)).toBe(start)

      editor.command({ kind: 'undo' })
      expect(colorsOf(editor)).toEqual(start)
      expect(editor.state().canRedo).toBe(true)

      // It doesn't land again later, once the outline is heard.
      await vi.advanceTimersByTimeAsync(4000)
      expect(colorsOf(editor)).toEqual(start)
    })

    it('a tap lands at once where there’s no waveform', async () => {
      const { editor, tap } = setup({
        colors: { [KEY_A]: codingA() },
        music: { playing: true, positionSec: 10 }
      })
      tap.access.mockReturnValue('denied')
      editor.open()
      await vi.advanceTimersByTimeAsync(500)
      editor.command({ kind: 'tap', phase: 'down', line: 0, word: 1 })
      expect(colorsOf(editor).lines[0]?.words[1]?.start).toBeCloseTo(10.5, 3)
    })

    it('a whole-line tap snaps too, and moves a timed line rather than stretching it', async () => {
      const { editor } = await playing(timedA())
      const start = colorsOf(editor)
      // Pressed at 10.2 s, as Tap: Lines sends it.
      await vi.advanceTimersByTimeAsync(1200)
      editor.command({ kind: 'tap', phase: 'down', line: 0, word: 0, whole: true })
      expect(colorsOf(editor)).toBe(start)
      // Letting go half a second later marks no end: a line has none to hold to.
      await vi.advanceTimersByTimeAsync(500)
      editor.command({ kind: 'tap', phase: 'up', line: 0, word: 0 })

      await vi.advanceTimersByTimeAsync(2000)
      const moved = colorsOf(editor).lines[0]
      const by = (moved?.start ?? 0) - 9
      expect(Math.abs((moved?.start ?? 0) - 10.24)).toBeLessThanOrEqual(0.02)
      expect(moved?.end).toBeCloseTo(14 + by, 6)
      const words = moved?.words.map((one) => [one.start, one.end]) ?? []
      const shifted = [
        [9, 10],
        [10, 12],
        [12, 14]
      ].map(([from, to]) => [(from ?? 0) + by, (to ?? 0) + by])
      words.forEach((pair, i) => {
        expect(pair[0]).toBeCloseTo(shifted[i]?.[0] ?? -1, 6)
        expect(pair[1]).toBeCloseTo(shifted[i]?.[1] ?? -1, 6)
      })
      expect(moved?.timed).toBe(true)
    })

    it('closing lands a waiting tap and saves it', async () => {
      const { editor, store } = await playing()
      const start = colorsOf(editor)
      await vi.advanceTimersByTimeAsync(1200)
      editor.command({ kind: 'tap', phase: 'down', line: 0, word: 0 })
      expect(colorsOf(editor)).toBe(start)
      editor.close()
      expect(store.saved.get(KEY_A)?.lines[0]?.words[0]?.start).toBeCloseTo(10.2, 3)
    })

    it('a note the page drops leaves a waiting tap to snap', async () => {
      const { editor } = await playing()
      const start = colorsOf(editor)
      await vi.advanceTimersByTimeAsync(1200)
      editor.command({ kind: 'tap', phase: 'down', line: 0, word: 0 })
      // Sent as Tap: Lines moves the selection off a note's lines: nothing the user asked for.
      editor.command({ kind: 'clearNote', note: NOT_HEARD_NOTE })
      expect(colorsOf(editor)).toBe(start)
    })
  })

  it('switchToPlaying saves and moves to the new song', () => {
    const coloredB: SongColors = {
      version: 1,
      lines: [codedLine('other song', 5, 8, [6])],
      cast: [],
      extra: []
    }
    const { editor, music, store } = setup({
      colors: { [KEY_A]: codingA(), [KEY_B]: coloredB },
      music: { playing: true }
    })
    editor.open()
    editor.command({
      kind: 'edit',
      edit: { kind: 'assign', line: 0, from: 0, to: 1, singers: ['ichika'] }
    })
    const edited = colorsOf(editor)

    music.play(TRACK_B)
    expect(editor.state().song?.key).toBe(KEY_A)

    editor.command({ kind: 'switchToPlaying' })
    expect(store.write).toHaveBeenCalledWith(KEY_A, edited)
    const state = editor.state()
    expect(state.song?.key).toBe(KEY_B)
    expect(state.colors).toEqual(coloredB)
    expect(state.shownLines).toEqual(['other song'])
    expect(state.playingThis).toBe(true)
    expect(state.canUndo).toBe(false)

    vi.advanceTimersByTime(2000)
    expect(store.write).toHaveBeenCalledTimes(1)
  })

  it('switchToPlaying does nothing while its own song plays', () => {
    const { editor, store } = setup({ colors: { [KEY_A]: codingA() } })
    editor.open()
    editor.command({ kind: 'switchToPlaying' })
    expect(editor.state().song?.key).toBe(KEY_A)
    expect(store.write).not.toHaveBeenCalled()
  })

  it('removeAll deletes colors and waveform', async () => {
    const { editor, store, tap } = setup({
      colors: { [KEY_A]: codingA() },
      music: { playing: true, positionSec: 10 }
    })
    editor.open()
    await vi.advanceTimersByTimeAsync(1000)
    tap.hear(Date.now() / 1000)
    editor.command({
      kind: 'edit',
      edit: { kind: 'assign', line: 0, from: 0, to: 1, singers: ['ichika'] }
    })
    await vi.advanceTimersByTimeAsync(2000)
    expect(peaksOf(editor).some((peak) => peak > 0)).toBe(true)

    editor.command({ kind: 'removeAll' })
    expect(store.remove).toHaveBeenCalledWith(KEY_A)
    expect(editor.state().colors).toBeNull()
    expect(editor.state().canUndo).toBe(false)
    expect(peaksOf(editor)).toEqual(emptyPeaks(200))

    // Nothing comes back from before.
    store.write.mockClear()
    store.writeWaveform.mockClear()
    await vi.advanceTimersByTimeAsync(6000)
    expect(store.write).not.toHaveBeenCalled()
    expect(store.writeWaveform).not.toHaveBeenCalled()
  })

  it('fills the waveform from the tap and saves it every 5 s and on close', async () => {
    const { editor, store, tap } = setup({
      colors: { [KEY_A]: codingA() },
      music: { playing: true, positionSec: 10 }
    })
    editor.open()
    await vi.advanceTimersByTimeAsync(2000)
    // Heard 1.9 s in: 11.9 s into the song.
    tap.hear(T0 + 1.9)
    await vi.advanceTimersByTimeAsync(2000)

    const peaks = peaksOf(editor)
    expect(peaks[Math.round(11.95 / 0.02)]).toBeGreaterThan(0)
    expect(peaks[Math.round(11.5 / 0.02)]).toBe(0)
    expect(store.writeWaveform).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    expect(store.writeWaveform).toHaveBeenCalledTimes(1)
    expect(store.waveforms.get(KEY_A)).toEqual(peaks)

    tap.hear(Date.now() / 1000)
    await vi.advanceTimersByTimeAsync(2000)
    editor.close()
    expect(store.writeWaveform).toHaveBeenCalledTimes(2)
    expect(tap.dispose).toHaveBeenCalled()
    expect(editor.state().open).toBe(false)
  })

  it('keeps audio from around a seek out of the waveform', async () => {
    const { editor, tap, music } = setup({
      colors: { [KEY_A]: codingA() },
      music: { playing: true, positionSec: 10 }
    })
    editor.open()
    await vi.advanceTimersByTimeAsync(3000)
    // Heard just after the player jumped, before it said so.
    tap.hear(T0 + 2.9)
    music.seekTo(100)
    await vi.advanceTimersByTimeAsync(3000)
    expect(peaksOf(editor).every((peak) => peak === 0)).toBe(true)
  })

  it('drops audio still waiting when the player seeks', async () => {
    const { editor, tap, music } = setup({
      colors: { [KEY_A]: codingA() },
      music: { playing: true, positionSec: 10 }
    })
    editor.open()
    await vi.advanceTimersByTimeAsync(3000)
    // Heard at 11.6 s into the song, still waiting when the seek is noticed.
    tap.hear(T0 + 1.6)
    await vi.advanceTimersByTimeAsync(200)
    music.seekTo(100)
    await vi.advanceTimersByTimeAsync(3000)
    const peaks = peaksOf(editor)
    expect(peaks[Math.round(98.45 / 0.02)]).toBe(0)
    expect(peaks[Math.round(11.65 / 0.02)]).toBe(0)
  })

  it('pushes the waveform to the windows at most twice a second', async () => {
    const { editor, tap, pushes } = setup({
      colors: { [KEY_A]: codingA() },
      music: { playing: true, positionSec: 10 }
    })
    editor.open()
    await vi.advanceTimersByTimeAsync(2000)
    pushes.length = 0
    for (let i = 0; i < 30; i++) {
      tap.hear(Date.now() / 1000)
      await vi.advanceTimersByTimeAsync(100)
    }
    // 3 s of audio, 10 chunks a second.
    expect(pushes.length).toBeGreaterThan(0)
    expect(pushes.length).toBeLessThanOrEqual(6)
  })

  it('fits a saved waveform a second off, and drops one further off', () => {
    const fitting = emptyPeaks(200)
    const short = new Uint8Array(fitting.length - 30).fill(7)
    const first = setup({ colors: { [KEY_A]: codingA() }, waves: { [KEY_A]: short } })
    first.editor.open()
    const padded = peaksOf(first.editor)
    expect(padded.length).toBe(fitting.length)
    expect(padded[0]).toBe(7)
    expect(padded[fitting.length - 1]).toBe(0)
    first.editor.dispose()

    const far = new Uint8Array(fitting.length + 80).fill(7)
    const second = setup({ colors: { [KEY_A]: codingA() }, waves: { [KEY_A]: far } })
    second.editor.open()
    expect(peaksOf(second.editor)).toEqual(fitting)
  })

  it('says why there’s no waveform when recording isn’t allowed', () => {
    const { editor, tap } = setup({ colors: { [KEY_A]: codingA() } })
    tap.access.mockReturnValue('denied')
    editor.open()
    expect(editor.state().waveform).toBeNull()
    expect(editor.state().waveformNote).toMatch(/Recording isn't allowed/)
  })

  it('has no waveform without a tap', () => {
    const music = fakeMusic()
    const offsets = fakeOffsets()
    const editor = createColorEditor({
      store: fakeStore({ [KEY_A]: codingA() }),
      music,
      lyrics: fakeLyrics(music, offsets),
      offsets,
      openTap: () => null,
      noTapNote: 'There’s no waveform on Windows yet.',
      pictures: null
    })
    editor.open()
    expect(editor.state().waveform).toBeNull()
    expect(editor.state().waveformNote).toBe('There’s no waveform on Windows yet.')
    expect(editor.state().pictures).toEqual({})
    editor.dispose()
  })

  it('passes picture commands on and shows the new pictures', () => {
    const { editor, pictures } = setup({ colors: { [KEY_A]: codingA() } })
    editor.open()
    editor.command({ kind: 'pictureFromPath', singer: 'saki', path: '/tmp/saki.png' })
    expect(pictures.fromPath).toHaveBeenCalledWith('saki', '/tmp/saki.png')
    editor.command({ kind: 'choosePicture', singer: 'saki' })
    expect(pictures.choose).toHaveBeenCalledWith(null, 'saki')
    editor.command({ kind: 'removePicture', singer: 'ichika' })
    expect(editor.state().pictures).toEqual({})
  })

  it('says why a picture was refused, until the next command', async () => {
    const { editor, pictures } = setup({ colors: { [KEY_A]: codingA() } })
    editor.open()
    expect(editor.state().notice).toBeNull()

    pictures.fromPath.mockReturnValueOnce({ ok: false, message: 'That file isn’t a picture.' })
    editor.command({ kind: 'pictureFromPath', singer: 'saki', path: '/tmp/notes.txt' })
    expect(editor.state().notice).toBe('That file isn’t a picture.')
    editor.command({ kind: 'undo' })
    expect(editor.state().notice).toBeNull()

    pictures.choose.mockResolvedValueOnce({ ok: false, message: 'That picture is too big.' })
    editor.command({ kind: 'choosePicture', singer: 'saki' })
    await vi.advanceTimersByTimeAsync(0)
    expect(editor.state().notice).toBe('That picture is too big.')
    editor.command({ kind: 'redo' })
    expect(editor.state().notice).toBeNull()
  })

  it('keeps an edit the disk refused unsaved, says so, and tries again', () => {
    const { editor, store } = setup({ colors: { [KEY_A]: codingA() } })
    editor.open()
    store.refuse = true

    editor.command({
      kind: 'edit',
      edit: { kind: 'assign', line: 0, from: 0, to: 1, singers: ['saki'] }
    })
    vi.advanceTimersByTime(500)
    expect(store.write).toHaveBeenCalledTimes(1)
    expect(editor.state().notice).toBe(SAVE_FAILED_NOTE)

    // The next change tries again, the first one with it.
    editor.command({
      kind: 'edit',
      edit: { kind: 'assign', line: 0, from: 1, to: 2, singers: ['saki'] }
    })
    vi.advanceTimersByTime(500)
    expect(store.write).toHaveBeenCalledTimes(2)
    expect(editor.state().notice).toBe(SAVE_FAILED_NOTE)

    // And closing does too, now that there's room.
    store.refuse = false
    const colors = colorsOf(editor)
    editor.close()
    expect(store.write).toHaveBeenCalledTimes(3)
    expect(store.saved.get(KEY_A)).toEqual(colors)
  })

  it('a begun coding the disk refused is written again on the next save', () => {
    const { editor, store } = setup({ offsets: { [KEY_A]: 2 } })
    editor.open()
    store.refuse = true
    editor.command({ kind: 'begin', colors: timedA() })
    expect(editor.state().notice).toBe(SAVE_FAILED_NOTE)

    store.refuse = false
    editor.close()
    expect(store.saved.get(KEY_A)).toEqual(timedA())
  })

  it('keeps the colors when removing them fails, and says so', () => {
    const { editor, store } = setup({ colors: { [KEY_A]: codingA() } })
    editor.open()
    store.refuse = true

    editor.command({ kind: 'removeAll' })

    expect(editor.state().colors).toEqual(codingA())
    expect(editor.state().notice).toBe(REMOVE_FAILED_NOTE)
  })

  describe('lines the lyrics have now', () => {
    /** Song A's coding from before its lyrics changed: the first line had a typo, the second wasn't there. */
    function older(): SongColors {
      return { ...codingA(), lines: [codedLine('one two tree', 9, 14, [10, 12])] }
    }
    const fourFive: ShownLine = {
      text: 'four five',
      start: 20,
      end: 25,
      words: [
        { text: 'four ', start: 20, end: 22 },
        { text: 'five', start: 22, end: 25 }
      ]
    }
    const oneTwoThree: ShownLine = {
      text: 'one two three',
      start: 0,
      end: 9,
      words: [
        { text: 'one ', start: 0, end: 3 },
        { text: 'two ', start: 3, end: 6 },
        { text: 'three', start: 6, end: 9 }
      ]
    }

    it('adds a shown line on its first edit, in one step', () => {
      const { editor } = setup({ colors: { [KEY_A]: older() } })
      editor.open()

      editor.command({
        kind: 'edit',
        edit: {
          kind: 'addLine',
          at: 1,
          shown: fourFive,
          then: { kind: 'assign', line: 1, from: 0, to: 2, singers: ['saki'] }
        }
      })

      expect(colorsOf(editor).lines.map((line) => line.text)).toEqual(['one two tree', 'four five'])
      expect(colorsOf(editor).lines[1]?.words.map((word) => word.singers)).toEqual([
        ['saki'],
        ['saki']
      ])
      editor.command({ kind: 'undo' })
      expect(colorsOf(editor)).toEqual(older())
    })

    it('takes the new words for a changed line', () => {
      const { editor } = setup({ colors: { [KEY_A]: older() } })
      editor.open()

      editor.command({ kind: 'edit', edit: { kind: 'newWords', line: 0, shown: oneTwoThree } })

      expect(colorsOf(editor).lines[0]?.text).toBe('one two three')
    })

    it('takes neither a line the song doesn’t have, nor one put out of order', () => {
      const { editor } = setup({ colors: { [KEY_A]: older() } })
      editor.open()
      const notTheSongs = {
        ...fourFive,
        text: 'four six',
        words: [{ text: 'four six', start: 20, end: 25 }]
      }

      editor.command({ kind: 'edit', edit: { kind: 'addLine', at: 1, shown: notTheSongs } })
      editor.command({ kind: 'edit', edit: { kind: 'newWords', line: 0, shown: notTheSongs } })
      expect(colorsOf(editor)).toEqual(older())
    })

    it('takes an added line only where it lines up with the song’s order', () => {
      const onlyFourFive = { ...codingA(), lines: [codedLine('four five', 20, 25, [22])] }
      const { editor } = setup({ colors: { [KEY_A]: onlyFourFive } })
      editor.open()

      // "one two three" is sung before "four five", so it can't go after it.
      editor.command({ kind: 'edit', edit: { kind: 'addLine', at: 1, shown: oneTwoThree } })
      expect(colorsOf(editor)).toEqual(onlyFourFive)

      editor.command({ kind: 'edit', edit: { kind: 'addLine', at: 0, shown: oneTwoThree } })
      expect(colorsOf(editor).lines.map((line) => line.text)).toEqual([
        'one two three',
        'four five'
      ])
    })

    it('takes neither while another song plays', () => {
      const { editor, music } = setup({ colors: { [KEY_A]: older() } })
      editor.open()
      music.play(TRACK_B)

      editor.command({ kind: 'edit', edit: { kind: 'addLine', at: 1, shown: fourFive } })
      editor.command({ kind: 'edit', edit: { kind: 'newWords', line: 0, shown: oneTwoThree } })

      expect(colorsOf(editor)).toEqual(older())
    })

    it('puts a line back on the lyrics’ time only while its song is on (Delete)', () => {
      const later = (shift: number): ShownLine => ({
        ...oneTwoThree,
        start: oneTwoThree.start + shift,
        end: oneTwoThree.end + shift,
        words: oneTwoThree.words.map((w) => ({ ...w, start: w.start + shift, end: w.end + shift }))
      })
      const elsewhere = setup({ colors: { [KEY_A]: codingA() } })
      elsewhere.editor.open()
      elsewhere.music.play(TRACK_B)
      elsewhere.editor.command({
        kind: 'edit',
        edit: { kind: 'resetTimes', line: 0, shown: later(30) }
      })
      expect(colorsOf(elsewhere.editor)).toEqual(codingA())

      const { editor } = setup({ colors: { [KEY_A]: codingA() } })
      editor.open()
      editor.command({ kind: 'edit', edit: { kind: 'resetTimes', line: 0, shown: later(30) } })
      expect(colorsOf(editor).lines[0]).toMatchObject({ start: 30, end: 39 })
    })
  })

  describe('time by listening', () => {
    /**
     * The setup's player plays song time from..to and its tap hears it a second at a time, as
     * it plays. The outline places what's heard HOLD_SEC later: `settle`.
     */
    async function hearPlaying(from: number, to: number): Promise<void> {
      if (!current) throw new Error('no setup')
      const { tap, music } = current
      for (let t = from; t < to; t++) {
        const seconds = Math.min(1, to - t)
        const { positionSec, positionAt } = music.get()
        const at = positionAt + (t - positionSec)
        const heardAt = (at + seconds) * 1000
        if (heardAt > Date.now()) await vi.advanceTimersByTimeAsync(heardAt - Date.now())
        tap.hear(at, 20_000, seconds)
      }
    }
    async function settle(): Promise<void> {
      await vi.advanceTimersByTimeAsync(2000)
    }

    /** A line as the page sends it with `addLines`: its words spread evenly over start..end. */
    function shown(text: string, start: number, end: number): ShownLine {
      const pieces = text.split(' ')
      const step = (end - start) / pieces.length
      return {
        text,
        start,
        end,
        words: pieces.map((piece, i) => ({
          text: i < pieces.length - 1 ? `${piece} ` : piece,
          start: start + step * i,
          end: start + step * (i + 1)
        }))
      }
    }

    /** Song A's two lines timed at `a` and `c`, 4 s each; its own lyrics say the same. */
    function timedAC(a: number, c: number): SongColors {
      return {
        ...codingA(),
        lines: [
          { ...codedLine('one two three', a, a + 4, [a + 1, a + 2]), timed: true },
          { ...codedLine('four five', c, c + 4, [c + 2]), timed: true }
        ]
      }
    }

    /** Song A with a line between its own two, all timed. */
    function threeTimed(): SongColors {
      return {
        ...codingA(),
        lines: [
          { ...codedLine('one two three', 10, 14, [11, 12]), timed: true },
          { ...codedLine('in between', 20, 24, [22]), timed: true },
          { ...codedLine('four five', 30, 34, [32]), timed: true }
        ]
      }
    }

    function addXY(
      editor: ColorEditor,
      at: number,
      x: [number, number],
      y: [number, number]
    ): void {
      editor.command({
        kind: 'edit',
        edit: { kind: 'addLines', at, lines: [shown('X ray', ...x), shown('Y axis', ...y)] }
      })
    }

    it('times added lines by itself once their stretch has played through', async () => {
      const aligner = fakeAligner()
      const { editor } = setup({
        colors: { [KEY_A]: timedAC(10, 30) },
        ownTimes: { a: [10, 30] },
        music: { playing: true, positionSec: 15 },
        listen: { aligner: aligner.start, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      addXY(editor, 1, [15, 22], [22, 29])

      await hearPlaying(15, 29)
      await settle()
      // Not all of it yet: up to the next line's real start, 30.
      expect(aligner.asks).toEqual([])

      await hearPlaying(29, 30)
      await settle()
      expect(aligner.asks.map((ask) => ask.lines)).toEqual([['X ray', 'Y axis']])
      expect(editor.state().listen?.timing).toEqual([1, 2])

      await aligner.answer({
        ok: true,
        lines: [
          { start: 0.6, end: 4.1 },
          { start: 8, end: 14 }
        ]
      })
      // The clip started at 14.5.
      const [x, y] = colorsOf(editor).lines.slice(1, 3)
      expect(x?.start).toBeCloseTo(15.1, 6)
      expect(x?.end).toBeCloseTo(18.6, 6)
      expect(y?.start).toBeCloseTo(22.5, 6)
      expect(y?.end).toBeCloseTo(28.5, 6)
      for (const line of [x, y]) {
        expect(line?.timed).toBe(true)
        expect(line?.guessed).toBeUndefined()
      }
      expect(editor.state().listen).toMatchObject({ timing: [], note: null })

      // Once.
      await hearPlaying(30, 35)
      await settle()
      expect(aligner.asks).toHaveLength(1)
    })

    it('cuts the recording in song time under a timing fix (R15)', async () => {
      const aligner = fakeAligner()
      const { editor, offsets } = setup({
        colors: { [KEY_A]: timedAC(10.5, 30.5) },
        ownTimes: { a: [10.5, 30.5] },
        offsets: { [KEY_A]: 0.5 },
        music: { playing: true, positionSec: 15 },
        listen: { aligner: aligner.start, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      expect(editor.state().listen?.fixSec).toBe(0.5)
      // Pressed at 15, stored at 15.5: the fix lights it at the press.
      addXY(editor, 1, [15.5, 22.5], [22.5, 29.5])

      // Song time only: the screen's 15.5–30.5 less the fix.
      await hearPlaying(15, 30)
      await settle()
      expect(aligner.asks).toHaveLength(1)
      // 14.5–30.5, padded half a second each side.
      expect(aligner.asks[0]?.bytes).toBe(44 + 2 * 16 * 16_000)

      await aligner.answer({
        ok: true,
        lines: [
          { start: 0.6, end: 4.1 },
          { start: 8.5, end: 14.5 }
        ]
      })
      // In song time, as a tap is.
      expect(colorsOf(editor).lines[1]?.start).toBeCloseTo(15.1, 6)
      expect(colorsOf(editor).lines[1]?.end).toBeCloseTo(18.6, 6)

      // Timed, as a tap would: the fix goes with the save.
      expect(offsets.get(KEY_A)).toBe(0.5)
      vi.advanceTimersByTime(SAVE_DELAY_MS)
      expect(offsets.get(KEY_A)).toBe(0)
    })

    it('leaves lines pressed too close to the next line for the user, rather than cram them', async () => {
      const aligner = fakeAligner()
      const { editor, offsets } = setup({
        colors: { [KEY_A]: timedAC(10, 22) },
        ownTimes: { a: [10, 22] },
        offsets: { [KEY_A]: 0.5 },
        music: { playing: true, positionSec: 19.5 },
        listen: { aligner: aligner.start, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      // Pressed at 19.5, stored at 20 under the fix, the next line's real start at 22: two
      // seconds for four lines. The page spreads them over 30 s, past that start.
      const verse = [
        shown('one a', 20, 27.5),
        shown('two b', 27.5, 35),
        shown('three c', 35, 42.5),
        shown('four d', 42.5, 50)
      ]
      editor.command({ kind: 'edit', edit: { kind: 'addLines', at: 1, lines: verse } })

      await hearPlaying(19.5, 50)
      await settle()
      expect(aligner.asks).toEqual([])
      expect(editor.state().listen).toMatchObject({ timing: [], note: CRAMPED_NOTE })
      for (const line of colorsOf(editor).lines.slice(1, 5)) {
        expect(line.guessed).toBe(true)
        expect(line.timed).toBeUndefined()
      }
      // Nothing was timed, so the song's timing fix stays.
      vi.advanceTimersByTime(SAVE_DELAY_MS)
      expect(offsets.get(KEY_A)).toBe(0.5)
    })

    it('times the rest of a cramped verse once its first line’s start is tapped', async () => {
      const aligner = fakeAligner()
      const { editor, music } = setup({
        colors: { [KEY_A]: timedAC(10, 22) },
        ownTimes: { a: [10, 22] },
        music: { playing: true, positionSec: 21 },
        listen: { aligner: aligner.start, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      // Pressed at 21, once the verse (sung 14–21) was over: a second for three lines.
      const verse = [shown('one a', 21, 26), shown('two b', 26, 31), shown('three c', 31, 36)]
      editor.command({ kind: 'edit', edit: { kind: 'addLines', at: 1, lines: verse } })
      await hearPlaying(21, 23)
      await settle()
      expect(aligner.asks).toEqual([])
      expect(editor.state().listen?.note).toBe(CRAMPED_NOTE)

      // Played again from before the verse, its first line's start tapped at 14 (Tap: Lines).
      music.seekTo(13)
      await hearPlaying(13, 14)
      editor.command({ kind: 'tap', phase: 'down', line: 1, word: 0, whole: true })
      await hearPlaying(14, 22.5)
      await settle()
      const tapped = colorsOf(editor).lines[1]
      expect(tapped?.start).toBeCloseTo(14, 2)
      // All three are heard, from half a second before the tap to half a second past 22.
      expect(aligner.asks.map((ask) => ask.lines)).toEqual([['one a', 'two b', 'three c']])
      expect(aligner.asks[0]?.bytes).toBe(44 + 2 * 9 * 16_000)

      await aligner.answer({
        ok: true,
        lines: [
          { start: 0.4, end: 3 },
          { start: 3, end: 5.5 },
          { start: 5.5, end: 8 }
        ]
      })
      // The tap is the user's; the other two are timed from the clip's start at 13.5.
      const [first, second, third] = colorsOf(editor).lines.slice(1, 4)
      expect(first).toEqual(tapped)
      expect(second?.start).toBeCloseTo(16.5, 6)
      expect(third?.start).toBeCloseTo(19, 6)
      expect(third?.end).toBeCloseTo(21.5, 6)
      expect(second?.timed).toBe(true)
      expect(third?.timed).toBe(true)
      expect(editor.state().listen?.note).toBeNull()
    })

    it('a cramped verse waits for its first line’s start, even once the next line moves', async () => {
      const aligner = fakeAligner()
      // Plain lyrics, the line after the verse tapped at 22 by the user.
      const plain: SongColors = {
        ...codingA(),
        lines: [
          { ...codedLine('one two three', 10, 14, [11, 12]), guessed: true },
          { ...codedLine('four five', 22, 26, [24]), timed: true }
        ]
      }
      const { editor } = setup({
        colors: { [KEY_A]: plain },
        ownTimes: { a: 'plain' },
        music: { playing: true, positionSec: 21 },
        listen: { aligner: aligner.start, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      const verse = [shown('one a', 21, 26), shown('two b', 26, 31), shown('three c', 31, 36)]
      editor.command({ kind: 'edit', edit: { kind: 'addLines', at: 1, lines: verse } })
      await hearPlaying(21, 23)
      await settle()
      expect(editor.state().listen?.note).toBe(CRAMPED_NOTE)

      // That line dragged on to 40: three lines now fit after the press, but the press was
      // after the verse, so only the user can say where it starts.
      editor.command({ kind: 'edit', edit: { kind: 'lineTime', line: 4, start: 40, end: 44 } })
      await hearPlaying(23, 41)
      await settle()
      expect(aligner.asks).toEqual([])
    })

    it('still times added lines with a second each before the next line', async () => {
      const aligner = fakeAligner()
      const { editor } = setup({
        colors: { [KEY_A]: timedAC(10, 22) },
        ownTimes: { a: [10, 22] },
        music: { playing: true, positionSec: 20 },
        listen: { aligner: aligner.start, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      addXY(editor, 1, [20, 21], [21, 22])

      await hearPlaying(20, 23)
      await settle()
      expect(aligner.asks.map((ask) => ask.lines)).toEqual([['X ray', 'Y axis']])
      expect(editor.state().listen?.note).toBeNull()
    })

    it('gives its own song’s timing fix while another song plays', () => {
      const { editor, music } = setup({
        colors: { [KEY_A]: timedAC(10, 30) },
        offsets: { [KEY_A]: 0.5, [KEY_B]: 2 },
        music: { playing: true },
        listen: { aligner: fakeAligner().start, tempDir: tempDir() }
      })
      editor.open()
      expect(editor.state().listen?.fixSec).toBe(0.5)
      music.play(TRACK_B)
      expect(editor.state().listen?.fixSec).toBe(0.5)
    })

    it('never re-times an added line the user tapped first', async () => {
      const aligner = fakeAligner()
      const { editor } = setup({
        colors: { [KEY_A]: timedAC(10, 30) },
        ownTimes: { a: [10, 30] },
        music: { playing: true, positionSec: 15 },
        listen: { aligner: aligner.start, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      addXY(editor, 1, [15, 22], [22, 29])
      await vi.advanceTimersByTimeAsync(300)
      // X's start, tapped at 15.3.
      editor.command({ kind: 'tap', phase: 'down', line: 1, word: 0 })

      await hearPlaying(15, 30)
      await settle()
      const tapped = colorsOf(editor).lines[1]
      expect(tapped?.timed).toBe(true)
      expect(tapped?.start).toBeCloseTo(15.3, 2)
      // It hears both, so Y is placed after X's singing...
      expect(aligner.asks.map((ask) => ask.lines)).toEqual([['X ray', 'Y axis']])

      await aligner.answer({
        ok: true,
        lines: [
          { start: 0.6, end: 4.1 },
          { start: 8, end: 14 }
        ]
      })
      // ...and only Y moves. The clip started half a second before X's tapped start.
      expect(colorsOf(editor).lines[1]).toEqual(tapped)
      expect(colorsOf(editor).lines[2]?.start).toBeCloseTo(22.8, 2)
      expect(colorsOf(editor).lines[2]?.timed).toBe(true)
    })

    it('ends an open stretch 8 s a line past the press', async () => {
      const aligner = fakeAligner()
      const { editor } = setup({
        colors: { [KEY_A]: codingA() },
        ownTimes: { a: 'plain' },
        music: { playing: true, positionSec: 50 },
        listen: { aligner: aligner.start, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      addXY(editor, 2, [50, 65], [65, 80])

      await hearPlaying(50, 65)
      await settle()
      expect(aligner.asks).toEqual([])
      await hearPlaying(65, 66)
      await settle()
      expect(aligner.asks).toHaveLength(1)
      // 50–66 (two lines), padded: 17 s.
      expect(aligner.asks[0]?.bytes).toBe(44 + 2 * 17 * 16_000)
    })

    it('ends the stretch where the next line is tapped, when that comes first', async () => {
      const aligner = fakeAligner()
      const plain: SongColors = {
        ...codingA(),
        lines: [
          { ...codedLine('one two three', 40, 48, [43, 45]), guessed: true },
          { ...codedLine('four five', 75, 80, [77]), guessed: true }
        ]
      }
      const { editor } = setup({
        colors: { [KEY_A]: plain },
        ownTimes: { a: 'plain' },
        music: { playing: true, positionSec: 50 },
        listen: { aligner: aligner.start, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      addXY(editor, 1, [50, 62.5], [62.5, 75])

      await hearPlaying(50, 60)
      // The next line comes in at 60, before 66 (8 s a line) is heard.
      editor.command({ kind: 'tap', phase: 'down', line: 3, word: 0 })
      await hearPlaying(60, 62)
      await settle()
      expect(colorsOf(editor).lines[3]?.start).toBeCloseTo(60, 2)
      expect(aligner.asks).toHaveLength(1)
      // 50–60, padded: 11 s.
      expect(aligner.asks[0]?.bytes).toBe(44 + 2 * 11 * 16_000)
    })

    it('hears up to the next line once auto-sync has timed the song (R14)', async () => {
      const aligner = fakeAligner()
      const ownTimes: Record<string, number[] | 'plain'> = { a: 'plain' }
      const { editor, music } = setup({
        colors: { [KEY_A]: codingA() },
        ownTimes,
        music: { playing: true, positionSec: 50 },
        listen: { aligner: aligner.start, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      addXY(editor, 1, [50, 55], [55, 60])

      // Auto-sync times the lyrics' own lines: the next one starts at 60.
      ownTimes.a = [40, 60]
      music.set({})
      await hearPlaying(50, 61)
      await settle()
      expect(aligner.asks).toHaveLength(1)
      expect(aligner.asks[0]?.bytes).toBe(44 + 2 * 11 * 16_000)
    })

    it('a retyped added line is still timed by itself', async () => {
      const aligner = fakeAligner()
      const { editor } = setup({
        colors: { [KEY_A]: timedAC(10, 30) },
        ownTimes: { a: [10, 30] },
        music: { playing: true, positionSec: 15 },
        listen: { aligner: aligner.start, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      addXY(editor, 1, [15, 22], [22, 29])
      editor.command({
        kind: 'edit',
        edit: { kind: 'retype', line: 1, shown: shown('X rays', 0, 2) }
      })
      await hearPlaying(15, 30)
      await settle()
      expect(aligner.asks.map((ask) => ask.lines)).toEqual([['X rays', 'Y axis']])
    })

    it('an automatic run that missed a line doesn’t run again, even once the stretch moves', async () => {
      const aligner = fakeAligner()
      const plain: SongColors = {
        ...codingA(),
        lines: [
          { ...codedLine('one two three', 40, 48, [43, 45]), guessed: true },
          { ...codedLine('four five', 75, 80, [77]), guessed: true }
        ]
      }
      const { editor } = setup({
        colors: { [KEY_A]: plain },
        ownTimes: { a: 'plain' },
        music: { playing: true, positionSec: 50 },
        listen: { aligner: aligner.start, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      addXY(editor, 1, [50, 62.5], [62.5, 75])
      await hearPlaying(50, 66)
      await settle()
      expect(aligner.asks).toHaveLength(1)
      await aligner.answer({ ok: true, lines: [{ start: 1, end: 5 }, null] })
      expect(colorsOf(editor).lines[2]?.guessed).toBe(true)
      expect(editor.state().listen?.note).toBe(missedNote(1, 2))

      // The next line's start, tapped later, would end the stretch elsewhere: Y waits for the
      // user to ask (Time by listening) or tap it.
      await hearPlaying(66, 69)
      editor.command({ kind: 'tap', phase: 'down', line: 3, word: 0 })
      await hearPlaying(69, 75)
      await settle()
      expect(colorsOf(editor).lines[3]?.timed).toBe(true)
      expect(aligner.asks).toHaveLength(1)
    })

    it('stops waiting for added lines once they’ve moved or gone', async () => {
      const steps: ((editor: ColorEditor) => void)[] = [
        // The add undone.
        (editor) => editor.command({ kind: 'undo' }),
        // Any undo: what it brings back may be from before the add.
        (editor) => {
          editor.command({
            kind: 'edit',
            edit: { kind: 'assign', line: 0, from: 0, to: 1, singers: ['saki'] }
          })
          editor.command({ kind: 'undo' })
        },
        // X removed.
        (editor) => editor.command({ kind: 'edit', edit: { kind: 'removeLine', line: 1 } }),
        // Y moved past the line after it, or X past Y.
        (editor) => editor.command({ kind: 'edit', edit: { kind: 'moveLine', line: 2, delta: 1 } }),
        (editor) => editor.command({ kind: 'edit', edit: { kind: 'moveLine', line: 1, delta: 1 } })
      ]
      for (const step of steps) {
        const aligner = fakeAligner()
        const { editor } = setup({
          colors: { [KEY_A]: timedAC(10, 30) },
          ownTimes: { a: [10, 30] },
          music: { playing: true, positionSec: 15 },
          listen: { aligner: aligner.start, tempDir: tempDir() }
        })
        editor.open()
        await vi.advanceTimersByTimeAsync(0)
        addXY(editor, 1, [15, 22], [22, 29])
        step(editor)
        await hearPlaying(15, 35)
        await settle()
        expect(aligner.asks).toEqual([])
        editor.dispose()
      }
    })

    it('an answer after the colors were removed is dropped', async () => {
      const aligner = fakeAligner()
      const { editor } = setup({
        colors: { [KEY_A]: timedAC(10, 30) },
        ownTimes: { a: [10, 30] },
        music: { playing: true, positionSec: 10 },
        listen: { aligner: aligner.start, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      await hearPlaying(10, 30)
      await settle()
      editor.command({ kind: 'listen', from: 0, to: 1 })
      expect(aligner.asks).toHaveLength(1)

      // Removed, and begun again from the lyrics while the run is out.
      editor.command({ kind: 'removeAll' })
      editor.command({ kind: 'begin', colors: timedAC(10, 30) })
      const before = colorsOf(editor)
      await aligner.answer({ ok: true, lines: [{ start: 1, end: 4 }] })
      expect(colorsOf(editor)).toBe(before)
      expect(editor.state().listen).toMatchObject({ timing: [], note: null })
    })

    it('times the selected lines on request, timed ones too', async () => {
      const aligner = fakeAligner()
      const { editor } = setup({
        colors: { [KEY_A]: threeTimed() },
        ownTimes: { a: [10, 30] },
        music: { playing: true, positionSec: 10 },
        listen: { aligner: aligner.start, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      await hearPlaying(10, 30)
      await settle()
      // Nothing was added, so nothing is timed by itself.
      expect(aligner.asks).toEqual([])

      editor.command({ kind: 'listen', from: 0, to: 2 })
      expect(aligner.asks.map((ask) => ask.lines)).toEqual([['one two three', 'in between']])
      // 10 to the next line's real start, 30, padded.
      expect(aligner.asks[0]?.bytes).toBe(44 + 2 * 21 * 16_000)
      expect(editor.state().listen?.timing).toEqual([0, 1])
      // One run at a time.
      editor.command({ kind: 'listen', from: 0, to: 2 })
      expect(aligner.asks).toHaveLength(1)

      await aligner.answer({
        ok: true,
        lines: [
          { start: 1, end: 4 },
          { start: 11, end: 14.5 }
        ]
      })
      const [first, second, third] = colorsOf(editor).lines
      expect(first?.start).toBeCloseTo(10.5, 6)
      expect(first?.end).toBeCloseTo(13.5, 6)
      expect(second?.start).toBeCloseTo(20.5, 6)
      expect(second?.end).toBeCloseTo(24, 6)
      expect(third).toEqual(threeTimed().lines[2])

      // Again, on the same aligner.
      editor.command({ kind: 'listen', from: 0, to: 1 })
      expect(aligner.asks).toHaveLength(2)
      expect(aligner.start).toHaveBeenCalledTimes(1)
    })

    it('asks to play the part first when it wasn’t heard', async () => {
      const aligner = fakeAligner()
      const { editor } = setup({
        colors: { [KEY_A]: threeTimed() },
        ownTimes: { a: [10, 30] },
        music: { playing: true, positionSec: 10 },
        listen: { aligner: aligner.start, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      await hearPlaying(10, 20)
      await settle()

      editor.command({ kind: 'listen', from: 0, to: 2 })
      expect(aligner.start).not.toHaveBeenCalled()
      expect(aligner.asks).toEqual([])
      expect(editor.state().listen).toMatchObject({ timing: [], note: NOT_HEARD_NOTE })
    })

    it('says which lines a note is about, and drops it once the page has moved off them', async () => {
      const aligner = fakeAligner()
      const { editor } = setup({
        colors: { [KEY_A]: threeTimed() },
        ownTimes: { a: [10, 30] },
        music: { playing: true, positionSec: 10 },
        listen: { aligner: aligner.start, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      editor.command({ kind: 'listen', from: 0, to: 2 })
      expect(editor.state().listen).toMatchObject({ note: NOT_HEARD_NOTE, noteLines: [0, 1] })

      await hearPlaying(10, 30)
      await settle()
      editor.command({ kind: 'listen', from: 0, to: 2 })
      await aligner.answer({ ok: true, lines: [{ start: 1, end: 4 }, null] })
      expect(editor.state().listen).toMatchObject({ note: missedNote(1, 2), noteLines: [0, 1] })

      // Another note's words: not this one, which came after.
      editor.command({ kind: 'clearNote', note: NOT_HEARD_NOTE })
      expect(editor.state().listen?.note).toBe(missedNote(1, 2))
      editor.command({ kind: 'clearNote', note: missedNote(1, 2) })
      expect(editor.state().listen).toMatchObject({ note: null, noteLines: [] })
    })

    it('drops a note once lines are added, removed or moved, but not for a tap', async () => {
      const aligner = fakeAligner()
      const { editor } = setup({
        colors: { [KEY_A]: threeTimed() },
        ownTimes: { a: [10, 30] },
        music: { playing: true, positionSec: 10 },
        listen: { aligner: aligner.start, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      await hearPlaying(10, 30)
      await settle()
      editor.command({ kind: 'listen', from: 0, to: 2 })
      await aligner.answer({ ok: true, lines: [{ start: 1, end: 4 }, null] })

      // A tap keeps every line in its place.
      editor.command({ kind: 'tap', phase: 'down', line: 2, word: 0 })
      await vi.advanceTimersByTimeAsync(3500)
      expect(editor.state().listen?.note).toBe(missedNote(1, 2))

      // Lines added before them: the places it names are other lines now.
      editor.command({
        kind: 'edit',
        edit: { kind: 'addLines', at: 0, lines: [shown('intro', 1, 3)] }
      })
      expect(editor.state().listen).toMatchObject({ note: null, noteLines: [] })
    })

    it('says nothing about a run whose lines moved while it was out', async () => {
      const aligner = fakeAligner()
      const { editor } = setup({
        colors: { [KEY_A]: threeTimed() },
        ownTimes: { a: [10, 30] },
        music: { playing: true, positionSec: 10 },
        listen: { aligner: aligner.start, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      await hearPlaying(10, 30)
      await settle()
      editor.command({ kind: 'listen', from: 0, to: 2 })
      editor.command({
        kind: 'edit',
        edit: { kind: 'addLines', at: 0, lines: [shown('intro', 1, 3)] }
      })
      await aligner.answer({ ok: true, lines: [{ start: 1, end: 4 }, null] })
      // Places 0 and 1 are other lines now.
      expect(editor.state().listen).toMatchObject({ note: null, noteLines: [] })
    })

    it('says the cramped note once, and drops it when the verse stops waiting', async () => {
      const aligner = fakeAligner()
      const { editor } = setup({
        colors: { [KEY_A]: timedAC(10, 22) },
        ownTimes: { a: [10, 22] },
        music: { playing: true, positionSec: 21 },
        listen: { aligner: aligner.start, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      const verse = [shown('one a', 21, 26), shown('two b', 26, 31), shown('three c', 31, 36)]
      editor.command({ kind: 'edit', edit: { kind: 'addLines', at: 1, lines: verse } })
      await hearPlaying(21, 22)
      await settle()
      expect(editor.state().listen).toMatchObject({ note: CRAMPED_NOTE, noteLines: [1, 2, 3] })

      // Dropped by the page: the verse still waits, quietly.
      editor.command({ kind: 'clearNote', note: CRAMPED_NOTE })
      await hearPlaying(22, 24)
      await settle()
      expect(editor.state().listen?.note).toBeNull()

      // Said again only for another verse; then an undo ends that one's wait, and its note.
      // Pressed at 21.5, half a second before the next line.
      editor.command({
        kind: 'edit',
        edit: { kind: 'addLines', at: 4, lines: [shown('four d', 21.5, 27)] }
      })
      await settle()
      expect(editor.state().listen).toMatchObject({ note: CRAMPED_NOTE, noteLines: [4] })
      editor.command({
        kind: 'edit',
        edit: { kind: 'assign', line: 0, from: 0, to: 1, singers: ['saki'] }
      })
      editor.command({ kind: 'undo' })
      expect(editor.state().listen).toMatchObject({ note: null, noteLines: [] })
    })

    it('a run never touches lines outside it', async () => {
      const aligner = fakeAligner()
      const four: SongColors = {
        ...codingA(),
        lines: [
          { ...codedLine('one two three', 10, 14, [11, 12]), timed: true },
          { ...codedLine('in between', 20, 24, [22]), guessed: true },
          { ...codedLine('and more', 26, 29, [27]), guessed: true },
          { ...codedLine('four five', 30, 34, [32]), timed: true }
        ]
      }
      const { editor } = setup({
        colors: { [KEY_A]: four },
        ownTimes: { a: [10, 30] },
        music: { playing: true, positionSec: 10 },
        listen: { aligner: aligner.start, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      await hearPlaying(10, 34)
      await settle()

      editor.command({ kind: 'listen', from: 1, to: 3 })
      expect(aligner.asks.map((ask) => ask.lines)).toEqual([['in between', 'and more']])
      // From the first line's start (a guess) to the next line's real one: 20–30, padded.
      expect(aligner.asks[0]?.bytes).toBe(44 + 2 * 11 * 16_000)
      const before = colorsOf(editor)
      await aligner.answer({
        ok: true,
        lines: [
          { start: 0, end: 4 },
          { start: 5, end: 11 }
        ]
      })
      const after = colorsOf(editor)
      expect(after.lines[0]).toBe(before.lines[0])
      expect(after.lines[3]).toBe(before.lines[3])
      expect(after.lines[1]?.start).toBeCloseTo(19.5, 6)
      expect(after.lines[2]?.end).toBeCloseTo(30.5, 6)
    })

    it('an answer for lines that changed meanwhile leaves them be', async () => {
      const aligner = fakeAligner()
      const { editor } = setup({
        colors: { [KEY_A]: timedAC(10, 30) },
        ownTimes: { a: [10, 30] },
        music: { playing: true, positionSec: 15 },
        listen: { aligner: aligner.start, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      addXY(editor, 1, [15, 22], [22, 29])
      await hearPlaying(15, 30)
      await settle()
      expect(aligner.asks).toHaveLength(1)

      // X is retyped while the run is out.
      editor.command({
        kind: 'edit',
        edit: { kind: 'retype', line: 1, shown: shown('X rays', 0, 2) }
      })
      const retyped = colorsOf(editor).lines[1]
      await aligner.answer({
        ok: true,
        lines: [
          { start: 0.6, end: 4.1 },
          { start: 8, end: 14 }
        ]
      })
      expect(colorsOf(editor).lines[1]).toEqual(retyped)
      expect(colorsOf(editor).lines[2]?.start).toBeCloseTo(22.5, 6)

      // X is removed while the next run is out: every line has moved up one.
      editor.command({ kind: 'listen', from: 1, to: 3 })
      expect(aligner.asks.map((ask) => ask.lines)[1]).toEqual(['X rays', 'Y axis'])
      editor.command({ kind: 'edit', edit: { kind: 'removeLine', line: 1 } })
      const removed = colorsOf(editor)
      await aligner.answer({
        ok: true,
        lines: [
          { start: 1, end: 3 },
          { start: 4, end: 6 }
        ]
      })
      expect(colorsOf(editor)).toBe(removed)
    })

    it('a late answer leaves a line the user tapped while the run was out', async () => {
      const aligner = fakeAligner()
      const { editor, music } = setup({
        colors: { [KEY_A]: threeTimed() },
        ownTimes: { a: [10, 30] },
        music: { playing: true, positionSec: 10 },
        listen: { aligner: aligner.start, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      await hearPlaying(10, 30)
      await settle()
      editor.command({ kind: 'listen', from: 0, to: 2 })
      expect(aligner.asks).toHaveLength(1)

      // J on the second line's second word while the run is out.
      music.seekTo(22.4)
      await vi.advanceTimersByTimeAsync(500)
      editor.command({ kind: 'tap', phase: 'down', line: 1, word: 1 })
      await vi.advanceTimersByTimeAsync(3500)
      const tapped = colorsOf(editor).lines[1]
      expect(tapped?.words[1]?.start).toBeCloseTo(22.9, 2)

      await aligner.answer({
        ok: true,
        lines: [
          { start: 1, end: 4 },
          { start: 11, end: 14.5 }
        ]
      })
      expect(colorsOf(editor).lines[0]?.start).toBeCloseTo(10.5, 6)
      expect(colorsOf(editor).lines[1]).toEqual(tapped)
    })

    it('a late automatic answer leaves an added line whose end was dragged', async () => {
      const aligner = fakeAligner()
      const { editor } = setup({
        colors: { [KEY_A]: timedAC(10, 30) },
        ownTimes: { a: [10, 30] },
        music: { playing: true, positionSec: 15 },
        listen: { aligner: aligner.start, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      addXY(editor, 1, [15, 22], [22, 29])
      await hearPlaying(15, 30)
      await settle()
      expect(aligner.asks).toHaveLength(1)

      // X's end dragged on the waveform: still a guess, but the user's.
      editor.command({ kind: 'edit', edit: { kind: 'lineTime', line: 1, end: 20 } })
      const dragged = colorsOf(editor).lines[1]
      expect(dragged?.end).toBe(20)
      expect(dragged?.timed).toBeUndefined()

      await aligner.answer({
        ok: true,
        lines: [
          { start: 0.6, end: 4.1 },
          { start: 8, end: 14 }
        ]
      })
      expect(colorsOf(editor).lines[1]).toEqual(dragged)
      expect(colorsOf(editor).lines[2]?.start).toBeCloseTo(22.5, 6)
      expect(colorsOf(editor).lines[2]?.timed).toBe(true)
    })

    it('keeps no audio without the add-on; the waveform fills in as before', async () => {
      const { editor } = setup({
        colors: { [KEY_A]: timedAC(10, 30) },
        music: { playing: true, positionSec: 10 },
        listen: { aligner: null, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      await hearPlaying(10, 15)
      await settle()
      expect(editor.state().listen).toMatchObject({ installed: false, heard: [] })
      expect(peaksOf(editor)[Math.round(12 / 0.02)]).toBeGreaterThan(0)
    })

    it('an answer after the window moved to another song is dropped', async () => {
      const aligner = fakeAligner()
      const { editor, music, store } = setup({
        colors: { [KEY_A]: threeTimed(), [KEY_B]: codingB() },
        ownTimes: { a: [10, 30] },
        music: { playing: true, positionSec: 10 },
        listen: { aligner: aligner.start, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      await hearPlaying(10, 30)
      await settle()
      editor.command({ kind: 'listen', from: 0, to: 2 })
      expect(aligner.asks).toHaveLength(1)

      music.play(TRACK_B)
      editor.command({ kind: 'switchToPlaying' })
      expect(editor.state().song?.key).toBe(KEY_B)
      const before = colorsOf(editor)
      await aligner.answer({
        ok: true,
        lines: [
          { start: 1, end: 4 },
          { start: 11, end: 14.5 }
        ]
      })
      expect(colorsOf(editor)).toBe(before)
      expect(editor.state().listen).toMatchObject({ timing: [], note: null })
      vi.advanceTimersByTime(SAVE_DELAY_MS)
      expect(store.saved.get(KEY_A)).toEqual(threeTimed())
    })

    it('a failed run says so and changes nothing', async () => {
      const aligner = fakeAligner()
      const dir = tempDir()
      const { editor } = setup({
        colors: { [KEY_A]: threeTimed() },
        ownTimes: { a: [10, 30] },
        music: { playing: true, positionSec: 10 },
        listen: { aligner: aligner.start, tempDir: dir }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      await hearPlaying(10, 30)
      await settle()
      editor.command({ kind: 'listen', from: 0, to: 2 })
      const before = colorsOf(editor)

      // The runner warns in the log too.
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      await aligner.answer({ ok: false, error: 'The aligner stopped.' })
      expect(colorsOf(editor)).toBe(before)
      expect(editor.state().canUndo).toBe(false)
      expect(editor.state().listen).toMatchObject({ timing: [], note: TIMING_FAILED_NOTE })
      expect(readdirSync(dir).filter((name) => name.endsWith('.wav'))).toEqual([])

      // A line it couldn't place keeps its times, and it says so.
      editor.command({ kind: 'listen', from: 0, to: 2 })
      expect(editor.state().listen?.note).toBeNull()
      await aligner.answer({ ok: true, lines: [{ start: 1, end: 4 }, null] })
      expect(colorsOf(editor).lines[0]?.start).toBeCloseTo(10.5, 6)
      expect(colorsOf(editor).lines[1]).toEqual(before.lines[1])
      expect(editor.state().listen?.note).toBe(
        "Couldn't place 1 of these 2 lines; it keeps its times."
      )
      expect(missedNote(2, 3)).toBe("Couldn't place 2 of these 3 lines; they keep their times.")

      // Nothing placed at all is a failure too.
      editor.command({ kind: 'listen', from: 0, to: 2 })
      await aligner.answer({ ok: true, lines: [null, null] })
      expect(editor.state().listen?.note).toBe(TIMING_FAILED_NOTE)
    })

    it('throws the heard audio away when the window closes', async () => {
      const { editor, music } = setup({
        colors: { [KEY_A]: timedAC(10, 30) },
        music: { playing: true, positionSec: 10 },
        listen: { aligner: fakeAligner().start, tempDir: tempDir() }
      })
      editor.open()
      await vi.advanceTimersByTimeAsync(0)
      await hearPlaying(10, 15)
      await settle()
      expect(editor.state().listen?.heard).toEqual([[10, 15]])

      editor.close()
      expect(editor.state().listen).toBeNull()
      editor.open()
      expect(editor.state().listen?.heard).toEqual([])

      // ...and when the editor moves to another song.
      await hearPlaying(17, 20)
      await settle()
      expect(editor.state().listen?.heard).toEqual([[17, 20]])
      music.play(TRACK_B)
      editor.command({ kind: 'switchToPlaying' })
      expect(editor.state().listen?.heard).toEqual([])
      music.play(TRACK_A, 40)
      editor.command({ kind: 'switchToPlaying' })
      expect(editor.state().listen?.heard).toEqual([])
    })

    it('runs with the window: leftovers cleared as it opens, its aligner stopped as it closes', async () => {
      const aligner = fakeAligner()
      const dir = tempDir()
      writeFileSync(join(dir, 'left behind.wav'), 'RIFF')
      writeFileSync(join(dir, 'not ours.txt'), 'hello')
      const { editor, store } = setup({
        colors: { [KEY_A]: threeTimed() },
        ownTimes: { a: [10, 30] },
        music: { playing: true, positionSec: 10 },
        listen: { aligner: aligner.start, tempDir: dir }
      })
      expect(existsSync(join(dir, 'left behind.wav'))).toBe(true)
      editor.open()
      expect(existsSync(join(dir, 'left behind.wav'))).toBe(false)
      expect(existsSync(join(dir, 'not ours.txt'))).toBe(true)

      await vi.advanceTimersByTimeAsync(0)
      await hearPlaying(10, 30)
      await settle()
      editor.command({ kind: 'listen', from: 0, to: 2 })
      expect(aligner.asks).toHaveLength(1)

      editor.close()
      expect(aligner.client.dispose).toHaveBeenCalled()
      expect(readdirSync(dir).filter((name) => name.endsWith('.wav'))).toEqual([])
      // Its answer is nobody's.
      await aligner.answer({
        ok: true,
        lines: [
          { start: 1, end: 4 },
          { start: 11, end: 14.5 }
        ]
      })
      expect(store.saved.get(KEY_A)).toEqual(threeTimed())
    })

    it('listen is null without recording access; installed is false without the add-on', () => {
      const first = setup({
        colors: { [KEY_A]: codingA() },
        listen: { aligner: fakeAligner().start, tempDir: tempDir() }
      })
      expect(first.editor.state().listen).toBeNull()
      first.editor.open()
      expect(first.editor.state().listen).toEqual({
        installed: true,
        heard: [],
        timing: [],
        note: null,
        noteLines: [],
        fixSec: 0
      })
      first.tap.access.mockReturnValue('denied')
      expect(first.editor.state().listen).toBeNull()
      first.editor.dispose()

      const second = setup({
        colors: { [KEY_A]: codingA() },
        listen: { aligner: null, tempDir: tempDir() }
      })
      second.editor.open()
      expect(second.editor.state().listen?.installed).toBe(false)
      second.editor.dispose()

      // No tap at all (Windows): not offered.
      const music = fakeMusic()
      const offsets = fakeOffsets()
      const editor = createColorEditor({
        store: fakeStore({ [KEY_A]: codingA() }),
        music,
        lyrics: fakeLyrics(music, offsets),
        offsets,
        openTap: () => null,
        pictures: null,
        listen: { aligner: fakeAligner().start, tempDir: tempDir() }
      })
      editor.open()
      expect(editor.state().listen).toBeNull()
      editor.dispose()
    })
  })

  it('flushes a waiting save on close', () => {
    const { editor, store } = setup({ colors: { [KEY_A]: codingA() } })
    editor.open()
    editor.command({ kind: 'undo' })
    editor.command({
      kind: 'edit',
      edit: { kind: 'assign', line: 0, from: 0, to: 1, singers: ['ichika'] }
    })
    editor.close()
    expect(store.write).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(store.write).toHaveBeenCalledTimes(1)
  })
})

describe('parseColorEditorCommand', () => {
  it('keeps well-formed commands', () => {
    expect(parseColorEditorCommand({ kind: 'undo' })).toEqual({ kind: 'undo' })
    expect(parseColorEditorCommand({ kind: 'replayLine', line: 2 })).toEqual({
      kind: 'replayLine',
      line: 2
    })
    expect(parseColorEditorCommand({ kind: 'tap', phase: 'up', line: 2, word: 0 })).toEqual({
      kind: 'tap',
      phase: 'up',
      line: 2,
      word: 0
    })
    // Tap: Lines moves the whole line; only a press carries it.
    expect(
      parseColorEditorCommand({ kind: 'tap', phase: 'down', line: 2, word: 0, whole: true })
    ).toEqual({ kind: 'tap', phase: 'down', line: 2, word: 0, whole: true })
    expect(
      parseColorEditorCommand({ kind: 'tap', phase: 'up', line: 2, word: 0, whole: true })
    ).toEqual({ kind: 'tap', phase: 'up', line: 2, word: 0 })
    for (const whole of ['yes', 1, false, null]) {
      expect(
        parseColorEditorCommand({ kind: 'tap', phase: 'down', line: 2, word: 0, whole })
      ).toEqual({ kind: 'tap', phase: 'down', line: 2, word: 0 })
    }
    expect(
      parseColorEditorCommand({ kind: 'edit', edit: { kind: 'setCast', cast: ['saki'] } })
    ).toEqual({ kind: 'edit', edit: { kind: 'setCast', cast: ['saki'] } })
    expect(parseColorEditorCommand({ kind: 'listen', from: 1, to: 3 })).toEqual({
      kind: 'listen',
      from: 1,
      to: 3
    })
    expect(parseColorEditorCommand({ kind: 'clearNote', note: NOT_HEARD_NOTE })).toEqual({
      kind: 'clearNote',
      note: NOT_HEARD_NOTE
    })
  })

  it('drops anything off-shape', () => {
    for (const raw of [
      null,
      'undo',
      { kind: 'explode' },
      { kind: 'playLine', line: -1 },
      { kind: 'playLine', line: 1.5 },
      { kind: 'tap', phase: 'sideways', line: 0, word: 0 },
      { kind: 'edit', edit: { kind: 'format' } },
      { kind: 'edit', edit: null },
      { kind: 'choosePicture', singer: 3 },
      { kind: 'pictureFromPath', singer: 'saki', path: '' },
      { kind: 'pictureFromPath', singer: 'saki', path: 'relative.png' },
      { kind: 'listen', from: 2, to: 2 },
      { kind: 'listen', from: -1, to: 2 },
      { kind: 'listen', from: 0.5, to: 2 },
      { kind: 'listen', from: 0 },
      { kind: 'clearNote' },
      { kind: 'clearNote', note: 3 },
      { kind: 'clearNote', note: 'x'.repeat(1001) }
    ]) {
      expect(parseColorEditorCommand(raw)).toBeNull()
    }
  })
})
