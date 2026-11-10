import { describe, expect, it } from 'vitest'
import type { CodedLine, ShownLine, SongColors } from '../../../main/ipc'
import { colorLyrics } from '../../../main/services/lyrics/singers/apply'
import { applyEdit } from '../../../main/services/lyrics/singers/edit'
import type { OwnLyrics } from '../../../main/services/lyrics/singers/listen'
import { syncedLineIndex } from '../../../main/services/lyrics/types'
import {
  ADD_SPAN_SEC,
  addedShownLines,
  addPlace,
  breakToAdd,
  findKept,
  keptLine,
  movedPlace,
  movedTimes,
  numberBefore,
  pastedLines,
  placeNow,
  retypeCheck,
  retypedLine
} from './addLines'

/** A line whose words are its space-split pieces, sharing its span evenly. */
function coded(text: string, start: number, end: number, over: Partial<CodedLine> = {}): CodedLine {
  const pieces = text.split(' ')
  const step = (end - start) / pieces.length
  return {
    text,
    start,
    end,
    words: pieces.map((piece, i) => ({
      text: i < pieces.length - 1 ? `${piece} ` : piece,
      start: start + step * i,
      end: start + step * (i + 1),
      singers: null
    })),
    ...over
  }
}

function coding(lines: CodedLine[]): SongColors {
  return { version: 1, lines, cast: [], extra: [] }
}

const timed = { timed: true } as const
const guessed = { guessed: true } as const
const added = { added: true, guessed: true } as const

/** Synced lyrics with A at 10 and B at 20, each one word four seconds long. */
const syncedAB: OwnLyrics = {
  kind: 'synced',
  source: 'autosync',
  lines: [
    { timeSec: 10, text: 'A', words: [{ text: 'A', start: 10, end: 14 }] },
    { timeSec: 20, text: 'B', words: [{ text: 'B', start: 20, end: 24 }] }
  ]
}
const plainAB: OwnLyrics = { kind: 'plain', source: 'lrclib', lines: ['A', 'B'] }

/** Its words spell it out and sit inside it, in order. */
function expectWordsOn(line: ShownLine): void {
  expect(line.words.map((word) => word.text).join('')).toBe(line.text)
  let notBefore = line.start
  for (const word of line.words) {
    expect(word.start).toBeGreaterThanOrEqual(notBefore)
    expect(word.end).toBeGreaterThanOrEqual(word.start)
    expect(word.end).toBeLessThanOrEqual(line.end)
    notBefore = word.start
  }
}

