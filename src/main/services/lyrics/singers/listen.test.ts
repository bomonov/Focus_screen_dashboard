import { describe, expect, it } from 'vitest'
import {
  coveredShare,
  heardEdit,
  isHeard,
  listenLines,
  listenStretch,
  realSpans,
  type OwnLyrics
} from './listen'
import type { CodedLine, SongColors } from './types'

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

describe('realSpans', () => {
  it('a timed line has its own span', () => {
    const colors = coding([coded('A', 10, 14, timed), coded('X', 20, 24, added)])
    expect(realSpans(colors, null)).toEqual([{ start: 10, end: 14 }, null])
  })

  it('a line matched to synced lyrics has the shown row’s span (R14)', () => {
    // Begun from plain lyrics, every line a guess; auto-sync has timed the lyrics since.
    const colors = coding([coded('L0', 10, 15, guessed), coded('L1', 50, 55, guessed)])
    const own: OwnLyrics = {
      kind: 'synced',
      source: 'autosync',
      lines: [
        { timeSec: 11, text: 'L0', words: [{ text: 'L0', start: 11, end: 13.5 }] },
        { timeSec: 21, text: 'L1' }
      ]
    }
    // L1's row has no words: its start plus the coded line's length (5).
    expect(realSpans(colors, own)).toEqual([
      { start: 11, end: 13.5 },
      { start: 21, end: 26 }
    ])
  })

  it('plain own lyrics give nothing real', () => {
    const colors = coding([coded('L0', 10, 15, guessed), coded('L1', 50, 55, guessed)])
    const own: OwnLyrics = { kind: 'plain', source: 'lrclib', lines: ['L0', 'L1'] }
    expect(realSpans(colors, own)).toEqual([null, null])
  })

  it('a second voice has none, timed or not', () => {
    const colors = coding([coded('A', 10, 14, timed), coded('oh', 11, 12, { ...timed, under: 0 })])
    expect(realSpans(colors, null)).toEqual([{ start: 10, end: 14 }, null])
  })
})

describe('listenLines', () => {
  it('leaves out second voices and empty lines', () => {
    const colors = coding([
      coded('A', 10, 14),
      coded('oh', 11, 12, { under: 0 }),
      // All of it made a second voice: no words left of its own.
      { ...coded('B', 20, 24), words: [] },
      coded('C', 30, 34)
    ])
    expect(listenLines(colors, 0, 4)).toEqual([0, 3])
    expect(listenLines(colors, 1, 3)).toEqual([])
    expect(listenLines(colors, 2, 99)).toEqual([3])
  })
})

