import { describe, expect, it } from 'vitest'
import { lyricsQuery } from '../query'
import { colorLyrics } from '../singers/apply'
import { castSinger } from '../singers/cast'
import { parseSongColors } from '../singers/parse'
import type { SongColors } from '../singers/types'
import type { SyncedLine } from '../types'
import { createDemoLyricsProvider } from './provider'

const query = (title: string): NonNullable<ReturnType<typeof lyricsQuery>> => {
  const found = lyricsQuery({
    title,
    artist: 'Tempe Night Choir',
    album: 'Desert Radio',
    durationSec: 196
  })
  if (!found) throw new Error('no query')
  return found
}

describe('the demo’s Japanese song', () => {
  it('shows every part of the sung line’s light-up with no network', async () => {
    const demo = createDemoLyricsProvider()
    const result = await demo.lookup(query('星空レター'))
    if (result.kind !== 'found' || result.lyrics.kind !== 'synced') throw new Error('not synced')
    const lines = result.lyrics.lines
    // A line with real word timings that holds a word for two seconds or more.
    const held = lines
      .flatMap((line) => line.words ?? [])
      .some((word) => word.end - word.start >= 2)
    expect(held).toBe(true)
    // A long Japanese line with no spaces, to wrap in Full on a narrow card.
    expect(
      lines.some(
        (line) => /[ぁ-ん]/.test(line.text) && !/\s/.test(line.text) && [...line.text].length >= 20
      )
    ).toBe(true)
    // An instrumental break.
    expect(lines.some((line) => line.text === '')).toBe(true)

    const romaji =
      demo.romaji?.(
        query('星空レター'),
        lines.map((line) => line.text)
      ) ?? null
    expect(romaji).toHaveLength(lines.length)
    lines.forEach((line, i) => {
      const japanese = /[ぁ-んァ-ン一-龯]/.test(line.text)
      expect(Boolean(romaji?.[i])).toBe(japanese)
    })
  })

  it('the demo’s romaji follows the lines it’s given', async () => {
    const demo = createDemoLyricsProvider()
    const result = await demo.lookup(query('星空レター'))
    if (result.kind !== 'found' || result.lyrics.kind !== 'synced') throw new Error('not synced')
    const first = result.lyrics.lines.find((line) => /[ぁ-ん]/.test(line.text))
    if (!first) throw new Error('no Japanese line')
    const romaji = demo.romaji?.(query('星空レター'), [first.text, 'まだない行'])
    expect(romaji?.[0]).toBeTruthy()
    expect(romaji?.[1]).toBe('')
    expect(romaji).toHaveLength(2)
  })

  it('has no romaji for the other demo songs', () => {
    expect(createDemoLyricsProvider().romaji?.(query('Low Sun Hours'), []) ?? null).toBeNull()
  })
})

describe('the demo’s 星空レター comes colored', () => {
  async function lookedUp(): Promise<{
    lines: SyncedLine[]
    coding: SongColors
  }> {
    const demo = createDemoLyricsProvider()
    const result = await demo.lookup(query('星空レター'))
    if (result.kind !== 'found' || result.lyrics.kind !== 'synced') throw new Error('not synced')
    const coding = demo.colors?.(query('星空レター')) ?? null
    if (!coding) throw new Error('no coding')
    return { lines: result.lyrics.lines, coding }
  }

  it('has a coding that reads back clean, with two singers and everyone as their cast', async () => {
    const { coding } = await lookedUp()
    // Through the same gate a saved coding goes through: nothing in it is left out or bent.
    const saved = parseSongColors(
      JSON.parse(JSON.stringify(coding)),
      (id) => castSinger(id) !== undefined
    )
    expect(saved).toEqual(coding)
    expect(coding.cast).toEqual(['ichika', 'miku'])
    expect(coding.extra).toEqual([])
  })

  it('shows a duet word, an everyone line and a second voice', async () => {
    const { coding } = await lookedUp()
    const words = coding.lines.flatMap((line) => line.words)
    const singers = words.map((word) => word.singers)
    expect(singers).toContainEqual(['ichika'])
    expect(singers).toContainEqual(['miku'])
    // One word the two share.
    expect(singers.filter((who) => Array.isArray(who) && who.length === 2)).toHaveLength(1)
    // A line sung by everyone.
    expect(
      coding.lines.some(
        (line) => line.words.length > 0 && line.words.every((w) => w.singers === 'everyone')
      )
    ).toBe(true)
    // A second voice under a main line before it.
    const voices = coding.lines.flatMap((line, index) =>
      line.under === undefined ? [] : [{ line, index }]
    )
    expect(voices).toHaveLength(1)
    const { line: voice, index } = voices[0] ?? { line: undefined, index: -1 }
    expect(voice?.under).toBeLessThan(index)
    expect(coding.lines[voice?.under ?? -1]?.under).toBeUndefined()
  })

  it('has its second voice run on about a second into the next line, inside the song', async () => {
    const { lines, coding } = await lookedUp()
    const voice = coding.lines.find((line) => line.under !== undefined)
    const main = coding.lines[voice?.under ?? -1]
    const next = lines.find((line) => line.timeSec > (main?.start ?? Infinity))
    expect(voice && next).toBeTruthy()
    expect((voice?.end ?? 0) - (next?.timeSec ?? 0)).toBeCloseTo(1, 1)
    expect(voice?.start).toBeLessThan(main?.end ?? 0)
  })

  it('is made from the demo’s own lines: every one with words is matched, in its own time', async () => {
    const { lines, coding } = await lookedUp()
    const colored = colorLyrics({ kind: 'synced', lines, source: 'demo' }, coding)
    if (colored?.lyrics.kind !== 'synced') throw new Error('not colored')
    // Nothing moves: the coding sits exactly where the demo's lines already are.
    expect(colored.lyrics.lines.map(({ timeSec, text }) => ({ timeSec, text }))).toEqual(
      lines.map(({ timeSec, text }) => ({ timeSec, text }))
    )
    colored.colors.lines.forEach((words, i) => {
      expect(words !== null).toBe(lines[i]?.text !== '')
    })
    expect(colored.colors.voices).toHaveLength(1)
    // The demo's held "tonight" keeps its timings.
    const stay = colored.lyrics.lines.find((line) => line.text === 'Stay with me tonight')
    expect(stay?.words?.some((word) => word.end - word.start >= 2)).toBe(true)
  })

  it('is timed like a song the user timed, so it shows at its own times', async () => {
    const { coding } = await lookedUp()
    expect(coding.lines.every((line) => line.timed === true)).toBe(true)
  })

  it('times every word inside its line, in order', async () => {
    const { coding } = await lookedUp()
    for (const line of coding.lines) {
      expect(line.end).toBeGreaterThan(line.start)
      expect(line.words.map((word) => word.text).join('')).toBe(line.text)
      let after = line.start
      for (const word of line.words) {
        expect(word.start).toBeGreaterThanOrEqual(after)
        expect(word.end).toBeGreaterThanOrEqual(word.start)
        expect(word.end).toBeLessThanOrEqual(line.end)
        after = word.start
      }
    }
  })

  it('leaves the other demo songs uncolored', () => {
    const demo = createDemoLyricsProvider()
    expect(demo.colors?.(query('Low Sun Hours')) ?? null).toBeNull()
    expect(demo.colors?.(query('Monsoon Drive')) ?? null).toBeNull()
  })
})
