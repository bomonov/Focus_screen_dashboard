import { describe, expect, it, vi } from 'vitest'
import type { VersionsResult } from './lrclib'
import type { LyricsPick } from './picks'
import { createLyricsPicker, parseLyricsPickerCommand, type LyricsPickerDeps } from './picker'
import { lyricsQuery, type LyricsQuery } from './query'
import type { Lyrics, LyricsState } from './types'
import type { LyricsVersion } from './versions'

function irony(): LyricsQuery {
  const made = lyricsQuery({
    title: 'irony',
    artist: 'Nightcord at 25:00',
    album: '',
    durationSec: 251
  })
  if (!made) throw new Error('no query')
  return made
}
const query = irony()

const scopLyrics: Lyrics = {
  kind: 'synced',
  lines: [{ timeSec: 5.44, text: '少し歩き疲れたんだ 少し歩き疲れたんだ' }],
  source: 'lrclib'
}
const version = (
  id: number,
  artist: string,
  durationSec: number,
  credit: LyricsVersion['credit'],
  lyrics: Lyrics = { kind: 'synced', lines: [{ timeSec: id, text: artist }], source: 'lrclib' }
): LyricsVersion => ({ id, title: 'アイロニ', artist, album: 'album', durationSec, credit, lyrics })

const NIGHTCORD = version(10604292, '25時、ナイトコードで。', 251, 'singers')
const SCOP = version(4155154, 'すこっぷ feat. Rid', 250, 'others', scopLyrics)
const MAJIKO = version(10022160, 'majiko', 246, null)

interface Harness {
  deps: LyricsPickerDeps
  picked: (LyricsPick | null)[]
  versions: ReturnType<typeof vi.fn>
  searches: string[]
  setSong(key: string | null): void
  show(lyrics: Lyrics | null): void
}

function harness(
  answer: VersionsResult = { kind: 'found', versions: [NIGHTCORD, SCOP, MAJIKO] }
): Harness {
  let song: { key: string; trackId: string } | null = { key: 'irony|251', trackId: 't1' }
  let shown: LyricsState = {
    trackId: 't1',
    status: 'found',
    lyrics: scopLyrics,
    offsetSec: 0,
    romaji: null
  }
  const listeners = new Set<(state: LyricsState) => void>()
  const picked: (LyricsPick | null)[] = []
  const searches: string[] = []
  const versions = vi.fn(async () => answer)
  const deps: LyricsPickerDeps = {
    lyrics: {
      get: () => shown,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      currentSong: () => (song ? { ...song, query, cacheable: true } : null),
      pick: (pick) => void picked.push(pick)
    },
    songs: {
      versions,
      async search(_query, text) {
        searches.push(text)
        return { kind: 'found', versions: [MAJIKO] }
      }
    },
    picks: { get: () => null },
    visible: () => true,
    listen: () => 'ready'
  }
  return {
    deps,
    picked,
    versions,
    searches,
    setSong(key) {
      song = key ? { key, trackId: key } : null
      shown = { ...shown, trackId: key }
      for (const listener of listeners) listener(shown)
    },
    show(lyrics) {
      shown = { ...shown, lyrics }
      for (const listener of listeners) listener(shown)
    }
  }
}

