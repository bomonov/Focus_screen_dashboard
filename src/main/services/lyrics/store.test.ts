import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOT_FOUND_TTL_SEC, openLyricsCache, VOCADB_TTL_SEC } from './cache'
import { openOffsetStore } from './offsets'
import { clampOffset, parseLyrics, parseLyricsCommand } from './parse'
import { syncedLineIndex, type Lyrics } from './types'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'focus-screen-lyrics-'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const SYNCED: Lyrics = {
  kind: 'synced',
  lines: [
    { timeSec: 1, text: 'One' },
    { timeSec: 2, text: '' }
  ],
  source: 'lrclib'
}

describe('lyrics cache', () => {
  it('reads back what it wrote, in files named by hash', () => {
    const cache = openLyricsCache(join(dir, 'lyrics'))
    cache.write('artist|song|200', { kind: 'found', lyrics: SYNCED })
    expect(cache.read('artist|song|200')).toEqual({ kind: 'found', lyrics: SYNCED })
    expect(cache.read('artist|other|200')).toBeNull()
    const [file] = readdirSync(join(dir, 'lyrics'))
    expect(file).toMatch(/^[0-9a-f]{40}\.json$/)
  })

  it('forgets "not found" after a while so new LRCLIB entries show up', () => {
    let clock = 1_000_000
    const cache = openLyricsCache(dir, () => clock)
    cache.write('key', { kind: 'notFound' })
    clock += NOT_FOUND_TTL_SEC - 10
    expect(cache.read('key')).toEqual({ kind: 'notFound' })
    clock += 20
    expect(cache.read('key')).toBeNull()
  })

  it('asks LRCLIB again after a while for words that came from VocaDB, but keeps its own', () => {
    let clock = 1_000_000
    const cache = openLyricsCache(dir, () => clock)
    const fromVocadb: Lyrics = { kind: 'plain', lines: ['a'], source: 'vocadb' }
    cache.write('vocadb', { kind: 'found', lyrics: fromVocadb })
    cache.write('lrclib', { kind: 'found', lyrics: SYNCED })
    clock += VOCADB_TTL_SEC - 10
    expect(cache.read('vocadb')).toEqual({ kind: 'found', lyrics: fromVocadb })
    clock += 20
    expect(cache.read('vocadb')).toBeNull()
    expect(cache.read('lrclib')).toEqual({ kind: 'found', lyrics: SYNCED })
  })

  it('keeps YouTube Music’s words and their credit, and asks LRCLIB again after a while', () => {
    let clock = 1_000_000
    const cache = openLyricsCache(dir, () => clock)
    const fromPage: Lyrics = {
      kind: 'plain',
      lines: ['a'],
      source: 'ytmusic',
      credit: 'Musixmatch'
    }
    cache.write('page', { kind: 'found', lyrics: fromPage })
    expect(cache.read('page')).toEqual({ kind: 'found', lyrics: fromPage })
    clock += VOCADB_TTL_SEC + 10
    expect(cache.read('page')).toBeNull()
  })

  it('keeps showing LRCLIB finds from older lookups, and says they want a re-check', () => {
    const cache = openLyricsCache(dir)
    cache.write('irony', { kind: 'found', lyrics: SYNCED })
    expect(cache.needsRecheck('irony')).toBe(false)
    const [file] = readdirSync(dir)
    const path = join(dir, file ?? '')
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), lookup: 3 }))
    expect(cache.read('irony')).toEqual({ kind: 'found', lyrics: SYNCED })
    expect(cache.needsRecheck('irony')).toBe(true)
    cache.write('irony', { kind: 'found', lyrics: SYNCED })
    expect(cache.needsRecheck('irony')).toBe(false)
    expect(cache.needsRecheck('never saved')).toBe(false)
  })

  it('asks again about misses and VocaDB’s words from an older lookup, keeping the rest', () => {
    const cache = openLyricsCache(dir)
    const words: Record<string, Lyrics | null> = {
      miss: null,
      vocadb: { kind: 'plain', lines: ['a'], source: 'vocadb' },
      page: { kind: 'plain', lines: ['a'], source: 'ytmusic' },
      lrclib: SYNCED
    }
    for (const [key, lyrics] of Object.entries(words)) {
      cache.write(key, lyrics ? { kind: 'found', lyrics } : { kind: 'notFound' })
    }
    for (const file of readdirSync(dir)) {
      const path = join(dir, file)
      const saved: Record<string, unknown> = JSON.parse(readFileSync(path, 'utf8'))
      delete saved.lookup
      writeFileSync(path, JSON.stringify(saved))
    }
    expect(cache.read('miss')).toBeNull()
    expect(cache.read('vocadb')).toBeNull()
    expect(cache.read('page')).toMatchObject({ kind: 'found' })
    expect(cache.read('lrclib')).toEqual({ kind: 'found', lyrics: SYNCED })
  })

  it('asks again about LRCLIB’s answers from the lookup that could take another language’s', () => {
    const cache = openLyricsCache(dir)
    cache.write('today', { kind: 'found', lyrics: SYNCED })
    cache.write('before', { kind: 'found', lyrics: SYNCED })
    for (const file of readdirSync(dir)) {
      const path = join(dir, file)
      const saved: Record<string, unknown> = JSON.parse(readFileSync(path, 'utf8'))
      saved.lookup = saved.key === 'today' ? 2 : 1
      writeFileSync(path, JSON.stringify(saved))
    }
    expect(cache.read('today')).toBeNull()
    expect(cache.read('before')).toEqual({ kind: 'found', lyrics: SYNCED })
  })

  it('treats a broken or foreign file as not cached', () => {
    const cache = openLyricsCache(dir)
    cache.write('key', { kind: 'found', lyrics: SYNCED })
    const [file = ''] = readdirSync(dir)
    const path = join(dir, file)
    const saved = JSON.parse(readFileSync(path, 'utf8'))
    writeFileSync(path, JSON.stringify({ ...saved, key: 'other' }))
    expect(cache.read('key')).toBeNull()
    writeFileSync(path, '{ half')
    expect(cache.read('key')).toBeNull()
  })

  it('only warns when it cannot write', () => {
    const blocker = join(dir, 'file')
    writeFileSync(blocker, '')
    const cache = openLyricsCache(join(blocker, 'lyrics'))
    expect(() => cache.write('key', { kind: 'notFound' })).not.toThrow()
    expect(console.warn).toHaveBeenCalled()
  })
})