describe('pastedLines cleans a paste and refuses what’s too much', () => {
  it('splits on any line break, trims each line and drops blanks', () => {
    // The inner full-width space is the lyric's own; the ones round the line are the site's.
    expect(pastedLines('夜空に浮かぶ　小さな灯り\r\n\r\n　ひとつずつ 繋いでいこう \n')).toEqual({
      lines: ['夜空に浮かぶ　小さな灯り', 'ひとつずつ 繋いでいこう'],
      problem: null
    })
    expect(pastedLines('one\rtwo\nthree\r\nfour')).toEqual({
      lines: ['one', 'two', 'three', 'four'],
      problem: null
    })
  })

  it('refuses more than 40 lines, whole: blanks don’t count', () => {
    const forty = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`)
    expect(pastedLines(forty.join('\n'))).toEqual({ lines: forty, problem: null })
    expect(pastedLines([...forty, '', '   '].join('\n'))).toEqual({ lines: forty, problem: null })
    expect(pastedLines([...forty, 'line 41'].join('\n'))).toEqual({
      lines: [],
      problem: 'Up to 40 lines at a time.'
    })
  })

  it('refuses a line over 200 characters, counted whole and after trimming', () => {
    expect(pastedLines(`ok\n${'a'.repeat(201)}`)).toEqual({
      lines: [],
      problem: 'A line can be at most 200 characters.'
    })
    expect(pastedLines('a'.repeat(200)).problem).toBeNull()
    expect(pastedLines(`  ${'a'.repeat(200)}  `).problem).toBeNull()
    // 400 UTF-16 units, but 200 characters.
    expect(pastedLines('🎵'.repeat(200)).problem).toBeNull()
  })

  it('is nothing for an empty paste', () => {
    expect(pastedLines('')).toEqual({ lines: [], problem: null })
    expect(pastedLines('\r\n \n　')).toEqual({ lines: [], problem: null })
  })
})

describe('addPlace', () => {
  const song = coding([
    coded('one', 10, 14, timed),
    coded('two', 20, 24, timed),
    coded('three', 30, 34, timed)
  ])
  const plain = coding([
    coded('one', 10, 14, guessed),
    coded('two', 20, 24, guessed),
    coded('three', 30, 34, guessed)
  ])

  it('goes just before the first line that starts after the press', () => {
    expect(addPlace(song, null, 25, 0, null)).toEqual({ index: 2, byTime: true })
  })

  it('goes first before the first line, last after the last', () => {
    expect(addPlace(song, null, 5, 0, null)).toEqual({ index: 0, byTime: true })
    expect(addPlace(song, null, 40, 0, null)).toEqual({ index: 3, byTime: true })
  })

  it('goes after the second voices of the line before', () => {
    const voiced = coding([
      coded('one', 10, 14, timed),
      coded('(echo)', 12, 14, { under: 0 }),
      coded('two', 20, 24, timed)
    ])
    expect(addPlace(voiced, null, 16, 0, null)).toEqual({ index: 2, byTime: true })
  })

  it('counts the press on the screen’s clock: plus the fix', () => {
    expect(addPlace(song, null, 19.8, 0, null)).toEqual({ index: 1, byTime: true })
    expect(addPlace(song, null, 19.8, 0.5, null)).toEqual({ index: 2, byTime: true })
  })

  it('goes after the selected line, and its voices, when the lines are guesses', () => {
    expect(addPlace(plain, null, 25, 0, 1)).toEqual({ index: 2, byTime: false })
    const voiced = coding([
      coded('one', 10, 14, guessed),
      coded('two', 20, 24, guessed),
      coded('(echo)', 22, 24, { under: 1 }),
      coded('three', 30, 34, guessed)
    ])
    expect(addPlace(voiced, null, 25, 0, 1)).toEqual({ index: 3, byTime: false })
    // A second voice selected: after its main line's block.
    expect(addPlace(voiced, null, 25, 0, 2)).toEqual({ index: 3, byTime: false })
  })

  it('goes after the selected line when a neighbour of the press is a guess', () => {
    const mixed = coding([
      coded('one', 10, 14, timed),
      coded('two', 20, 24, guessed),
      coded('three', 30, 34, timed)
    ])
    expect(addPlace(mixed, null, 25, 0, 0)).toEqual({ index: 1, byTime: false })
    expect(addPlace(mixed, null, 15, 0, 2)).toEqual({ index: 3, byTime: false })
    // Past the last line, which is a guess.
    const lastGuessed = coding([coded('one', 10, 14, timed), coded('two', 20, 24, guessed)])
    expect(addPlace(lastGuessed, null, 40, 0, 0)).toEqual({ index: 1, byTime: false })
  })

  it('counts an added line at its own span in synced lyrics, guessed or not', () => {
    // A and B untimed with stale coded times: the shown ones are real.
    const colors = coding([coded('A', 9, 13), coded('B', 19, 23), coded('X', 40, 43, added)])
    expect(addPlace(colors, syncedAB, 30, 0, null)).toEqual({ index: 2, byTime: true })
    expect(addPlace(colors, syncedAB, 45, 0, null)).toEqual({ index: 3, byTime: true })
  })

  it('doesn’t count a guessed added line in plain lyrics, or with none', () => {
    const colors = coding([
      coded('A', 10, 14, timed),
      coded('B', 20, 24, timed),
      coded('X', 40, 43, added)
    ])
    for (const own of [plainAB, null]) {
      expect(addPlace(colors, own, 45, 0, null)).toBeNull()
      expect(addPlace(colors, own, 45, 0, 2)).toEqual({ index: 3, byTime: false })
    }
  })

  it('is nothing when it isn’t by time and nothing is selected', () => {
    expect(addPlace(plain, null, 25, 0, null)).toBeNull()
    expect(addPlace(plain, null, 25, 0, 7)).toBeNull()
  })

  it('places by the press when the lyrics are now synced by auto-sync (R14)', () => {
    // Begun from plain lyrics, every line a guess; auto-sync has timed the lyrics since.
    const begun = coding([
      coded('L0', 10, 15, guessed),
      coded('L1', 50, 55, guessed),
      coded('L2', 90, 95, guessed)
    ])
    const synced: OwnLyrics = {
      kind: 'synced',
      source: 'autosync',
      lines: [
        { timeSec: 11, text: 'L0' },
        { timeSec: 21, text: 'L1' },
        { timeSec: 31, text: 'L2' }
      ]
    }
    expect(addPlace(begun, synced, 25, 0, null)).toEqual({ index: 2, byTime: true })
    const plainOwn: OwnLyrics = { kind: 'plain', source: 'lrclib', lines: ['L0', 'L1', 'L2'] }
    expect(addPlace(begun, plainOwn, 25, 0, 1)).toEqual({ index: 2, byTime: false })
  })
})

describe('addedShownLines', () => {
  const texts = ['Hold on', '夜空に浮かぶ　小さな灯り', 'Stay with me']
  const chars = texts.map((text) => Array.from(text).length)
  const total = chars.reduce((sum, n) => sum + n, 0)

  it('starts at the press and shares out the time to the next line by length', () => {
    const song = coding([coded('before', 70, 80, timed), coded('next', 112.3, 116, timed)])
    const lines = addedShownLines(song, null, 1, texts, 84, 0, 200)
    expect(lines.map((line) => line.text)).toEqual(texts)
    expect(lines[0]?.start).toBe(84)
    expect(lines.at(-1)?.end).toBe(112.3)
    const per = (112.3 - 84) / total
    let at = 84
    lines.forEach((line, i) => {
      expect(line.start).toBeCloseTo(at, 9)
      at += (chars[i] ?? 0) * per
      expect(line.end).toBeCloseTo(at, 9)
      expect(line.guessed).toBe(true)
      expect(line).not.toHaveProperty('timed')
      expectWordsOn(line)
    })
    // The Japanese line is split into its words, not left whole.
    expect(lines[1]?.words.length).toBeGreaterThan(2)
  })

  it('runs ADD_SPAN_SEC with no line after', () => {
    const song = coding([coded('before', 70, 80, timed)])
    expect(addedShownLines(song, null, 1, texts, 84, 0, 200).at(-1)?.end).toBe(84 + ADD_SPAN_SEC)
    expect(ADD_SPAN_SEC).toBe(30)
  })

  it('runs ADD_SPAN_SEC when the next line leaves under a second a line', () => {
    const near = coding([coded('next', 86, 90, timed)])
    expect(addedShownLines(near, null, 0, texts, 84, 0, 200).at(-1)?.end).toBe(114)
    const enough = coding([coded('next', 87, 90, timed)])
    expect(addedShownLines(enough, null, 0, texts, 84, 0, 200).at(-1)?.end).toBe(87)
  })

  it('runs ADD_SPAN_SEC when the next line’s time is a guess', () => {
    const song = coding([coded('next', 100, 104, guessed)])
    expect(addedShownLines(song, null, 0, texts, 84, 0, 200).at(-1)?.end).toBe(114)
  })

  it('is cut at the song’s end, on the screen’s clock', () => {
    const song = coding([coded('before', 70, 80, timed)])
    expect(addedShownLines(song, null, 1, texts, 84, 0, 100).at(-1)?.end).toBe(100)
    expect(addedShownLines(song, null, 1, texts, 84, 0.5, 100).at(-1)?.end).toBe(100.5)
    // Pressed at the very end: the lines are there, with no room.
    const atEnd = addedShownLines(song, null, 1, ['last'], 100, 0, 100)
    expect(atEnd[0]).toMatchObject({ start: 100, end: 100 })
    expectWordsOn(atEnd[0] as ShownLine)
  })

  it('never starts before the song does', () => {
    const song = coding([coded('next', 20, 24, timed)])
    expect(addedShownLines(song, null, 0, ['first'], 0.2, -0.5, 200)[0]?.start).toBe(0)
  })

  it('the next line’s real start can be the lyrics’ own (R14)', () => {
    const song = coding([coded('before', 60, 70, guessed), coded('next', 130, 135, guessed)])
    const own: OwnLyrics = {
      kind: 'synced',
      source: 'autosync',
      lines: [
        { timeSec: 60, text: 'before' },
        { timeSec: 112.3, text: 'next' }
      ]
    }
    expect(addedShownLines(song, own, 1, texts, 84, 0, 200).at(-1)?.end).toBe(112.3)
  })

  it('stops at a guessed added line’s own start in synced lyrics', () => {
    const colors = coding([coded('A', 9, 13), coded('B', 19, 23), coded('X', 40, 43, added)])
    const lines = addedShownLines(colors, syncedAB, 2, ['one more', 'and again'], 30, 0, 200)
    expect(lines.at(-1)?.end).toBe(40)
  })

  it('is nothing for no texts', () => {
    expect(addedShownLines(coding([]), null, 0, [], 84, 0, 200)).toEqual([])
  })
})

describe('an added line lights at the press under a timing fix (R15)', () => {
  const own: OwnLyrics = {
    kind: 'synced',
    source: 'autosync',
    lines: [
      { timeSec: 10, text: 'A', words: [{ text: 'A', start: 10, end: 14 }] },
      { timeSec: 30, text: 'C', words: [{ text: 'C', start: 30, end: 34 }] }
    ]
  }
  // Begun from auto-sync's lyrics: neither timed nor guessed.
  const colors = coding([coded('A', 10, 14), coded('C', 30, 34)])

  it('is stored at the press plus the fix, and the Focus Screen lights it at the press', () => {
    expect(addPlace(colors, own, 20, 0.5, null)).toEqual({ index: 1, byTime: true })
    const lines = addedShownLines(colors, own, 1, ['X x'], 20, 0.5, 200)
    expect(lines[0]?.start).toBe(20.5)
    expect(lines.at(-1)?.end).toBe(30)

    const colored = colorLyrics(own, applyEdit(colors, { kind: 'addLines', at: 1, lines }))
    expect(colored?.lyrics.kind).toBe('synced')
    const rows = colored?.lyrics.kind === 'synced' ? colored.lyrics.lines : []
    // The screen lights syncedLineIndex(lines, position + offsetSec).
    expect(rows[syncedLineIndex(rows, 20 + 0.5)]?.text).toBe('X x')
    expect(syncedLineIndex(rows, 20 + 0.5)).toBe(1)
    expect(syncedLineIndex(rows, 19.9 + 0.5)).toBe(0)
  })

  it('is stored at the press itself with no fix', () => {
    expect(addedShownLines(colors, own, 1, ['X x'], 20, 0, 200)[0]?.start).toBe(20)
  })
})

describe('movedTimes (R13)', () => {
  const own: OwnLyrics = {
    kind: 'synced',
    source: 'autosync',
    lines: [
      { timeSec: 10, text: 'A', words: [{ text: 'A', start: 10, end: 14 }] },
      { timeSec: 20, text: 'B', words: [{ text: 'B', start: 20, end: 24 }] }
    ]
  }
  // A and B are untimed, their coded times stale; the shown ones are real.
  const a = coded('A', 9, 13)
  const b = coded('B', 19, 23)

  it('starts just after the new line before ends, its length kept', () => {
    const colors = coding([a, b, coded('X', 40, 43, added)])
    const moved = movedTimes(colors, own, 2, -1, 200)
    expect(moved?.start).toBeCloseTo(14.1, 9)
    expect(moved?.end).toBeCloseTo(17.1, 9)
  })

  it('ends at the next line’s start when its length doesn’t fit', () => {
    const colors = coding([a, b, coded('X', 40, 48, added)])
    const moved = movedTimes(colors, own, 2, -1, 200)
    expect(moved?.start).toBeCloseTo(14.1, 9)
    expect(moved?.end).toBe(20)
  })

  it('keeps its length in a gap under a second', () => {
    const tight: OwnLyrics = {
      kind: 'synced',
      source: 'autosync',
      lines: [
        { timeSec: 10, text: 'A', words: [{ text: 'A', start: 10, end: 14 }] },
        { timeSec: 14.5, text: 'B' }
      ]
    }
    const colors = coding([a, b, coded('X', 40, 43, added)])
    const moved = movedTimes(colors, tight, 2, -1, 200)
    expect(moved?.start).toBeCloseTo(14.1, 9)
    expect(moved?.end).toBeCloseTo(17.1, 9)
  })

  it('goes just before the first line when moved to the top', () => {
    const colors = coding([a, coded('X', 40, 43, added)])
    const moved = movedTimes(colors, own, 1, -1, 200)
    expect(moved?.start).toBeCloseTo(6.9, 9)
    expect(moved?.end).toBeCloseTo(9.9, 9)
  })

  it('moves down past the line after, to the song’s end with nothing after', () => {
    const colors = coding([a, coded('X', 40, 43, added), b])
    const moved = movedTimes(colors, own, 1, 1, 200)
    expect(moved?.start).toBeCloseTo(24.1, 9)
    expect(moved?.end).toBeCloseTo(27.1, 9)
    // Long enough to reach the end: it ends there.
    const long = coding([a, coded('X', 40, 300, added), b])
    expect(movedTimes(long, own, 1, 1, 200)?.end).toBe(200)
  })

  it('takes an added neighbour’s own span, and skips lines that don’t show', () => {
    const colors = coding([a, coded('Y', 30, 33, added), coded('X', 40, 60, added)])
    const moved = movedTimes(colors, own, 2, -1, 200)
    expect(moved?.start).toBeCloseTo(14.1, 9)
    expect(moved?.end).toBe(30)
    // 'gone' isn't in the lyrics and was never timed: nothing to place by.
    const gone = coding([a, coded('gone', 30, 33), coded('X', 40, 43, added)])
    const past = movedTimes(gone, own, 2, -1, 200)
    expect(past?.start).toBeCloseTo(14.1, 9)
    expect(past?.end).toBeCloseTo(17.1, 9)
  })

  it('moves a line with its voices past a neighbour’s voices', () => {
    const colors = coding([
      a,
      b,
      coded('(b)', 21, 23, { under: 1 }),
      coded('X', 40, 43, added),
      coded('(x)', 41, 42, { under: 3 })
    ])
    const moved = movedTimes(colors, own, 3, -1, 200)
    expect(moved?.start).toBeCloseTo(14.1, 9)
    expect(moved?.end).toBeCloseTo(17.1, 9)
  })

  it('is nothing for plain lyrics, no lyrics, a lyrics’ own line, or no room to move', () => {
    const colors = coding([a, b, coded('X', 40, 43, added)])
    const plainOwn: OwnLyrics = { kind: 'plain', source: 'lrclib', lines: ['A', 'B'] }
    expect(movedTimes(colors, plainOwn, 2, -1, 200)).toBeNull()
    expect(movedTimes(colors, null, 2, -1, 200)).toBeNull()
    expect(movedTimes(colors, own, 0, 1, 200)).toBeNull()
    expect(movedTimes(colors, own, 2, 1, 200)).toBeNull()
    const top = coding([coded('X', 40, 43, added), a])
    expect(movedTimes(top, own, 0, -1, 200)).toBeNull()
  })

  it('gives times main takes', () => {
    const colors = coding([a, b, coded('X', 40, 43, added)])
    const moved = movedTimes(colors, own, 2, -1, 200)
    const next = applyEdit(colors, { kind: 'moveLine', line: 2, delta: -1, ...moved })
    expect(next.lines.map((line) => line.text)).toEqual(['A', 'X', 'B'])
    expect(next.lines[1]?.start).toBeCloseTo(14.1, 9)
  })
})

describe('retypedLine', () => {
  const line = coded('old words', 40, 43, added)

  it('keeps the line’s start and end, and its words spell the new text inside them', () => {
    for (const text of ['brand new words here', '夜空に浮かぶ　小さな灯り']) {
      const shown = retypedLine(line, text)
      expect(shown).toMatchObject({ text, start: 40, end: 43 })
      expectWordsOn(shown)
    }
  })

  it('drops the spaces round the text, as a paste does', () => {
    expect(retypedLine(line, '  new words　').text).toBe('new words')
  })

  it('is a retype main takes', () => {
    const colors = coding([coded('A', 10, 14, timed), line])
    const next = applyEdit(colors, {
      kind: 'retype',
      line: 1,
      shown: retypedLine(line, 'brand new words')
    })
    expect(next.lines[1]).toMatchObject({ text: 'brand new words', start: 40, end: 43 })
  })
})

describe('movedPlace: the selection follows a moved line', () => {
  const lines = [
    coded('A', 10, 14, timed),
    coded('(a)', 11, 13, { under: 0 }),
    coded('X', 40, 43, added),
    coded('(x)', 41, 42, { under: 2 }),
    coded('B', 50, 54, timed),
    coded('(b1)', 51, 52, { under: 4 }),
    coded('(b2)', 52, 53, { under: 4 })
  ]
  const colors = coding(lines)

  it('lands where main puts the line, past a neighbour and its voices either way', () => {
    for (const delta of [-1, 1] as const) {
      const place = movedPlace(colors, 2, delta)
      const next = applyEdit(colors, { kind: 'moveLine', line: 2, delta })
      expect(next).not.toBe(colors)
      expect(place).not.toBeNull()
      expect(next.lines[place ?? -1]?.text).toBe('X')
    }
    expect(movedPlace(colors, 2, -1)).toBe(0)
    expect(movedPlace(colors, 2, 1)).toBe(5)
  })

  it('is nothing at the ends, for the lyrics’ own lines and for second voices', () => {
    const top = coding([coded('X', 4, 6, added), coded('A', 10, 14, timed)])
    expect(movedPlace(top, 0, -1)).toBeNull()
    expect(movedPlace(top, 0, 1)).toBe(1)
    const bottom = coding([coded('A', 10, 14, timed), coded('X', 40, 43, added)])
    expect(movedPlace(bottom, 1, 1)).toBeNull()
    expect(movedPlace(colors, 0, 1)).toBeNull()
    expect(movedPlace(colors, 3, -1)).toBeNull()
    expect(movedPlace(colors, 99, -1)).toBeNull()
  })
})

describe('numberBefore: “after line N”', () => {
  const colors = coding([
    coded('A', 10, 14, timed),
    coded('(a)', 11, 13, { under: 0 }),
    coded('B', 20, 24, timed)
  ])

  it('is the number of the line whose block ends just before the place', () => {
    expect(numberBefore(colors, 2)).toBe(1)
    // Inside a block, it's still that block's line.
    expect(numberBefore(colors, 1)).toBe(1)
    expect(numberBefore(colors, 3)).toBe(2)
  })

  it('is nothing at the very top', () => {
    expect(numberBefore(colors, 0)).toBeNull()
  })
})

describe('retypeCheck', () => {
  it('takes a line trimmed', () => {
    expect(retypeCheck('  new words　')).toEqual({ text: 'new words', problem: null })
  })

  it('refuses a blank line quietly', () => {
    expect(retypeCheck(' 　 ')).toEqual({ text: null, problem: null })
  })

  it('refuses a line over 200 characters, counted whole, and says why', () => {
    expect(retypeCheck('あ'.repeat(200))).toEqual({ text: 'あ'.repeat(200), problem: null })
    expect(retypeCheck('😀'.repeat(201))).toEqual({
      text: null,
      problem: 'A line can be at most 200 characters.'
    })
  })
})

describe('the paste box’s place, worked out again as the coding changes', () => {
  const lines = [
    coded('A', 10, 14, guessed),
    coded('B', 20, 24, guessed),
    coded('(b)', 21, 23, { ...guessed, under: 1 }),
    coded('C', 30, 34, guessed)
  ]
  const colors = coding(lines)
  /** Lines put in above, as main's addLines puts them: second voices re-pointed. */
  const withAbove = (above: CodedLine[], below: CodedLine[] = lines): SongColors =>
    coding([
      ...above,
      ...below.map((line) =>
        line.under === undefined ? line : { ...line, under: line.under + above.length }
      )
    ])

  it('keeps the selected line’s main line, by its text and place', () => {
    expect(keptLine(colors, 1)).toEqual({ index: 1, text: 'B' })
    expect(keptLine(colors, 2)).toEqual({ index: 1, text: 'B' })
    expect(keptLine(colors, null)).toBeNull()
    expect(keptLine(colors, 9)).toBeNull()
  })

  it('finds the kept line where it is now, the nearest of its twins, or not at all', () => {
    const kept = { index: 1, text: 'B' }
    expect(findKept(colors, kept)).toBe(1)
    // Lines added above it push it down.
    const pushed = withAbove([coded('X', 5, 6, added), coded('Y', 6, 7, added)])
    expect(findKept(pushed, kept)).toBe(3)
    // Of two lines with its words, the one nearest where it was.
    const twins = withAbove([coded('B', 1, 2, guessed)], [...lines, coded('B', 40, 44, guessed)])
    expect(findKept(twins, kept)).toBe(2)
    // A second voice with its words isn't it.
    expect(findKept(coding([coded('A', 10, 14), coded('B', 11, 12, { under: 0 })]), kept)).toBe(
      null
    )
    expect(findKept(coding([lines[0] as CodedLine, lines[3] as CodedLine]), kept)).toBeNull()
    expect(findKept(colors, null)).toBeNull()
  })

  it('goes after the kept line where it is now', () => {
    const press = { pressSec: 25, fixSec: 0, kept: { index: 1, text: 'B' } }
    expect(placeNow(colors, null, press)).toEqual({ index: 3, byTime: false })
    const pushed = withAbove([coded('X', 5, 6, added)])
    expect(placeNow(pushed, null, press)).toEqual({ index: 4, byTime: false })
    // Gone, and nothing to place them by time: they can't be added.
    expect(placeNow(coding([lines[0] as CodedLine, lines[3] as CodedLine]), null, press)).toBeNull()
  })

  it('goes by the press on the coding as it is now', () => {
    const song = coding([coded('A', 10, 14, timed), coded('C', 30, 34, timed)])
    const press = { pressSec: 24.5, fixSec: 0.5, kept: null }
    expect(placeNow(song, null, press)).toEqual({ index: 1, byTime: true })
    // A line timed meanwhile, before the press, puts them after it.
    const timedMeanwhile = coding([
      coded('A', 10, 14, timed),
      coded('B', 20, 24, timed),
      coded('C', 30, 34, timed)
    ])
    expect(placeNow(timedMeanwhile, null, press)).toEqual({ index: 2, byTime: true })
  })
})

describe('breakToAdd', () => {
  const song = coding([coded('A', 10, 14, timed), coded('B', 20, 24, timed)])

  it('starts a break at the press, running to the next line’s start, in its place by time', () => {
    expect(breakToAdd(song, syncedAB, 15, 0, 200)).toEqual({ at: 1, start: 15, end: 20 })
  })

  it('counts the press on the screen’s clock (the timing fix added)', () => {
    expect(breakToAdd(song, syncedAB, 14, 1, 200)).toEqual({ at: 1, start: 15, end: 20 })
  })

  it('runs to the song’s end after the last line', () => {
    expect(breakToAdd(song, syncedAB, 30, 0, 200)).toEqual({ at: 2, start: 30, end: 200 })
  })

  it('isn’t offered in untimed lyrics, without the lyrics, or at the very end', () => {
    expect(breakToAdd(song, plainAB, 15, 0, 200)).toBeNull()
    expect(breakToAdd(song, null, 15, 0, 200)).toBeNull()
    expect(breakToAdd(song, syncedAB, 200, 0, 200)).toBeNull()
  })
})
