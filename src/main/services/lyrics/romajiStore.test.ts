import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  openRomajiStore,
  ROMAJI_NOT_FOUND_TTL_SEC,
  savedRomajiStamp,
  savedRomanizations
} from './romajiStore'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'focus-screen-romaji-'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const FOUND = { kind: 'found', original: 'あさ\nよる', romanized: 'asa\nyoru' } as const

describe('romaji store', () => {
  it('reads back what it wrote, in files named by hash', () => {
    const store = openRomajiStore(join(dir, 'romaji'))
    store.write('artist|song|200', FOUND)
    expect(store.read('artist|song|200')).toEqual(FOUND)
    expect(store.read('artist|other|200')).toBeNull()
    expect(readdirSync(join(dir, 'romaji'))[0]).toMatch(/^[0-9a-f]{40}\.json$/)
  })

  it('asks again about a song VocaDB had no romaji for, after a week', () => {
    let clock = 1_800_000_000
    const store = openRomajiStore(dir, () => clock)
    store.write('k', { kind: 'notFound' })
    clock += ROMAJI_NOT_FOUND_TTL_SEC - 1
    expect(store.read('k')).toEqual({ kind: 'notFound' })
    clock += 2
    expect(store.read('k')).toBeNull()
  })

  it('treats a damaged file as never asked', () => {
    const store = openRomajiStore(dir)
    store.write('k', FOUND)
    const [file = ''] = readdirSync(dir)
    writeFileSync(join(dir, file), '{"version":1,"key":"k","savedAt":1,"result":{"kind":"found"}}')
    expect(store.read('k')).toBeNull()
    writeFileSync(join(dir, file), 'not json')
    expect(store.read('k')).toBeNull()
  })

  it('lists every romanization saved, for the romaji maker to learn from', () => {
    const store = openRomajiStore(dir)
    store.write('a|one|200', FOUND)
    store.write('a|two|200', { kind: 'notFound' })
    store.write('a|three|200', { kind: 'found', original: 'うみ', romanized: 'umi' })
    writeFileSync(join(dir, 'broken.json'), 'not json')
    writeFileSync(join(dir, 'notes.txt'), 'hello')
    const saved = savedRomanizations(dir)
    expect(saved).toHaveLength(2)
    expect(saved).toEqual(
      expect.arrayContaining([
        { original: 'あさ\nよる', romanized: 'asa\nyoru' },
        { original: 'うみ', romanized: 'umi' }
      ])
    )
    expect(savedRomanizations(join(dir, 'missing'))).toEqual([])
  })

  it('stamps what is saved, so a new romanization can be told from none', () => {
    const store = openRomajiStore(dir)
    const empty = savedRomajiStamp(dir)
    store.write('a|one|200', FOUND)
    const one = savedRomajiStamp(dir)
    expect(one).not.toBe(empty)
    expect(savedRomajiStamp(dir)).toBe(one)
    store.write('a|nothing|200', { kind: 'notFound' })
    store.write('a|one|201', FOUND)
    // Nothing new to learn from: a miss, and the same song saved at another length.
    expect(savedRomajiStamp(dir)).toBe(one)
    store.write('a|two|200', { kind: 'found', original: 'うみ', romanized: 'umi' })
    expect(savedRomajiStamp(dir)).not.toBe(one)
    expect(savedRomajiStamp(join(dir, 'missing'))).toBe(savedRomajiStamp(join(dir, 'gone')))
  })
})