describe('offset store', () => {
  it('saves per-song offsets and reloads them', () => {
    const file = join(dir, 'lyrics-offsets.json')
    const store = openOffsetStore(file)
    store.set('a', 1.5)
    store.set('b', -0.5)
    store.set('b', 0)
    expect(openOffsetStore(file).get('a')).toBe(1.5)
    expect(openOffsetStore(file).get('b')).toBe(0)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, offsets: { a: 1.5 } })
  })

  it('starts empty from a missing or broken file', () => {
    const file = join(dir, 'lyrics-offsets.json')
    expect(openOffsetStore(file).get('a')).toBe(0)
    writeFileSync(file, 'nope')
    expect(openOffsetStore(file).get('a')).toBe(0)
    writeFileSync(file, JSON.stringify({ offsets: { a: 'x', b: 99 } }))
    expect(openOffsetStore(file).get('a')).toBe(0)
    expect(openOffsetStore(file).get('b')).toBe(30)
  })
})

describe('parsing', () => {
  it('accepts only known lyrics commands', () => {
    expect(parseLyricsCommand({ kind: 'setVisible', on: false })).toEqual({
      kind: 'setVisible',
      on: false
    })
    expect(parseLyricsCommand({ kind: 'nudgeOffset', direction: 'later' })).toEqual({
      kind: 'nudgeOffset',
      direction: 'later'
    })
    expect(parseLyricsCommand({ kind: 'resetOffset', extra: 1 })).toEqual({ kind: 'resetOffset' })
    expect(parseLyricsCommand({ kind: 'nudgeOffset', direction: 5 })).toBeNull()
    expect(parseLyricsCommand({ kind: 'setVisible' })).toBeNull()
    expect(parseLyricsCommand({ kind: 'setAlbumInk', on: true })).toEqual({
      kind: 'setAlbumInk',
      on: true
    })
    expect(parseLyricsCommand({ kind: 'setAlbumInk', on: 'yes' })).toBeNull()
    expect(parseLyricsCommand('resetOffset')).toBeNull()
  })

  it('validates cached lyrics', () => {
    expect(parseLyrics(SYNCED)).toEqual(SYNCED)
    expect(parseLyrics({ kind: 'plain', lines: ['a', ''], source: 'demo' })).toEqual({
      kind: 'plain',
      lines: ['a', ''],
      source: 'demo'
    })
    expect(parseLyrics({ kind: 'instrumental', source: 'lrclib' })).toEqual({
      kind: 'instrumental',
      source: 'lrclib'
    })
    expect(parseLyrics({ kind: 'synced', lines: [{ timeSec: -1 }], source: 'lrclib' })).toBeNull()
    expect(parseLyrics({ kind: 'plain', lines: [1], source: 'lrclib' })).toBeNull()
    expect(parseLyrics({ kind: 'plain', lines: [], source: 'lrclib' })).toBeNull()
    expect(parseLyrics({ kind: 'plain', lines: ['a'], source: 'vocadb' })).toEqual({
      kind: 'plain',
      lines: ['a'],
      source: 'vocadb'
    })
    expect(parseLyrics({ kind: 'plain', lines: ['a'], source: 'genius' })).toBeNull()
  })

  it('clamps and rounds offsets', () => {
    expect(clampOffset(0.1 + 0.2)).toBe(0.3)
    expect(clampOffset(100)).toBe(30)
    expect(clampOffset(-100)).toBe(-30)
    expect(clampOffset(Number.NaN)).toBe(0)
  })
})

