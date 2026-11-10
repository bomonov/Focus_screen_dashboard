import { createHash } from 'crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openSongColorsStore } from './store'
import type { SongColors } from './types'

let dir: string
let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'focus-screen-singers-'))
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function coding(text = 'hello world'): SongColors {
  return {
    version: 1,
    cast: ['ichika', 'saki'],
    extra: [],
    lines: [
      {
        text,
        start: 10,
        end: 20,
        words: [
          { text: 'hello ', start: 10, end: 14, singers: ['ichika'] },
          { text: 'world', start: 14, end: 20, singers: 'everyone' }
        ]
      }
    ]
  }
}

/** Where the store should put a song, so a test can plant or look for a file there. */
function hashed(key: string): string {
  return createHash('sha1').update(key).digest('hex')
}

function jsonFiles(): string[] {
  return readdirSync(dir).filter((name) => name.endsWith('.json'))
}

function waveformFiles(): string[] {
  const folder = join(dir, 'waveforms')
  return existsSync(folder) ? readdirSync(folder) : []
}

describe('song colors store', () => {
  it("writes and reads a song's colors", () => {
    const store = openSongColorsStore(dir)
    expect(store.read('a|b|200')).toBeNull()
    store.write('a|b|200', coding())
    expect(store.read('a|b|200')).toEqual(coding())
    expect(store.read('a|other|200')).toBeNull()
    // Keys hold "|" and any script, so the file is named by a hash of it.
    expect(jsonFiles()).toEqual([`${hashed('a|b|200')}.json`])
  })

  it('survives being opened again', () => {
    openSongColorsStore(dir).write('a|b|200', coding())
    expect(openSongColorsStore(dir).read('a|b|200')).toEqual(coding())
  })

  it("keeps a song's key in its file, so a hash match is confirmed", () => {
    const store = openSongColorsStore(dir)
    store.write('星空|歌|200', coding())
    const raw = JSON.parse(readFileSync(join(dir, `${hashed('星空|歌|200')}.json`), 'utf8')) as {
      version: number
      key: string
    }
    expect(raw.version).toBe(1)
    expect(raw.key).toBe('星空|歌|200')
  })

  it('finds a coding saved a second off and replaces it', () => {
    const store = openSongColorsStore(dir)
    store.write('a|b|200', coding('first'))
    expect(store.read('a|b|201')).toEqual(coding('first'))
    expect(store.read('a|b|199')).toEqual(coding('first'))
    // Two seconds off is another recording.
    expect(store.read('a|b|202')).toBeNull()

    store.write('a|b|201', coding('second'))
    expect(jsonFiles()).toEqual([`${hashed('a|b|201')}.json`])
    expect(store.read('a|b|200')).toEqual(coding('second'))
  })

  it('remove deletes colors and waveform', () => {
    const store = openSongColorsStore(dir)
    store.write('a|b|200', coding())
    store.writeWaveform('a|b|200', Uint8Array.from([1, 2, 3]))
    store.write('c|d|100', coding('kept'))
    store.writeWaveform('c|d|100', Uint8Array.from([9]))

    // A second off still counts as the same song, so it goes too.
    store.remove('a|b|201')

    expect(store.read('a|b|200')).toBeNull()
    expect(store.readWaveform('a|b|200')).toBeNull()
    expect(store.read('c|d|100')).toEqual(coding('kept'))
    expect(store.readWaveform('c|d|100')).toEqual(Uint8Array.from([9]))
    expect(jsonFiles()).toEqual([`${hashed('c|d|100')}.json`])
    expect(waveformFiles()).toEqual([`${hashed('c|d|100')}.bin`])
  })

  it('removing a song that was never saved is fine', () => {
    const store = openSongColorsStore(dir)
    expect(() => store.remove('a|b|200')).not.toThrow()
    expect(warn).not.toHaveBeenCalled()
  })

  it('a broken file reads as none', () => {
    const store = openSongColorsStore(dir)
    writeFileSync(join(dir, `${hashed('a|b|200')}.json`), '{ not json at all')
    expect(store.read('a|b|200')).toBeNull()

    writeFileSync(join(dir, `${hashed('a|b|200')}.json`), '[1, 2, 3]')
    expect(store.read('a|b|200')).toBeNull()

    // Valid JSON whose coding isn't one: the parser's say-so, not the store's.
    writeFileSync(
      join(dir, `${hashed('a|b|200')}.json`),
      JSON.stringify({ version: 1, key: 'a|b|200', colors: { version: 7, lines: 'no' } })
    )
    expect(store.read('a|b|200')).toBeNull()
  })

  it('a hash match for another song reads as none', () => {
    const store = openSongColorsStore(dir)
    // Not reachable by chance, but a copied or hand-edited file must not show under another song.
    writeFileSync(
      join(dir, `${hashed('a|b|200')}.json`),
      JSON.stringify({ version: 1, key: 'x|y|200', colors: coding() })
    )
    expect(store.read('a|b|200')).toBeNull()
  })

  it("doesn't trust a file's singers that aren't in the cast", () => {
    const store = openSongColorsStore(dir)
    const colors = coding()
    colors.lines = colors.lines.map((line) => ({
      ...line,
      words: line.words.map((word) => ({ ...word, singers: ['nobody-we-know'] }))
    }))
    writeFileSync(
      join(dir, `${hashed('a|b|200')}.json`),
      JSON.stringify({ version: 1, key: 'a|b|200', colors })
    )
    const read = store.read('a|b|200')
    expect(read?.lines.flatMap((line) => line.words.map((word) => word.singers))).toEqual([
      null,
      null
    ])
  })

  it('waveform round-trips bytes', () => {
    const store = openSongColorsStore(dir)
    expect(store.readWaveform('a|b|200')).toBeNull()
    const peaks = Uint8Array.from([0, 255, 17, 0, 128, 3])
    store.writeWaveform('a|b|200', peaks)
    expect(store.readWaveform('a|b|200')).toEqual(peaks)
    expect(waveformFiles()).toEqual([`${hashed('a|b|200')}.bin`])
    // A copy that's a plain Uint8Array, not a view into a shared read buffer.
    const read = store.readWaveform('a|b|200')
    expect(read?.constructor).toBe(Uint8Array)
    expect(read?.byteOffset).toBe(0)
  })

  it('finds a waveform saved a second off and replaces it', () => {
    const store = openSongColorsStore(dir)
    store.writeWaveform('a|b|200', Uint8Array.from([1, 2]))
    expect(store.readWaveform('a|b|201')).toEqual(Uint8Array.from([1, 2]))
    store.writeWaveform('a|b|201', Uint8Array.from([3, 4]))
    expect(waveformFiles()).toEqual([`${hashed('a|b|201')}.bin`])
    expect(store.readWaveform('a|b|200')).toEqual(Uint8Array.from([3, 4]))
  })

  it('tells subscribers the key', () => {
    const store = openSongColorsStore(dir)
    const heard: string[] = []
    const stop = store.subscribe((key) => heard.push(key))

    store.write('a|b|200', coding())
    expect(heard).toEqual(['a|b|200'])
    store.remove('a|b|201')
    expect(heard).toEqual(['a|b|200', 'a|b|201'])

    // The waveform fills in all the while a song plays: nobody wants a nudge for each piece.
    store.writeWaveform('a|b|200', Uint8Array.from([1]))
    expect(heard).toHaveLength(2)

    stop()
    store.write('a|b|200', coding())
    expect(heard).toHaveLength(2)
  })

  it('a listener can stop listening while it is being told', () => {
    const store = openSongColorsStore(dir)
    const calls: string[] = []
    const stopFirst = store.subscribe(() => {
      calls.push('first')
      stopFirst()
    })
    store.subscribe(() => calls.push('second'))
    store.write('a|b|200', coding())
    expect(calls).toEqual(['first', 'second'])
  })

  describe('when the disk refuses', () => {
    /** A folder that can't be made: its parent is a file. */
    function blockedStore(): ReturnType<typeof openSongColorsStore> {
      writeFileSync(join(dir, 'blocker'), 'x')
      return openSongColorsStore(join(dir, 'blocker', 'singers'))
    }

    it("a write that fails warns once, with no song's details, and tells nobody", () => {
      const store = blockedStore()
      const heard: string[] = []
      store.subscribe((key) => heard.push(key))

      expect(() => store.write('secret title|someone|200', coding())).not.toThrow()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(warn.mock.calls)).not.toContain('secret title')
      expect(JSON.stringify(warn.mock.calls)).not.toContain('someone')
      expect(heard).toEqual([])
      expect(store.read('secret title|someone|200')).toBeNull()
    })

    it('a waveform write that fails warns once and does not throw', () => {
      const store = blockedStore()
      expect(() =>
        store.writeWaveform('secret title|someone|200', Uint8Array.from([1]))
      ).not.toThrow()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(warn.mock.calls)).not.toContain('secret title')
    })

    it('a failed write keeps the coding it was going to replace', () => {
      const store = openSongColorsStore(dir)
      store.write('a|b|200', coding('first'))
      // The new file's place is taken by a folder, so writing there fails.
      mkdirSync(join(dir, `${hashed('a|b|201')}.json`))
      store.write('a|b|201', coding('second'))
      expect(warn).toHaveBeenCalledTimes(1)
      expect(store.read('a|b|200')).toEqual(coding('first'))
    })

    it('says whether a write or a remove worked, so the editor knows what is saved', () => {
      const store = openSongColorsStore(dir)
      expect(store.write('a|b|200', coding())).toBe(true)
      expect(store.remove('a|b|200')).toBe(true)
      expect(blockedStore().write('a|b|200', coding())).toBe(false)
      mkdirSync(join(dir, `${hashed('c|d|100')}.json`))
      expect(store.remove('c|d|100')).toBe(false)
    })

    it('a remove that fails warns once, with no details, and tells nobody', () => {
      const store = openSongColorsStore(dir)
      // A folder where a file should be: rmSync refuses it without `recursive`.
      mkdirSync(join(dir, `${hashed('secret title|someone|200')}.json`))
      const heard: string[] = []
      store.subscribe((key) => heard.push(key))

      expect(() => store.remove('secret title|someone|200')).not.toThrow()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(warn.mock.calls)).not.toContain('secret title')
      expect(heard).toEqual([])
    })
  })
})
