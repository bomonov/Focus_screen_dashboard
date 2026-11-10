import { describe, expect, it } from 'vitest'
import {
  breakProgress,
  breakSpan,
  estimateWords,
  lineWords,
  GLIDE,
  GLIDE_ROWS,
  glideDelayMs,
  glides,
  MAX_DISTANCE,
  plainRows,
  rowDistance,
  seekTarget,
  syncedRow,
  syncedRows,
  voiceLight,
  voicesNow,
  type GlideRow
} from './lyricsGlide'
import type { LyricsColors } from '../../../main/ipc'
import { springEasing } from '../tabBarMotion'

const lines = [
  { timeSec: 12, text: 'first' },
  { timeSec: 15, text: '' },
  { timeSec: 20, text: 'second' }
]

describe('syncedRows', () => {
  it('starts with an intro row when the singing starts a while in, and breaks are dots', () => {
    expect(syncedRows(lines, null)).toEqual([
      { text: null, romaji: null, timeSec: 0 },
      { text: 'first', romaji: null, timeSec: 12 },
      { text: null, romaji: null, timeSec: 15 },
      { text: 'second', romaji: null, timeSec: 20 }
    ])
  })

  it('has no intro row when the singing starts straight away', () => {
    const early = [{ timeSec: 0.4, text: 'now' }, ...lines]
    expect(syncedRows(early, null)[0]?.text).toBe('now')
    expect(syncedRow(early, -1)).toBe(0)
  })

  it('puts each line’s romaji with it, none under a line without', () => {
    const rows = syncedRows(lines, ['fāsuto', '', 'sekando'])
    expect(rows.map((row) => row.romaji)).toEqual([null, 'fāsuto', null, 'sekando'])
  })

  it('carries each line’s singers and voices', () => {
    const echo = [{ text: 'second', start: 21, end: 22.5 }]
    const colors: LyricsColors = {
      lines: [[['ichika']], null, [['miku', 'ichika']]],
      voices: [{ under: 2, words: echo, singers: [['ichika']] }],
      romajiSplits: [null, null, [3]],
      extra: []
    }
    expect(syncedRows(lines, null, colors)).toEqual([
      { text: null, romaji: null, timeSec: 0 },
      { text: 'first', romaji: null, timeSec: 12, singers: [['ichika']], coded: true },
      { text: null, romaji: null, timeSec: 15 },
      {
        text: 'second',
        romaji: null,
        timeSec: 20,
        singers: [['miku', 'ichika']],
        coded: true,
        voices: [{ words: echo, singers: [['ichika']] }],
        romajiSplits: [3]
      }
    ])
    // Uncolored songs' rows are exactly as before.
    expect(syncedRows(lines, null, null)).toEqual(syncedRows(lines, null))
  })

  it('counts the intro row when finding the sung one', () => {
    expect(syncedRow(lines, -1)).toBe(0)
    expect(syncedRow(lines, 0)).toBe(1)
    expect(syncedRow(lines, 2)).toBe(3)
  })
})

describe('plainRows', () => {
  it('carries each line’s singers, which plain lyrics have no word texts for', () => {
    const colors: LyricsColors = {
      lines: [[['ichika'], ['miku']], null],
      voices: [],
      romajiSplits: [null, null],
      extra: []
    }
    expect(plainRows(['a b', 'c'], null, colors)).toEqual([
      { text: 'a b', romaji: null, timeSec: null, singers: [['ichika'], ['miku']] },
      { text: 'c', romaji: null, timeSec: null }
    ])
  })

  it('keeps stanza gaps as gaps, with no times to jump to', () => {
    expect(plainRows(['  a ', '', 'b'], null)).toEqual([
      { text: 'a', romaji: null, timeSec: null },
      { text: '', romaji: null, timeSec: null },
      { text: 'b', romaji: null, timeSec: null }
    ])
  })
})

describe('voicesNow', () => {
  const row: GlideRow = {
    text: 'main',
    romaji: null,
    timeSec: 10,
    voices: [
      { words: [{ text: 'echo', start: 11, end: 12 }], singers: [['miku']] },
      {
        words: [
          { text: 'call ', start: 11.5, end: 13 },
          { text: 'back', start: 13, end: 14 }
        ],
        singers: [['ichika'], ['ichika']]
      }
    ]
  }

  it('lists the voices sung at a time, from their first word’s start to their last one’s end', () => {
    expect(voicesNow(row, 10.5)).toEqual([])
    expect(voicesNow(row, 11)).toEqual([0])
    expect(voicesNow(row, 11.6)).toEqual([0, 1])
    expect(voicesNow(row, 13.5)).toEqual([1])
    expect(voicesNow(row, 14)).toEqual([])
  })

  it('is empty for a row without voices', () => {
    expect(voicesNow({ text: 'main', romaji: null, timeSec: 10 }, 11)).toEqual([])
  })
})