describe('syncedLineIndex', () => {
  const lines = [
    { timeSec: 5, text: 'a' },
    { timeSec: 10, text: 'b' },
    { timeSec: 10, text: 'c' },
    { timeSec: 20, text: 'd' }
  ]

  it('finds the line on screen at a time', () => {
    expect(syncedLineIndex(lines, 0)).toBe(-1)
    expect(syncedLineIndex(lines, 5)).toBe(0)
    expect(syncedLineIndex(lines, 9.99)).toBe(0)
    expect(syncedLineIndex(lines, 10)).toBe(2)
    expect(syncedLineIndex(lines, 500)).toBe(3)
    expect(syncedLineIndex([], 5)).toBe(-1)
  })
})

describe('what a lookup brings with it', () => {
  it('saves the lyrics shown, never the other versions the lookup saw', () => {
    const cache = openLyricsCache(dir)
    const other = {
      id: 1,
      title: 'a',
      artist: 'b',
      album: '',
      durationSec: 200,
      credit: null,
      lyrics: SYNCED
    }
    cache.write('irony', { kind: 'found', lyrics: SYNCED, seen: [other] } as never)
    const [file] = readdirSync(dir)
    expect(readFileSync(join(dir, file ?? ''), 'utf8')).not.toContain('seen')
  })
})

describe('where lyrics came from', () => {
  const from = {
    id: 10604292,
    artist: '25時、ナイトコードで。 feat. 宵崎奏',
    durationSec: 251,
    credit: 'singers' as const
  }

  it('reads it back', () => {
    expect(parseLyrics({ ...SYNCED, from })).toEqual({ ...SYNCED, from })
    const cache = openLyricsCache(dir)
    cache.write('irony', { kind: 'found', lyrics: { ...SYNCED, from } })
    expect(cache.read('irony')).toEqual({ kind: 'found', lyrics: { ...SYNCED, from } })
  })

  it('drops an off-shape one, keeping the lyrics', () => {
    for (const bad of [
      { ...from, id: -1 },
      { ...from, id: 1.5 },
      { ...from, credit: 'everyone' },
      { ...from, durationSec: Number.NaN },
      { ...from, artist: 7 },
      'irony'
    ]) {
      expect(parseLyrics({ ...SYNCED, from: bad })).toEqual(SYNCED)
    }
  })
})
