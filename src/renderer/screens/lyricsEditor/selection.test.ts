import { describe, expect, it } from 'vitest'
import type { CodedLine, SongColors } from '../../../main/ipc'
import {
  afterLineTap,
  afterTap,
  extendRun,
  fitSelection,
  fitTap,
  lineRun,
  lineTapTarget,
  nextTap,
  pickSinger,
  selectedRange,
  splitPoint,
  stepLine,
  tapStart,
  tapTarget,
  wholeLine
} from './selection'

function line(words: string[], under?: number): CodedLine {
  return {
    text: words.join(''),
    start: 0,
    end: 1,
    words: words.map((text) => ({ text, start: 0, end: 1, singers: null })),
    ...(under === undefined ? {} : { under })
  }
}

function colors(lines: CodedLine[]): SongColors {
  return { version: 1, lines, cast: [], extra: [] }
}

const song = colors([line([]), line(['a ', 'b ', 'c']), line(['(echo)'], 1), line(['d ', 'e'])])

describe('fitSelection', () => {
  it('starts on the first line with words, all of it', () => {
    expect(fitSelection(null, song)).toEqual({ line: 1, anchor: 0, focus: 2 })
  })

  it('keeps a selection that still fits', () => {
    const selection = { line: 3, anchor: 1, focus: 0 }
    expect(fitSelection(selection, song)).toEqual(selection)
  })

  it('pulls words back onto a line that lost some', () => {
    expect(fitSelection({ line: 3, anchor: 0, focus: 4 }, song)).toEqual({
      line: 3,
      anchor: 0,
      focus: 1
    })
  })

  it('moves onto the last line when its line went away (an undone second voice)', () => {
    expect(fitSelection({ line: 9, anchor: 0, focus: 0 }, song)).toEqual(wholeLine(song, 3))
  })

  it('is nothing without a coding or lines', () => {
    expect(fitSelection(null, null)).toBeNull()
    expect(fitSelection(null, colors([]))).toBeNull()
  })
})

describe('selectedRange', () => {
  it('runs from the lower word to past the higher one', () => {
    expect(selectedRange({ line: 1, anchor: 2, focus: 0 }, song)).toEqual({ from: 0, to: 3 })
  })

  it('is nothing on a line with no words', () => {
    expect(selectedRange({ line: 0, anchor: 0, focus: 0 }, song)).toBeNull()
  })
})

describe('stepLine', () => {
  it('moves a line at a time, second voices included, and stops at the ends', () => {
    expect(stepLine(song, 1, 1)).toEqual({ line: 2, anchor: 0, focus: 0 })
    expect(stepLine(song, 3, 1)).toEqual({ line: 3, anchor: 0, focus: 1 })
    expect(stepLine(song, 0, -1)).toEqual({ line: 0, anchor: 0, focus: 0 })
  })
})

describe('pickSinger', () => {
  const range = { from: 0, to: 2 }

  it('builds a duet in the order clicked while the same words stay selected', () => {
    const first = pickSinger(null, 1, range, 'ichika')
    const second = pickSinger(first, 1, range, 'miku')
    expect(second.singers).toEqual(['ichika', 'miku'])
  })

  it('takes a singer out on a second click', () => {
    const duet = { line: 1, from: 0, to: 2, singers: ['ichika', 'miku'] }
    expect(pickSinger(duet, 1, range, 'ichika').singers).toEqual(['miku'])
  })

  it('starts again on other words', () => {
    const duet = { line: 1, from: 0, to: 2, singers: ['ichika'] }
    expect(pickSinger(duet, 1, { from: 1, to: 2 }, 'miku').singers).toEqual(['miku'])
    expect(pickSinger(duet, 3, range, 'miku').singers).toEqual(['miku'])
  })
})

describe('tap timing', () => {
  it('starts at the first selected word', () => {
    expect(tapStart(song, { line: 1, anchor: 2, focus: 1 })).toEqual({ line: 1, word: 1 })
  })

  it('starts on the next line with words when the selected one has none', () => {
    expect(tapStart(song, { line: 0, anchor: 0, focus: 0 })).toEqual({ line: 1, word: 0 })
    expect(tapStart(song, null)).toBeNull()
  })

  it('goes word by word, then on to the next line, second voices included', () => {
    expect(nextTap(song, { line: 1, word: 0 })).toEqual({ line: 1, word: 1 })
    expect(nextTap(song, { line: 1, word: 2 })).toEqual({ line: 2, word: 0 })
    expect(nextTap(song, { line: 2, word: 0 })).toEqual({ line: 3, word: 0 })
  })

  it('stops after the last word', () => {
    expect(nextTap(song, { line: 3, word: 1 })).toBeNull()
  })

  it('marks nothing after the last word, until a line or word is picked again', () => {
    const selection = wholeLine(song, 3)
    const done = afterTap(song, { line: 3, word: 1 })
    // Not back to the selected line's first word, which J would then retime.
    expect(tapTarget(song, done, selection)).toBeNull()
    // Picking a line or word clears the cursor, and tapping starts from what's picked.
    expect(tapTarget(song, null, selection)).toEqual({ line: 3, word: 0 })
    expect(tapTarget(song, afterTap(song, { line: 1, word: 0 }), selection)).toEqual({
      line: 1,
      word: 1
    })
  })

  it('lets go of a word an edit took away', () => {
    expect(fitTap(song, { line: 3, word: 1 })).toEqual({ line: 3, word: 1 })
    expect(fitTap(song, { line: 3, word: 2 })).toBeNull()
    expect(fitTap(song, { line: 8, word: 0 })).toBeNull()
  })
})