describe('voiceLight', () => {
  const row: GlideRow = {
    text: 'main',
    romaji: null,
    timeSec: 10,
    voices: [
      { words: [{ text: 'echo', start: 11, end: 12 }], singers: [['miku']] },
      { words: [{ text: 'past', start: 12.5, end: 14 }], singers: [['ichika']] }
    ]
  }

  it('lights every voice of the sung row, each waiting for its own first word', () => {
    expect(voiceLight(row, true, 10.5)).toEqual({ lit: [0, 1], lifted: false })
  })

  it('lights a voice sung past its line on its own, and lifts its row to the sung one’s', () => {
    expect(voiceLight(row, false, 13.5)).toEqual({ lit: [1], lifted: true })
  })

  it('lights nothing on a row whose voices aren’t being sung', () => {
    expect(voiceLight(row, false, 15)).toEqual({ lit: [], lifted: false })
    expect(voiceLight(row, false, null)).toEqual({ lit: [], lifted: false })
    expect(voiceLight({ text: 'main', romaji: null, timeSec: 10 }, true, 10.5)).toEqual({
      lit: [],
      lifted: false
    })
  })
})

describe('the glide', () => {
  it('dims rows by distance, up to a limit', () => {
    expect(rowDistance(5, 5)).toBe(0)
    expect(rowDistance(4, 5)).toBe(1)
    expect(rowDistance(30, 5)).toBe(MAX_DISTANCE)
  })

  it('ripples down from the sung line on the next line', () => {
    expect(glideDelayMs(3, 5, 1)).toBe(0)
    expect(glideDelayMs(5, 5, 1)).toBe(0)
    expect(glideDelayMs(6, 5, 1)).toBe(45)
    expect(glideDelayMs(7, 5, 1)).toBe(90)
    // The ripple stops growing a few rows down.
    expect(glideDelayMs(40, 5, 1)).toBe(glideDelayMs(11, 5, 1))
  })

  it('moves everything at once going back or after a jump', () => {
    expect(glideDelayMs(7, 5, -1)).toBe(0)
    expect(glideDelayMs(7, 5, 12)).toBe(0)
  })

  it('only glides rows near the sung one', () => {
    expect(glides(5 + GLIDE_ROWS, 5)).toBe(true)
    expect(glides(6 + GLIDE_ROWS, 5)).toBe(false)
  })

  it('turns the spring into an easing that ends at rest, after a small overshoot', () => {
    const easing = springEasing(GLIDE, 0.9)
    const values = easing.slice('linear('.length, -1).split(', ').map(Number)
    expect(values[0]).toBe(0)
    expect(values.at(-1)).toBe(1)
    const peak = Math.max(...values)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThan(1.05)
    // Settled by the end, so the last step to exactly 1 doesn't show.
    expect(Math.abs((values.at(-2) ?? 0) - 1)).toBeLessThan(0.01)
  })
})

describe('seekTarget', () => {
  it('lands just inside the row, counting the lyrics offset', () => {
    expect(seekTarget(20, 0)).toBeCloseTo(20.05)
    // Lyrics shown 0.5 s early: the song only needs to reach 19.5 s.
    expect(seekTarget(20, 0.5)).toBeCloseTo(19.55)
    expect(seekTarget(0, 0.5)).toBe(0)
  })
})

describe('breaks', () => {
  const rows = syncedRows(lines, null)

  it('lasts from the break’s time to the next line’s, or the song’s end', () => {
    // The intro, then the break between "first" and "second".
    expect(breakSpan(rows, 0, 200)).toEqual({ start: 0, end: 12 })
    expect(breakSpan(rows, 2, 200)).toEqual({ start: 15, end: 20 })
    expect(breakSpan(rows, 1, 200)).toBeNull()
    const outro = syncedRows([...lines, { timeSec: 30, text: '' }], null)
    expect(breakSpan(outro, 4, 200)).toEqual({ start: 30, end: 200 })
  })

  it('fills from empty to full across the break', () => {
    const span = { start: 15, end: 20 }
    expect(breakProgress(span, 14)).toBe(0)
    expect(breakProgress(span, 17.5)).toBe(0.5)
    expect(breakProgress(span, 25)).toBe(1)
  })
})