describe('listenStretch', () => {
  /** A timed A, then added lines at `starts`, then C at `next` (`mark` says how C is timed). */
  function song(starts: number[], next: number, mark: Partial<CodedLine> = timed): SongColors {
    return coding([
      coded('A', 70, 80, timed),
      ...starts.map((start, i) => coded(`X${i}`, start, start + 5, added)),
      coded('C', next, next + 5, mark)
    ])
  }

  it('ends where the next real line starts', () => {
    expect(listenStretch(song([84, 93], 112.3), [1, 2], 200, null, 0)).toEqual({
      from: 84,
      to: 112.3
    })
  })

  it('without a real next line it ends 8 s a line on', () => {
    expect(listenStretch(song([50, 55], 112.3, guessed), [1, 2], 200, null, 0)).toEqual({
      from: 50,
      to: 66
    })
  })

  it('but never more than 60 s', () => {
    const starts = Array.from({ length: 10 }, (_, i) => 20 + i * 2)
    const lines = starts.map((_, i) => i + 1)
    expect(listenStretch(song(starts, 150, guessed), lines, 200, null, 0)).toEqual({
      from: 20,
      to: 80
    })
  })

  it('a real next line before the first start counts as none', () => {
    expect(listenStretch(song([84, 93], 80), [1, 2], 200, null, 0)).toEqual({
      from: 84,
      to: 100
    })
  })

  it('is cut at the song’s end', () => {
    expect(listenStretch(song([190, 195], 199, guessed), [1, 2], 200, null, 0)).toEqual({
      from: 190,
      to: 200
    })
  })

  it('never ends before the last selected line’s real end', () => {
    // Two selected lines with a 20 s instrumental between them, and no real line after:
    // 8 s a line would stop at 26 and force the second line into the wrong audio.
    const colors = coding([coded('A', 10, 14, timed), coded('B', 30, 34, timed)])
    const stretch = listenStretch(colors, [0, 1], 200, null, 0)
    expect(stretch?.from).toBe(10)
    expect(stretch?.to).toBeGreaterThanOrEqual(34)
    expect(stretch).toEqual({ from: 10, to: 34 })
    // The same before a guessed line, and still cut at the song's end.
    const before = coding([...colors.lines, coded('C', 50, 54, guessed)])
    expect(listenStretch(before, [0, 1], 200, null, 0)).toEqual({ from: 10, to: 34 })
    expect(listenStretch(colors, [0, 1], 32, null, 0)).toEqual({ from: 10, to: 32 })
  })

  it('is null for no lines, or no room', () => {
    expect(listenStretch(song([84, 93], 112.3), [], 200, null, 0)).toBeNull()
    expect(listenStretch(song([210, 215], 230, guessed), [1, 2], 200, null, 0)).toBeNull()
  })

  it('starts at the first line’s real start, else its own start, even a guess (R10)', () => {
    const colors = coding([coded('A', 60, 65, guessed), coded('B', 90, 95, guessed)])
    expect(listenStretch(colors, [0], 200, null, 0)).toEqual({ from: 60, to: 68 })
    const own: OwnLyrics = {
      kind: 'synced',
      source: 'lrclib',
      lines: [
        { timeSec: 70, text: 'A' },
        { timeSec: 75, text: 'B' }
      ]
    }
    expect(listenStretch(colors, [0], 200, own, 0)).toEqual({ from: 70, to: 75 })
  })

  it('the next line’s real start can be the lyrics’ own (R14)', () => {
    const colors = coding([
      coded('A', 60, 65, guessed),
      coded('X0', 84, 89, added),
      coded('X1', 93, 98, added),
      coded('C', 130, 134, guessed)
    ])
    const own: OwnLyrics = {
      kind: 'synced',
      source: 'autosync',
      lines: [
        { timeSec: 70, text: 'A' },
        { timeSec: 112.3, text: 'C' }
      ]
    }
    expect(listenStretch(colors, [1, 2], 200, own, 0)).toEqual({ from: 84, to: 112.3 })
  })

  it('is in song time under a timing fix (R15)', () => {
    // Pressed at 84 under a 0.5 s fix, so stored at 84.5: the screen lights it at the press.
    expect(listenStretch(song([84.5, 93.5], 112.8), [1, 2], 200, null, 0.5)).toEqual({
      from: 84,
      to: 112.3
    })
    // 84.5 + 16 − 0.5.
    expect(listenStretch(song([84.5, 93.5], 150, guessed), [1, 2], 200, null, 0.5)).toEqual({
      from: 84,
      to: 100
    })
  })
})

describe('what was heard', () => {
  it('coveredShare', () => {
    expect(coveredShare([[0, 10]], 5, 15)).toBe(0.5)
    // Overlapping stretches count once.
    expect(
      coveredShare(
        [
          [0, 10],
          [5, 12]
        ],
        0,
        20
      )
    ).toBeCloseTo(0.6, 10)
    expect(coveredShare([], 0, 10)).toBe(0)
    expect(coveredShare([[0, 10]], 5, 5)).toBe(0)
  })

  it('isHeard at 0.95', () => {
    expect(isHeard([[0, 9.5]], { from: 0, to: 10 })).toBe(true)
    expect(isHeard([[0, 9.4]], { from: 0, to: 10 })).toBe(false)
    expect(
      isHeard(
        [
          [0, 5],
          [5.5, 10]
        ],
        { from: 0, to: 10 }
      )
    ).toBe(true)
  })
})