describe('lineRun', () => {
  const voiced = colors([
    line(['a']),
    line(['(a)'], 0),
    line(['b']),
    line(['c']),
    line(['(c)'], 3),
    line(['(c2)'], 3),
    line(['d'])
  ])

  it('is the line’s own block with no other end, its voices included', () => {
    expect(lineRun(voiced, 0, null)).toEqual({ from: 0, to: 2 })
    expect(lineRun(voiced, 2, null)).toEqual({ from: 2, to: 3 })
    expect(lineRun(voiced, 4, null)).toEqual({ from: 3, to: 6 })
  })

  it('covers voices at both ends, either way round', () => {
    expect(lineRun(voiced, 0, 3)).toEqual({ from: 0, to: 6 })
    expect(lineRun(voiced, 3, 0)).toEqual({ from: 0, to: 6 })
    // From a second voice: its main line's block.
    expect(lineRun(voiced, 5, 1)).toEqual({ from: 0, to: 6 })
    expect(lineRun(voiced, 6, 4)).toEqual({ from: 3, to: 7 })
    expect(lineRun(voiced, 2, 2)).toEqual({ from: 2, to: 3 })
  })
})

describe('extendRun: ⇧↑/⇧↓ move the run’s other end', () => {
  const voiced = colors([
    line(['a']),
    line(['(a)'], 0),
    line(['b']),
    line(['c']),
    line(['(c)'], 3),
    line(['(c2)'], 3),
    line(['d'])
  ])

  it('starts from the focused line, one main line either way, past second voices', () => {
    expect(extendRun(voiced, 2, null, 1)).toBe(3)
    expect(extendRun(voiced, 2, null, -1)).toBe(0)
    expect(extendRun(voiced, 0, null, 1)).toBe(2)
    // From a second voice: from its main line.
    expect(extendRun(voiced, 4, null, 1)).toBe(6)
    expect(extendRun(voiced, 4, null, -1)).toBe(2)
  })

  it('moves an end already set, out or back in', () => {
    expect(extendRun(voiced, 2, 3, 1)).toBe(6)
    expect(extendRun(voiced, 2, 6, -1)).toBe(3)
    expect(extendRun(voiced, 2, 3, -1)).toBe(2)
    expect(extendRun(voiced, 0, 5, -1)).toBe(2)
    expect(lineRun(voiced, 2, extendRun(voiced, 2, 3, 1))).toEqual({ from: 2, to: 7 })
  })

  it('stays put at the song’s first and last lines', () => {
    expect(extendRun(voiced, 6, null, 1)).toBeNull()
    expect(extendRun(voiced, 0, null, -1)).toBeNull()
    expect(extendRun(voiced, 2, 6, 1)).toBe(6)
    expect(extendRun(voiced, 2, 1, -1)).toBe(1)
  })
})

describe('line taps', () => {
  it('lineTapTarget is word 0 of the cursor’s line, else of the selected line', () => {
    expect(lineTapTarget(song, { line: 3, word: 1 }, wholeLine(song, 1))).toEqual({
      line: 3,
      word: 0
    })
    expect(lineTapTarget(song, null, { line: 1, anchor: 2, focus: 1 })).toEqual({
      line: 1,
      word: 0
    })
    // A cursor an edit took away: the selection's.
    expect(lineTapTarget(song, { line: 9, word: 0 }, wholeLine(song, 3))).toEqual({
      line: 3,
      word: 0
    })
    // A selected line with no words: the next main line that has some.
    expect(lineTapTarget(song, null, wholeLine(song, 0))).toEqual({ line: 1, word: 0 })
  })

  it('lineTapTarget marks nothing after the last line, or with nothing to go by', () => {
    expect(lineTapTarget(song, 'done', wholeLine(song, 1))).toBeNull()
    expect(lineTapTarget(song, null, null)).toBeNull()
  })

  it('afterLineTap skips second voices and ends with done', () => {
    expect(afterLineTap(song, { line: 1, word: 0 })).toEqual({ line: 3, word: 0 })
    expect(afterLineTap(song, { line: 1, word: 2 })).toEqual({ line: 3, word: 0 })
    expect(afterLineTap(song, { line: 2, word: 0 })).toEqual({ line: 3, word: 0 })
    expect(afterLineTap(song, { line: 3, word: 0 })).toBe('done')
  })
})

describe('splitPoint', () => {
  it('counts whole characters before the click', () => {
    expect(splitPoint('ありがとう', 3)).toBe(3)
    // 𠮷 is two UTF-16 units but one character.
    expect(splitPoint('𠮷野家', 2)).toBe(1)
  })

  it('is nothing on the very edges of the word', () => {
    expect(splitPoint('word', 0)).toBeNull()
    expect(splitPoint('word', 4)).toBeNull()
  })
})