describe('word timings', () => {
  it('shares a line’s time out by how long each word sounds, ending before the next line', () => {
    const words = estimateWords('But I can still hear you', 10, 12)
    expect(words.map((word) => word.text)).toEqual(['But ', 'I ', 'can ', 'still ', 'hear ', 'you'])
    expect(words[0]?.start).toBe(10)
    expect(words.at(-1)?.end).toBeCloseTo(11.85)
    // "still" and "I" are one syllable each, however many letters.
    const length = (i: number): number => (words[i]?.end ?? 0) - (words[i]?.start ?? 0)
    expect(length(3) / length(1)).toBeCloseTo(1)
    const city = estimateWords('city lights', 0, 10)
    expect((city[0]?.end ?? 0) - (city[0]?.start ?? 0)).toBeCloseTo(
      2 * ((city[1]?.end ?? 0) - (city[1]?.start ?? 0))
    )
  })

  it('gives Japanese pieces the time they sound: ありがとう and 永遠に are five beats each', () => {
    const words = estimateWords('ありがとう 永遠に', 0, 10)
    const length = (i: number): number => (words[i]?.end ?? 0) - (words[i]?.start ?? 0)
    expect(length(0)).toBeCloseTo(length(1))
  })

  it('doesn’t crawl through a long pause: a line takes only as long as its length allows', () => {
    const words = estimateWords('Oh no', 10, 60)
    expect(words.at(-1)?.end).toBeCloseTo(11)
  })

  it('splits Japanese without spaces into words, shared by beats, within the same cap', () => {
    expect(estimateWords('まだ終わらない夢の続きを', 0, 30).map((word) => word.text)).toEqual([
      'まだ',
      '終わらない',
      '夢の',
      '続きを'
    ])
    const words = estimateWords('終わらないアニメ', 5, 30)
    expect(words.map((word) => word.text)).toEqual(['終わらない', 'アニメ'])
    expect(words.at(-1)?.end).toBeCloseTo(5 + 8 * 0.3)
    // 終わらない is six beats, アニメ three.
    const length = (i: number): number => (words[i]?.end ?? 0) - (words[i]?.start ?? 0)
    expect(length(0)).toBeCloseTo(2 * length(1))
  })

  it('keeps a Japanese line’s spaces where they were', () => {
    const words = estimateWords('夜の駅で 君を待ってた', 0, 10)
    expect(words.map((word) => word.text).join('')).toBe('夜の駅で 君を待ってた')
    expect(words.map((word) => word.text)).toEqual(['夜の', '駅で ', '君を', '待ってた'])
  })

  it('uses a line’s own word timings when they spell out its text', () => {
    const timed = [
      { text: 'Hello ', start: 1, end: 1.4 },
      { text: 'world', start: 1.6, end: 2.4 }
    ]
    const row = { text: 'Hello world', romaji: null, timeSec: 1, words: timed }
    expect(lineWords(row, 5)).toEqual({ words: timed, timed: true })
    // Words that don't match the line (lyrics edited since) are worked out instead.
    const stale = { ...row, text: 'Goodbye world' }
    const guessed = lineWords(stale, 5)
    expect(guessed.timed).toBe(false)
    expect(guessed.words.map((word) => word.text)).toEqual(['Goodbye ', 'world'])
  })

  it('draws a colored row’s own words, none when all of it became a second voice', () => {
    const kept = [{ text: 'Hello ', start: 1, end: 1.4 }]
    const row = { text: 'Hello (hello)', romaji: null, timeSec: 1, coded: true as const }
    expect(lineWords({ ...row, words: kept }, 5)).toEqual({ words: kept, timed: true })
    expect(lineWords(row, 5)).toEqual({ words: [], timed: true })
  })

  it('spreads a colored row’s words out again when they all sit on one moment', () => {
    // Auto-sync couldn't place the line and put every word on one instant; the user moved the
    // line, and its words stayed piled up, so the whole line lit at once (2026-11-07).
    const stacked = ['Hello ', 'little ', 'world'].map((text) => ({ text, start: 12.4, end: 12.4 }))
    const row = { text: 'Hello little world', romaji: null, timeSec: 10.6, coded: true as const }
    const spread = lineWords({ ...row, words: stacked }, 13)
    expect(spread.timed).toBe(false)
    // The same words (singers line up with them), lit one after another from the line's start.
    expect(spread.words.map((word) => word.text)).toEqual(['Hello ', 'little ', 'world'])
    expect(spread.words[0]?.start).toBe(10.6)
    const starts = spread.words.map((word) => word.start)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
    expect(new Set(starts).size).toBe(3)
    expect(spread.words.at(-1)?.end ?? 0).toBeLessThanOrEqual(13)
  })

  it('works out a row’s words when its own timings all sit on one moment', () => {
    const stacked = [
      { text: 'Hello ', start: 29.26, end: 29.26 },
      { text: 'world', start: 29.26, end: 29.26 }
    ]
    const row = { text: 'Hello world', romaji: null, timeSec: 29.26, words: stacked }
    const worked = lineWords(row, 32)
    expect(worked.timed).toBe(false)
    expect(worked.words[1]?.start ?? 0).toBeGreaterThan(29.26)
  })

  it('keeps a lone word, and words a moment apart, as they are', () => {
    const lone = [{ text: 'Hey', start: 3, end: 3 }]
    const row = { text: 'Hey', romaji: null, timeSec: 3, coded: true as const, words: lone }
    expect(lineWords(row, 5)).toEqual({ words: lone, timed: true })
    const quick = [
      { text: 'a ', start: 3, end: 3.1 },
      { text: 'b', start: 3.1, end: 3.2 }
    ]
    expect(lineWords({ ...row, text: 'a b', words: quick }, 5)).toEqual({
      words: quick,
      timed: true
    })
  })

  it('has no words for breaks or untimed rows', () => {
    const none = { words: [], timed: false }
    expect(lineWords({ text: null, romaji: null, timeSec: 3 }, 5)).toEqual(none)
    expect(lineWords({ text: 'plain', romaji: null, timeSec: null }, 5)).toEqual(none)
  })
})