describe('heardEdit', () => {
  const always = (): boolean => true

  it('puts words on the answer’s words by their letters', () => {
    // The user split "hello" into "hel" + "lo ": each piece takes its letters' share.
    const line: CodedLine = {
      ...coded('hello world', 20, 24, added),
      words: [
        { text: 'hel', start: 20, end: 21, singers: ['miku'] },
        { text: 'lo ', start: 21, end: 22, singers: null },
        { text: 'world', start: 22, end: 24, singers: null }
      ]
    }
    const colors = coding([coded('A', 10, 14, timed), line])
    const edit = heardEdit(
      colors,
      [{ index: 1, text: 'hello world' }],
      [
        {
          start: 30,
          end: 32,
          words: [
            { text: 'hello', start: 30, end: 30.8 },
            { text: ' world', start: 31, end: 32 }
          ]
        }
      ],
      always
    )
    expect(edit?.kind).toBe('heardTimes')
    expect(edit?.lines).toHaveLength(1)
    const [one] = edit?.lines ?? []
    expect(one?.line).toBe(1)
    expect(one?.start).toBe(30)
    expect(one?.end).toBe(32)
    const words = one?.words ?? []
    expect(words).toHaveLength(3)
    expect(words[0]?.start).toBeCloseTo(30, 10)
    expect(words[0]?.end).toBeCloseTo(30.48, 10)
    expect(words[1]?.start).toBeCloseTo(30.48, 10)
    expect(words[1]?.end).toBeCloseTo(30.8, 10)
    expect(words[2]?.start).toBeCloseTo(31, 10)
    expect(words[2]?.end).toBeCloseTo(32, 10)
  })

  it('scales a line’s own words into the span when the answer’s words don’t spell it', () => {
    const line: CodedLine = {
      text: '灯り(あかり)',
      start: 20,
      end: 24,
      words: [
        { text: '灯り', start: 20, end: 21, singers: null },
        { text: '(あかり)', start: 21, end: 24, singers: null }
      ],
      ...added
    }
    const colors = coding([line])
    const asked = [{ index: 0, text: '灯り(あかり)' }]
    const edit = heardEdit(
      colors,
      asked,
      [{ start: 40, end: 42, words: [{ text: '灯り', start: 40, end: 42 }] }],
      always
    )
    // Each keeps its share: a quarter, then three quarters.
    expect(edit?.lines).toEqual([
      {
        line: 0,
        start: 40,
        end: 42,
        words: [
          { start: 40, end: 40.5 },
          { start: 40.5, end: 42 }
        ]
      }
    ])
    // An answer with no words of its own is scaled the same way.
    expect(heardEdit(colors, asked, [{ start: 40, end: 42 }], always)?.lines).toEqual(edit?.lines)
  })

  it('leaves out lines that changed since they were asked about, unplaced ones, and ones still() turns down', () => {
    const colors = coding([
      coded('a b', 10, 12, added),
      coded('changed', 20, 22, added),
      coded('c', 30, 32, added),
      coded('d', 40, 42, timed),
      coded('e', 50, 52, added)
    ])
    const answer = (start: number): { start: number; end: number } => ({ start, end: start + 1 })
    const edit = heardEdit(
      colors,
      [
        { index: 0, text: 'a b' },
        { index: 1, text: 'b' },
        { index: 2, text: 'c' },
        { index: 3, text: 'd' },
        { index: 4, text: 'e' },
        { index: 9, text: 'f' }
      ],
      [answer(11), answer(21), null, answer(41), { start: 52, end: 51 }, answer(60)],
      (line) => !line.timed
    )
    expect(edit?.lines.map((one) => one.line)).toEqual([0])
    expect(edit?.lines[0]?.words).toEqual([
      { start: 11, end: 11.5 },
      { start: 11.5, end: 12 }
    ])
  })

  it('is null when nothing is left', () => {
    const colors = coding([coded('a', 10, 12, added)])
    expect(heardEdit(colors, [{ index: 0, text: 'a' }], [null], always)).toBeNull()
    expect(heardEdit(colors, [{ index: 0, text: 'b' }], [{ start: 1, end: 2 }], always)).toBeNull()
    expect(heardEdit(colors, [], [], always)).toBeNull()
  })
})