describe('the lyrics version picker', () => {
  it("lists the song's versions, best first, with whose they are and which shows now", async () => {
    const h = harness()
    const picker = createLyricsPicker(h.deps)
    await picker.command({ kind: 'open' })
    const state = picker.get()
    expect(state).toMatchObject({
      open: true,
      busy: null,
      song: { title: 'irony', artist: 'Nightcord at 25:00', durationSec: 251 },
      picked: 'automatic',
      listen: 'ready',
      message: null
    })
    expect(state.rows.map((row) => [row.id, row.tags])).toEqual([
      [10604292, ['same singers']],
      [4155154, ['the original', 'showing now']],
      [10022160, []]
    ])
    expect(state.rows[0]).toMatchObject({
      artist: '25時、ナイトコードで。',
      durationSec: 251,
      kind: 'synced'
    })
  })

  it('lists each set of lyrics once, and leaves out songs of another length', async () => {
    // LRCLIB repeats a song under every compilation, and lists any song called the same.
    const again = { ...NIGHTCORD, id: 11170932, album: 'compilation' }
    const otherSong = version(35314080, 'Cin', 166, null)
    // Another "irony" 21 s off: someone else's song, not a cover sung over the same track.
    const nearOther = version(35314081, 'someone else', 230, null)
    const wholeAlbum = version(37000001, '25時、ナイトコードで。', 2806, 'singers')
    const unknownLength = version(37000002, 'someone', 0, null)
    const h = harness({
      kind: 'found',
      versions: [NIGHTCORD, again, SCOP, MAJIKO, otherSong, nearOther, wholeAlbum, unknownLength]
    })
    const picker = createLyricsPicker(h.deps)
    await picker.command({ kind: 'open' })
    expect(picker.get().rows.map((row) => row.id)).toEqual([10604292, 4155154, 10022160, 37000002])
  })

  it('tags the version showing now when the user added lines to it', async () => {
    const h = harness()
    const withAdded: Lyrics = {
      ...scopLyrics,
      lines: [...scopLyrics.lines, { timeSec: 30, text: 'a verse the user added' }]
    }
    const base = h.deps.lyrics.get()
    const picker = createLyricsPicker({
      ...h.deps,
      lyrics: {
        ...h.deps.lyrics,
        // The shown rows have the added line; the lyrics' own ride along as `colors.own`.
        get: () => ({
          ...base,
          lyrics: withAdded,
          colors: { lines: [], voices: [], romajiSplits: [], extra: [], own: scopLyrics }
        })
      }
    })
    await picker.command({ kind: 'open' })
    expect(picker.get().rows.find((row) => row.id === SCOP.id)?.tags).toContain('showing now')
  })

  it('keeps the version showing now whatever its length', async () => {
    const shownLong = version(37000003, 'すこっぷ feat. Rid', 400, 'others', scopLyrics)
    const picker = createLyricsPicker(
      harness({ kind: 'found', versions: [NIGHTCORD, shownLong] }).deps
    )
    await picker.command({ kind: 'open' })
    expect(picker.get().rows.map((row) => row.id)).toEqual([10604292, 37000003])
  })

  it('picking a row switches to it and closes', async () => {
    const h = harness()
    const picker = createLyricsPicker(h.deps)
    await picker.command({ kind: 'open' })
    await picker.command({ kind: 'pick', id: 10604292 })
    expect(h.picked).toEqual([{ kind: 'version', id: 10604292 }])
    expect(picker.get().open).toBe(false)
  })

  it('goes back to automatic, says there are none, or times them by listening', async () => {
    for (const [command, pick] of [
      [{ kind: 'automatic' }, null],
      [{ kind: 'none' }, { kind: 'none' }],
      [{ kind: 'listen' }, { kind: 'listen' }]
    ] as const) {
      const h = harness()
      const picker = createLyricsPicker(h.deps)
      await picker.command({ kind: 'open' })
      await picker.command(command)
      expect(h.picked).toEqual([pick])
      expect(picker.get().open).toBe(false)
    }
  })

  it('the bottom row works while the list is still looking', async () => {
    const h = harness()
    h.versions.mockImplementationOnce(() => new Promise<VersionsResult>(() => undefined))
    const picker = createLyricsPicker(h.deps)
    void picker.command({ kind: 'open' })
    await Promise.resolve()
    expect(picker.get().busy).toBe('loading')
    await picker.command({ kind: 'none' })
    expect(h.picked).toEqual([{ kind: 'none' }])
    expect(picker.get().open).toBe(false)
  })

  it('lists what a search finds whatever its length, and says when it finds nothing', async () => {
    const h = harness()
    const tvSize = version(36000001, '25時、ナイトコードで。', 90, 'singers')
    let found: LyricsVersion[] = [tvSize]
    h.deps.songs.search = async () => ({ kind: 'found', versions: found })
    const picker = createLyricsPicker(h.deps)
    await picker.command({ kind: 'open' })
    await picker.command({ kind: 'search', text: 'アイロニ tv size' })
    expect(picker.get().rows.map((row) => row.id)).toEqual([36000001])
    found = []
    await picker.command({ kind: 'search', text: 'nothing like it' })
    expect(picker.get()).toMatchObject({ rows: [], message: 'Nothing on LRCLIB for that' })
  })

  it("says so when LRCLIB can't be reached, keeping the bottom row", async () => {
    const picker = createLyricsPicker(harness({ kind: 'unavailable' }).deps)
    await picker.command({ kind: 'open' })
    expect(picker.get()).toMatchObject({
      open: true,
      rows: [],
      message: 'Can’t reach LRCLIB right now'
    })
  })

  it('searches with other words, listing what it finds the same way', async () => {
    const h = harness()
    const picker = createLyricsPicker(h.deps)
    await picker.command({ kind: 'open' })
    await picker.command({ kind: 'search', text: 'アイロニ majiko' })
    expect(h.searches).toEqual(['アイロニ majiko'])
    expect(picker.get().rows.map((row) => row.id)).toEqual([10022160])
  })

  it('closes when the song changes, and a pick then never lands on the next song', async () => {
    const h = harness()
    const picker = createLyricsPicker(h.deps)
    await picker.command({ kind: 'open' })
    h.setSong('other|200')
    expect(picker.get().open).toBe(false)
    await picker.command({ kind: 'pick', id: 10604292 })
    expect(h.picked).toEqual([])
  })

  it('drops an answer that comes back for a song no longer on', async () => {
    const h = harness()
    let release: (result: VersionsResult) => void = () => undefined
    h.versions.mockImplementationOnce(
      () => new Promise<VersionsResult>((resolve) => (release = resolve))
    )
    const picker = createLyricsPicker(h.deps)
    const opening = picker.command({ kind: 'open' })
    h.setSong('other|200')
    release({ kind: 'found', versions: [NIGHTCORD] })
    await opening
    expect(picker.get()).toMatchObject({ open: false, rows: [] })
  })

  it("can't open with no song, an ad, hidden lyrics or the demo's songs", async () => {
    const h = harness()
    h.setSong(null)
    const picker = createLyricsPicker(h.deps)
    expect(picker.canOpen()).toBe(false)
    await picker.command({ kind: 'open' })
    expect(picker.get().open).toBe(false)

    const hidden = harness()
    expect(createLyricsPicker({ ...hidden.deps, visible: () => false }).canOpen()).toBe(false)

    const demo = harness()
    const demoDeps: LyricsPickerDeps = {
      ...demo.deps,
      lyrics: {
        ...demo.deps.lyrics,
        currentSong: () => ({ key: 'demo|x|200', trackId: 'd', query, cacheable: false })
      }
    }
    expect(createLyricsPicker(demoDeps).canOpen()).toBe(false)
  })

  it('says whether listening can time the words here', async () => {
    for (const listen of ['off', 'unsupported'] as const) {
      const picker = createLyricsPicker({ ...harness().deps, listen: () => listen })
      await picker.command({ kind: 'open' })
      expect(picker.get().listen).toBe(listen)
      await picker.command({ kind: 'listen' })
      expect(picker.get().open).toBe(true)
    }
  })

  it("shows how this song's lyrics are chosen now", async () => {
    const h = harness()
    const picker = createLyricsPicker({
      ...h.deps,
      picks: { get: () => ({ kind: 'version', id: 1 }) }
    })
    await picker.command({ kind: 'open' })
    expect(picker.get().picked).toBe('version')
  })
})

describe('parseLyricsPickerCommand', () => {
  it('reads what the page may send', () => {
    expect(parseLyricsPickerCommand({ kind: 'pick', id: 10604292 })).toEqual({
      kind: 'pick',
      id: 10604292
    })
    expect(parseLyricsPickerCommand({ kind: 'search', text: '  アイロニ  ' })).toEqual({
      kind: 'search',
      text: 'アイロニ'
    })
    expect(parseLyricsPickerCommand({ kind: 'search', text: 'x'.repeat(300) })).toEqual({
      kind: 'search',
      text: 'x'.repeat(200)
    })
    for (const kind of ['open', 'close', 'listen', 'none', 'automatic'] as const) {
      expect(parseLyricsPickerCommand({ kind })).toEqual({ kind })
    }
  })

  it('refuses anything else', () => {
    for (const bad of [
      { kind: 'pick', id: 0 },
      { kind: 'pick', id: -1 },
      { kind: 'pick', id: 1.5 },
      { kind: 'pick', id: '7' },
      { kind: 'search', text: '   ' },
      { kind: 'search', text: 7 },
      { kind: 'delete' },
      'open',
      null
    ]) {
      expect(parseLyricsPickerCommand(bad)).toBeNull()
    }
  })
})
