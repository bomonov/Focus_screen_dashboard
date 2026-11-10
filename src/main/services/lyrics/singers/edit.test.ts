import { describe, expect, it } from 'vitest'
import { castSinger } from './cast'
import { applyEdit, createEditHistory } from './edit'
import { MAX_SINGER_NAME, parseSongColors } from './parse'
import type {
  CodedLine,
  CodedWord,
  ColorEdit,
  FirstEdit,
  ShownLine,
  SingerRef,
  SongColors
} from './types'

function word(
  text: string,
  start: number,
  end: number,
  singers: SingerRef | null = null
): CodedWord {
  return { text, start, end, singers }
}

function line(over: Partial<CodedLine> = {}): CodedLine {
  return {
    text: 'hello world today',
    start: 10,
    end: 22,
    words: [
      word('hello ', 10, 14, ['ichika']),
      word('world ', 14, 18, ['saki']),
      word('today', 18, 22)
    ],
    ...over
  }
}

function coding(over: Partial<SongColors> = {}): SongColors {
  return { version: 1, lines: [line()], cast: ['ichika', 'saki'], extra: [], ...over }
}

/** Frozen all the way down, so an edit that changed its input would throw. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}

/** The only line of a result, or a failure that says so. */
/**
 * An edit as an untrusted page could send it, past what the type allows (an add's `then` of any
 * kind): main checks it all the same.
 */
function fromPage(edit: unknown): ColorEdit {
  return edit as ColorEdit
}

function lineAt(colors: SongColors, index: number): CodedLine {
  const found = colors.lines[index]
  if (!found) throw new Error(`no line ${index}`)
  return found
}

function wordAt(colors: SongColors, lineIndex: number, wordIndex: number): CodedWord {
  const found = lineAt(colors, lineIndex).words[wordIndex]
  if (!found) throw new Error(`no word ${wordIndex} on line ${lineIndex}`)
  return found
}

describe('assign', () => {
  it('sets the words from..to, end excluded, and leaves the others alone', () => {
    const start = deepFreeze(coding())
    const result = applyEdit(start, {
      kind: 'assign',
      line: 0,
      from: 1,
      to: 3,
      singers: ['saki', 'ichika']
    })
    expect(result.lines[0]?.words.map((w) => w.singers)).toStrictEqual([
      ['ichika'],
      ['saki', 'ichika'],
      ['saki', 'ichika']
    ])
    // Times and text aren't touched.
    expect(result.lines[0]?.words.map((w) => [w.text, w.start, w.end])).toStrictEqual(
      start.lines[0]?.words.map((w) => [w.text, w.start, w.end])
    )
  })

  it('clears the words with null', () => {
    const result = applyEdit(coding(), { kind: 'assign', line: 0, from: 0, to: 2, singers: null })
    expect(result.lines[0]?.words.map((w) => w.singers)).toStrictEqual([null, null, null])
  })

  it('takes "everyone" while the cast has two or more', () => {
    const result = applyEdit(coding(), {
      kind: 'assign',
      line: 0,
      from: 2,
      to: 3,
      singers: 'everyone'
    })
    expect(wordAt(result, 0, 2).singers).toBe('everyone')
  })

  it('does nothing for "everyone" while the cast is smaller than two', () => {
    for (const cast of [[], ['ichika']]) {
      const start = coding({ cast })
      const edit: ColorEdit = { kind: 'assign', line: 0, from: 0, to: 3, singers: 'everyone' }
      expect(applyEdit(start, edit)).toBe(start)
    }
  })

  it('works on a second voice by its own place in the list', () => {
    const start = coding({
      lines: [
        line(),
        line({ text: 'echo', under: 0, words: [word('echo', 12, 14)], start: 12, end: 14 })
      ]
    })
    const result = applyEdit(start, {
      kind: 'assign',
      line: 1,
      from: 0,
      to: 1,
      singers: ['miku']
    })
    expect(wordAt(result, 1, 0).singers).toStrictEqual(['miku'])
    expect(result.lines[0]).toBe(start.lines[0])
  })

  it('keeps the singers once each and only the ones it knows', () => {
    const start = coding({ extra: [{ id: 'extra:guest', name: 'Guest', color: '#112233' }] })
    const result = applyEdit(start, {
      kind: 'assign',
      line: 0,
      from: 0,
      to: 1,
      singers: ['ichika', 'nobody', 'ichika', 'extra:guest']
    })
    expect(wordAt(result, 0, 0).singers).toStrictEqual(['ichika', 'extra:guest'])
  })

  it('does nothing when none of the singers are known', () => {
    const start = coding()
    expect(applyEdit(start, { kind: 'assign', line: 0, from: 0, to: 1, singers: ['nobody'] })).toBe(
      start
    )
  })

  it('does nothing for a line or range that is not there', () => {
    const start = coding()
    const bad: [number, number, number][] = [
      [5, 0, 1],
      [-1, 0, 1],
      [0, -1, 1],
      [0, 2, 2],
      [0, 3, 2],
      [0, 0, 4],
      [0, 0.5, 1],
      [0, 0, Number.NaN]
    ]
    for (const [lineIndex, from, to] of bad) {
      const edit: ColorEdit = { kind: 'assign', line: lineIndex, from, to, singers: ['saki'] }
      expect(applyEdit(start, edit)).toBe(start)
    }
  })

  it('hands back the same coding when nothing would change', () => {
    const start = coding()
    expect(applyEdit(start, { kind: 'assign', line: 0, from: 0, to: 1, singers: ['ichika'] })).toBe(
      start
    )
  })
})

describe('lineTime', () => {
  it('moves the words that fall outside the new times to its edges', () => {
    const start = deepFreeze(coding())
    const result = applyEdit(start, { kind: 'lineTime', line: 0, start: 16, end: 20 })
    const only = lineAt(result, 0)
    expect([only.start, only.end]).toStrictEqual([16, 20])
    expect(only.words.map((w) => [w.start, w.end])).toStrictEqual([
      [16, 16],
      [16, 18],
      [18, 20]
    ])
  })

  it('takes just a start or just an end', () => {
    const start = coding()
    const later = applyEdit(start, { kind: 'lineTime', line: 0, start: 12 })
    expect([lineAt(later, 0).start, lineAt(later, 0).end]).toStrictEqual([12, 22])
    const earlier = applyEdit(start, { kind: 'lineTime', line: 0, end: 30 })
    expect([lineAt(earlier, 0).start, lineAt(earlier, 0).end]).toStrictEqual([10, 30])
    // Words stay where they were when the line only grows.
    expect(lineAt(earlier, 0).words).toStrictEqual(start.lines[0]?.words)
  })

  it('keeps the end after the start: anything else does nothing', () => {
    const start = coding()
    const bad: Partial<{ start: number; end: number }>[] = [
      { start: 22 },
      { start: 30 },
      { end: 10 },
      { end: 5 },
      { start: 15, end: 15 },
      { start: 15, end: 14 },
      { start: -1 },
      { start: Number.NaN },
      { end: Number.POSITIVE_INFINITY },
      {}
    ]
    for (const times of bad) {
      expect(applyEdit(start, { kind: 'lineTime', line: 0, ...times })).toBe(start)
    }
  })

  it('does nothing for a line that is not there', () => {
    const start = coding()
    expect(applyEdit(start, { kind: 'lineTime', line: 3, start: 11 })).toBe(start)
  })
})

describe('wordTime', () => {
  it('moves a start that stays in order', () => {
    const start = deepFreeze(coding())
    const result = applyEdit(start, { kind: 'wordTime', line: 0, word: 1, start: 11 })
    expect(wordAt(result, 0, 1)).toStrictEqual(word('world ', 11, 18, ['saki']))
  })

  it('keeps word order: a start before the word before is held at its start', () => {
    const result = applyEdit(coding(), { kind: 'wordTime', line: 0, word: 1, start: 5 })
    expect(wordAt(result, 0, 1).start).toBe(10)
  })

  it('holds a start at the next word start too, so the order survives', () => {
    const result = applyEdit(coding(), { kind: 'wordTime', line: 0, word: 1, start: 20 })
    // Held at the next word's start (18), which also pulls the end up to it.
    expect(wordAt(result, 0, 1).start).toBe(18)
    expect(wordAt(result, 0, 1).end).toBe(18)
  })

  it('holds the first word inside the line', () => {
    const result = applyEdit(coding(), { kind: 'wordTime', line: 0, word: 0, start: 3 })
    expect(wordAt(result, 0, 0).start).toBe(10)
  })

  it('clamps an end to the line and to its own start', () => {
    const past = applyEdit(coding(), { kind: 'wordTime', line: 0, word: 2, end: 99 })
    expect(wordAt(past, 0, 2).end).toBe(22)
    const before = applyEdit(coding(), { kind: 'wordTime', line: 0, word: 1, end: 5 })
    expect(wordAt(before, 0, 1).end).toBe(14)
  })

  it('takes a start and an end together', () => {
    const result = applyEdit(coding(), { kind: 'wordTime', line: 0, word: 0, start: 11, end: 13 })
    expect([wordAt(result, 0, 0).start, wordAt(result, 0, 0).end]).toStrictEqual([11, 13])
  })

  it('does nothing for a word or line that is not there, or a time that is not a time', () => {
    const start = coding()
    const bad: ColorEdit[] = [
      { kind: 'wordTime', line: 0, word: 3, start: 12 },
      { kind: 'wordTime', line: 0, word: -1, start: 12 },
      { kind: 'wordTime', line: 2, word: 0, start: 12 },
      { kind: 'wordTime', line: 0, word: 0, start: Number.NaN },
      { kind: 'wordTime', line: 0, word: 0 }
    ]
    for (const edit of bad) expect(applyEdit(start, edit)).toBe(start)
  })
})

describe('tapTime', () => {
  // The reviewer's case: words a, b, c start at 11, 12 and 13, and the singer comes in late.
  function abc(): SongColors {
    return coding({
      lines: [
        line({
          text: 'a b c',
          start: 11,
          end: 14,
          words: [word('a ', 11, 12), word('b ', 12, 13), word('c', 13, 14)]
        })
      ]
    })
  }
  const starts = (colors: SongColors): number[] => lineAt(colors, 0).words.map((w) => w.start)

  it('puts a late tap where it was tapped, and pushes the words after it along', () => {
    const first = applyEdit(deepFreeze(abc()), { kind: 'tapTime', line: 0, word: 0, start: 12.5 })
    expect(starts(first)).toStrictEqual([12.5, 13.5, 14.5])
    // The last word ran past the line's end, so the line grows to hold it.
    expect(lineAt(first, 0).end).toBe(15.5)

    const second = applyEdit(first, { kind: 'tapTime', line: 0, word: 1, start: 13.3 })
    expect(starts(second)).toStrictEqual([12.5, 13.3, 14.3])
    expect(lineAt(second, 0).timed).toBe(true)
  })

  it('keeps each word as long as it was', () => {
    const result = applyEdit(abc(), { kind: 'tapTime', line: 0, word: 1, start: 12.25 })
    expect(lineAt(result, 0).words.map((w) => w.end - w.start)).toStrictEqual([1, 1, 1])
  })

  it('lets the first word move the line’s start earlier, never before the song', () => {
    const earlier = applyEdit(abc(), { kind: 'tapTime', line: 0, word: 0, start: 10 })
    expect(lineAt(earlier, 0).start).toBe(10)
    expect(starts(earlier)).toStrictEqual([10, 11, 12])
    const tooEarly = applyEdit(abc(), { kind: 'tapTime', line: 0, word: 0, start: -3 })
    expect(lineAt(tooEarly, 0).start).toBe(0)
  })

  it('keeps word order: a tap before the word before is held at its start', () => {
    const result = applyEdit(abc(), { kind: 'tapTime', line: 0, word: 1, start: 10 })
    expect(starts(result)).toStrictEqual([11, 11, 12])
  })

  it('ends the word before where the tapped one now starts', () => {
    const result = applyEdit(abc(), { kind: 'tapTime', line: 0, word: 1, start: 11.5 })
    expect(wordAt(result, 0, 0).end).toBe(11.5)
  })

  it('keeps everything inside the song', () => {
    const result = applyEdit(abc(), {
      kind: 'tapTime',
      line: 0,
      word: 0,
      start: 12.5,
      songEnd: 15
    })
    expect(starts(result)).toStrictEqual([12.5, 13.5, 14.5])
    expect(wordAt(result, 0, 2).end).toBe(15)
    expect(lineAt(result, 0).end).toBe(15)
  })

  it('a held tap ends the word where it’s let go, growing the line when it must', () => {
    const result = applyEdit(abc(), { kind: 'tapTime', line: 0, word: 2, end: 16 })
    expect(wordAt(result, 0, 2).end).toBe(16)
    expect(lineAt(result, 0).end).toBe(16)
    const before = applyEdit(abc(), { kind: 'tapTime', line: 0, word: 2, end: 12 })
    // Never before the word's own start.
    expect(wordAt(before, 0, 2).end).toBe(13)
  })

  it('does nothing for a word that isn’t there or a time that isn’t one', () => {
    const start = abc()
    const bad: ColorEdit[] = [
      { kind: 'tapTime', line: 0, word: 3, start: 12 },
      { kind: 'tapTime', line: 1, word: 0, start: 12 },
      { kind: 'tapTime', line: 0, word: 0, start: Number.NaN },
      { kind: 'tapTime', line: 0, word: 0 }
    ]
    for (const edit of bad) expect(applyEdit(start, edit)).toBe(start)
  })
})

describe('tapTime, whole line (Tap: Lines)', () => {
  const known = (id: string): boolean => castSinger(id) !== undefined
  /** A synced line 11.5–16, timed; a second voice under it at 14–16. */
  function synced(over: Partial<CodedLine> = {}): SongColors {
    return coding({
      lines: [
        line({
          text: 'sing it',
          start: 11.5,
          end: 16,
          words: [word('sing ', 11.5, 13, ['ichika']), word('it', 13, 16)],
          timed: true,
          ...over
        }),
        line({ text: '(it)', start: 14, end: 16, words: [word('(it)', 14, 16)], under: 0 })
      ]
    })
  }
  const span = (colors: SongColors, index: number): number[][] => {
    const one = lineAt(colors, index)
    return [[one.start, one.end], ...one.words.map((w) => [w.start, w.end])]
  }

  it('moves a timed line whole to the press, its words keeping their shares', () => {
    const result = applyEdit(deepFreeze(synced()), {
      kind: 'tapTime',
      line: 0,
      word: 0,
      start: 20,
      whole: true
    })
    expect(span(result, 0)).toStrictEqual([
      [20, 24.5],
      [20, 21.5],
      [21.5, 24.5]
    ])
    expect(lineAt(result, 0).timed).toBe(true)
    expect(wordAt(result, 0, 0).singers).toStrictEqual(['ichika'])
    expect(parseSongColors(result, known)).toStrictEqual(result)
    // A Words tap on the same line keeps the start the user had, and stretches the line instead.
    const stretched = applyEdit(synced(), { kind: 'tapTime', line: 0, word: 0, start: 20 })
    expect(lineAt(stretched, 0).start).toBe(11.5)
  })

  it('moves it earlier just the same', () => {
    const result = applyEdit(synced(), {
      kind: 'tapTime',
      line: 0,
      word: 0,
      start: 10,
      whole: true
    })
    expect(span(result, 0)).toStrictEqual([
      [10, 14.5],
      [10, 11.5],
      [11.5, 14.5]
    ])
  })

  it('times a guessed added line where it’s tapped', () => {
    const guessed = synced({ added: true, guessed: true })
    delete lineAt(guessed, 0).timed
    const result = applyEdit(guessed, {
      kind: 'tapTime',
      line: 0,
      word: 0,
      start: 12.5,
      whole: true
    })
    expect(lineAt(result, 0).start).toBe(12.5)
    expect(lineAt(result, 0).end).toBe(17)
    expect(lineAt(result, 0).timed).toBe(true)
    expect(lineAt(result, 0)).not.toHaveProperty('guessed')
    expect(lineAt(result, 0).added).toBe(true)
  })

  it('moves the second voices under it along by as much', () => {
    const result = applyEdit(synced(), {
      kind: 'tapTime',
      line: 0,
      word: 0,
      start: 20,
      whole: true
    })
    expect(span(result, 1)).toStrictEqual([
      [22.5, 24.5],
      [22.5, 24.5]
    ])
    expect(lineAt(result, 1).under).toBe(0)
  })

  it('keeps everything inside the song near its end, and never before its start', () => {
    const late = applyEdit(synced(), {
      kind: 'tapTime',
      line: 0,
      word: 0,
      start: 21,
      whole: true,
      songEnd: 23
    })
    expect(span(late, 0)).toStrictEqual([
      [21, 23],
      [21, 22.5],
      [22.5, 23]
    ])
    expect(span(late, 1)).toStrictEqual([
      [23, 23],
      [23, 23]
    ])
    expect(parseSongColors(late, known)).toStrictEqual(late)
    const early = applyEdit(synced(), { kind: 'tapTime', line: 0, word: 0, start: -4, whole: true })
    expect(span(early, 0)).toStrictEqual([
      [0, 4.5],
      [0, 1.5],
      [1.5, 4.5]
    ])
  })

  it('puts the first word on the press when it began after the line’s start', () => {
    // A Words tap on a timed line once pushed its words on and kept its start.
    const gap = synced({
      start: 6,
      end: 16,
      words: [word('sing ', 11.5, 13), word('it', 13, 16)]
    })
    const result = applyEdit(gap, { kind: 'tapTime', line: 0, word: 0, start: 20, whole: true })
    expect(span(result, 0)).toStrictEqual([
      [20, 24.5],
      [20, 21.5],
      [21.5, 24.5]
    ])
  })

  it('is no edit on any word but the first, or without a start', () => {
    const start = synced()
    const bad: ColorEdit[] = [
      { kind: 'tapTime', line: 0, word: 1, start: 20, whole: true },
      { kind: 'tapTime', line: 0, word: 0, end: 20, whole: true },
      { kind: 'tapTime', line: 0, word: 0, start: 20, end: 21, whole: true },
      { kind: 'tapTime', line: 0, word: 0, start: Number.NaN, whole: true },
      { kind: 'tapTime', line: 5, word: 0, start: 20, whole: true }
    ]
    for (const edit of bad) expect(applyEdit(start, edit)).toBe(start)
  })
})

describe('newWords', () => {
  // "three four" was coded; the lyrics now show "three for " (a fixed typo).
  function changed(over: Partial<CodedLine> = {}): SongColors {
    return coding({
      lines: [
        line({
          text: 'three four',
          start: 10,
          end: 14,
          romajiSplits: [5],
          words: [word('three ', 10, 12, ['ichika']), word('four', 12, 14, ['saki'])],
          ...over
        }),
        line({ text: 'echo', under: 0, start: 13, end: 14, words: [word('echo', 13, 14)] })
      ]
    })
  }
  const shown: ShownLine = {
    text: 'three for ',
    start: 20,
    end: 23,
    words: [
      { text: 'three ', start: 20, end: 21 },
      { text: 'for ', start: 21, end: 23 }
    ]
  }

  it('takes the shown line’s text, words and times, keeping singers on words that match', () => {
    const result = applyEdit(deepFreeze(changed()), { kind: 'newWords', line: 0, shown })
    expect(lineAt(result, 0)).toStrictEqual({
      text: 'three for ',
      start: 20,
      end: 23,
      words: [word('three ', 20, 21, ['ichika']), word('for ', 21, 23)]
    })
    // Its second voice stays under it.
    expect(lineAt(result, 1).under).toBe(0)
  })

  it('is timed or a guess as the shown line is: its times are the shown line’s', () => {
    // The reviewer's case: a line the user timed takes a plain song's guessed 85 s.
    const fromPlain = applyEdit(changed({ timed: true }), {
      kind: 'newWords',
      line: 0,
      shown: { ...shown, guessed: true }
    })
    expect(lineAt(fromPlain, 0)).not.toHaveProperty('timed')
    expect(lineAt(fromPlain, 0).guessed).toBe(true)
    const fromSynced = applyEdit(changed(), {
      kind: 'newWords',
      line: 0,
      shown: { ...shown, timed: true }
    })
    expect(lineAt(fromSynced, 0).timed).toBe(true)
    expect(lineAt(fromSynced, 0)).not.toHaveProperty('guessed')
    const fromAutoSync = applyEdit(changed({ timed: true }), { kind: 'newWords', line: 0, shown })
    expect(lineAt(fromAutoSync, 0)).not.toHaveProperty('timed')
  })

  it('does nothing for a second voice, or words that don’t spell the text', () => {
    const start = changed()
    const bad: ColorEdit[] = [
      { kind: 'newWords', line: 1, shown },
      { kind: 'newWords', line: 2, shown },
      { kind: 'newWords', line: 0, shown: { ...shown, text: 'three fore ' } },
      { kind: 'newWords', line: 0, shown: { ...shown, words: [] } },
      { kind: 'newWords', line: 0, shown: { ...shown, start: Number.NaN } },
      { kind: 'newWords', line: 0, shown: { ...shown, start: 30 } }
    ]
    for (const edit of bad) expect(applyEdit(start, edit)).toBe(start)
  })
})

describe('addLine', () => {
  const shown: ShownLine = {
    text: 'new line',
    start: 30,
    end: 33,
    words: [
      { text: 'new ', start: 30, end: 31 },
      { text: 'line', start: 31, end: 33 }
    ]
  }
  function withVoices(): SongColors {
    return coding({
      lines: [
        line(),
        line({ text: 'oh', under: 0, start: 12, end: 14, words: [word('oh', 12, 14)] }),
        line({ text: 'later', start: 40, end: 42, words: [word('later', 40, 42)] }),
        line({ text: 'ah', under: 2, start: 41, end: 42, words: [word('ah', 41, 42)] })
      ]
    })
  }

  it('puts the shown line in, nobody given anything, and keeps second voices on their lines', () => {
    const result = applyEdit(deepFreeze(withVoices()), { kind: 'addLine', at: 2, shown })
    expect(result.lines.map((one) => one.text)).toStrictEqual([
      'hello world today',
      'oh',
      'new line',
      'later',
      'ah'
    ])
    expect(lineAt(result, 2)).toStrictEqual({
      text: 'new line',
      start: 30,
      end: 33,
      words: [word('new ', 30, 31), word('line', 31, 33)]
    })
    expect(lineAt(result, 1).under).toBe(0)
    expect(lineAt(result, 4).under).toBe(3)
  })

  it('makes the first edit on it in the same step', () => {
    const result = applyEdit(withVoices(), {
      kind: 'addLine',
      at: 2,
      shown: { ...shown, timed: true },
      then: { kind: 'assign', line: 2, from: 0, to: 1, singers: ['miku'] }
    })
    expect(lineAt(result, 2).words.map((one) => one.singers)).toStrictEqual([['miku'], null])
    expect(lineAt(result, 2).timed).toBe(true)
  })

  it('keeps a plain song’s line a guess, and only a mark that is true', () => {
    const plain = applyEdit(withVoices(), {
      kind: 'addLine',
      at: 2,
      shown: { ...shown, guessed: true }
    })
    expect(lineAt(plain, 2).guessed).toBe(true)
    const odd = applyEdit(withVoices(), {
      kind: 'addLine',
      at: 2,
      shown: { ...shown, guessed: 'yes' } as unknown as ShownLine
    })
    expect(lineAt(odd, 2)).not.toHaveProperty('guessed')
  })

  it('adds nothing when the edit on it does nothing, or is another add', () => {
    const start = withVoices()
    const bad: ColorEdit[] = [
      {
        kind: 'addLine',
        at: 2,
        shown,
        then: { kind: 'assign', line: 2, from: 0, to: 9, singers: ['miku'] }
      },
      fromPage({ kind: 'addLine', at: 2, shown, then: { kind: 'addLine', at: 2, shown } }),
      fromPage({ kind: 'addLine', at: 2, shown, then: { kind: 'newWords', line: 2, shown } })
    ]
    for (const edit of bad) expect(applyEdit(start, edit)).toBe(start)
  })

  it('makes with it only the edits the page makes on that line, never heard times or line moves', () => {
    const mine = line({
      text: 'mine',
      start: 50,
      end: 52,
      words: [word('mine', 50, 52)],
      added: true,
      guessed: true
    })
    const start = coding({ lines: [...withVoices().lines, mine] })
    const bad: ColorEdit[] = [
      fromPage({
        kind: 'addLine',
        at: 2,
        shown,
        then: {
          kind: 'heardTimes',
          lines: [
            {
              line: 2,
              start: 31,
              end: 34,
              words: [
                { start: 31, end: 32 },
                { start: 32, end: 34 }
              ]
            }
          ]
        }
      }),
      // The user's added line, after the new one, removed in the same step.
      fromPage({ kind: 'addLine', at: 2, shown, then: { kind: 'removeLine', line: 5 } }),
      fromPage({ kind: 'addLine', at: 2, shown, then: { kind: 'moveLine', line: 5, delta: -1 } }),
      fromPage({
        kind: 'addLine',
        at: 2,
        shown,
        then: {
          kind: 'addLines',
          at: 0,
          lines: [{ text: 'more', start: 1, end: 2, words: [{ text: 'more', start: 1, end: 2 }] }]
        }
      }),
      // Another line's edit, though of a kind the page sends.
      {
        kind: 'addLine',
        at: 2,
        shown,
        then: { kind: 'assign', line: 0, from: 0, to: 1, singers: ['miku'] }
      },
      // Times: the page never sends them on a line that isn't in the coding yet.
      fromPage({ kind: 'addLine', at: 2, shown, then: { kind: 'lineTime', line: 2, start: 29 } })
    ]
    // Each one refused, the coding as it was.
    expect(bad.filter((edit) => applyEdit(start, edit) !== start)).toEqual([])

    const good: FirstEdit[] = [
      { kind: 'assign', line: 2, from: 0, to: 1, singers: ['miku'] },
      { kind: 'splitWord', line: 2, word: 0, at: 2 },
      { kind: 'makeVoice', line: 2, from: 1, to: 2 },
      { kind: 'addVoice', line: 2, text: 'la la' },
      { kind: 'romajiSplits', line: 2, splits: [3] }
    ]
    for (const then of good) {
      const result = applyEdit(start, { kind: 'addLine', at: 2, shown, then })
      expect(result).not.toBe(start)
      expect(lineAt(result, 2).text).toBe('new line')
    }
  })

  it('never goes between a line and its second voice, nor off the list', () => {
    const start = withVoices()
    for (const at of [1, 3, -1, 5, 1.5]) {
      expect(applyEdit(start, { kind: 'addLine', at, shown })).toBe(start)
    }
    expect(applyEdit(start, { kind: 'addLine', at: 4, shown }).lines).toHaveLength(5)
    expect(applyEdit(start, { kind: 'addLine', at: 0, shown }).lines).toHaveLength(5)
  })

  it('does nothing for words that don’t spell the text, or times that aren’t times', () => {
    const start = withVoices()
    const bad: ShownLine[] = [
      { ...shown, text: 'old line' },
      { ...shown, text: '  ', words: [{ text: '  ', start: 30, end: 31 }] },
      { ...shown, end: 29 },
      { ...shown, words: [{ text: 'new line', start: Number.POSITIVE_INFINITY, end: 31 }] }
    ]
    for (const one of bad)
      expect(applyEdit(start, { kind: 'addLine', at: 2, shown: one })).toBe(start)
  })
})

describe('added lines', () => {
  function shownLine(text: string, start: number, over: Partial<ShownLine> = {}): ShownLine {
    const pieces = text.split(' ')
    return {
      text,
      start,
      end: start + pieces.length,
      words: pieces.map((piece, i) => ({
        text: i < pieces.length - 1 ? `${piece} ` : piece,
        start: start + i,
        end: start + i + 1
      })),
      ...over
    }
  }
  function two(): SongColors {
    return coding({
      lines: [line(), line({ text: 'later', start: 40, end: 42, words: [word('later', 40, 42)] })]
    })
  }

  describe('addLines', () => {
    const X = shownLine('new one', 30, { timed: true })
    const Y = shownLine('new two', 33)

    it('adds lines as the user’s own guesses, nobody singing', () => {
      const result = applyEdit(deepFreeze(two()), { kind: 'addLines', at: 1, lines: [X, Y] })
      expect(result.lines).toHaveLength(4)
      expect(lineAt(result, 1).text).toBe(X.text)
      for (const at of [1, 2]) {
        expect(lineAt(result, at).added).toBe(true)
        expect(lineAt(result, at).guessed).toBe(true)
        expect(lineAt(result, at).timed).toBeUndefined()
        expect(lineAt(result, at).words.every((one) => one.singers === null)).toBe(true)
      }
      expect(lineAt(result, 3).text).toBe('later')
    })

    it('moves later second voices along', () => {
      const start = coding({
        lines: [
          line(),
          line({ text: 'oh', under: 0, start: 12, end: 14, words: [word('oh', 12, 14)] }),
          line({ text: 'later', start: 40, end: 42, words: [word('later', 40, 42)] }),
          line({ text: 'ah', under: 2, start: 41, end: 42, words: [word('ah', 41, 42)] })
        ]
      })
      const result = applyEdit(start, { kind: 'addLines', at: 2, lines: [X, Y] })
      expect(lineAt(result, 5).under).toBe(4)
      expect(lineAt(result, 1).under).toBe(0)
    })

    it('refuses a place between a line and its voice, more than 40 lines, a line over 200 characters, a blank line, or words that don’t spell the line', () => {
      const withVoice = coding({
        lines: [
          line(),
          line({ text: 'oh', under: 0, start: 12, end: 14, words: [word('oh', 12, 14)] })
        ]
      })
      expect(applyEdit(withVoice, { kind: 'addLines', at: 1, lines: [X] })).toBe(withVoice)
      const start = two()
      const lots = Array.from({ length: 41 }, (_, i) => shownLine(`l${i}`, i))
      expect(applyEdit(start, { kind: 'addLines', at: 1, lines: lots })).toBe(start)
      const long = shownLine('x'.repeat(201), 0)
      expect(applyEdit(start, { kind: 'addLines', at: 1, lines: [long] })).toBe(start)
      const blank = shownLine('   ', 0)
      expect(applyEdit(start, { kind: 'addLines', at: 1, lines: [blank] })).toBe(start)
      const wrong = { ...X, text: 'something else' }
      expect(applyEdit(start, { kind: 'addLines', at: 1, lines: [wrong] })).toBe(start)
      expect(applyEdit(start, { kind: 'addLines', at: 1, lines: [] })).toBe(start)
      expect(applyEdit(start, { kind: 'addLines', at: 3, lines: [X] })).toBe(start)
    })
  })

  describe('retype', () => {
    const addedLine = line({
      text: 'あ い う',
      start: 30,
      end: 36,
      added: true,
      guessed: true,
      romajiSplits: [2],
      words: [
        word('あ ', 30, 32, ['ichika']),
        word('い ', 32, 34, ['saki']),
        word('う', 34, 36, ['miku'])
      ]
    })

    it('retypes an added line, keeping its times and the singers of unchanged words', () => {
      const start = coding({ lines: [line(), addedLine] })
      const result = applyEdit(deepFreeze(start), {
        kind: 'retype',
        line: 1,
        shown: shownLine('あ え う', 0)
      })
      const one = lineAt(result, 1)
      expect(one.text).toBe('あ え う')
      expect(one.start).toBe(30)
      expect(one.end).toBe(36)
      expect(one.words.map((w) => w.singers)).toStrictEqual([['ichika'], null, ['miku']])
      expect(one).not.toHaveProperty('romajiSplits')
      expect(one.added).toBe(true)
      expect(one.guessed).toBe(true)
      expect(one.words.every((w) => w.start >= 30 && w.end <= 36)).toBe(true)
    })

    it('scales the given words onto the line’s span, off it or on it', () => {
      const start = coding({ lines: [line(), addedLine] })
      const times = (colors: SongColors): number[][] =>
        lineAt(colors, 1).words.map((w) => [w.start, w.end])
      // given at 0-3: three equal words become 30-32, 32-34, 34-36
      const off = applyEdit(start, { kind: 'retype', line: 1, shown: shownLine('あ え う', 0) })
      expect(times(off)).toStrictEqual([
        [30, 32],
        [32, 34],
        [34, 36]
      ])
      // given on the span, unevenly: kept as they are
      const on = applyEdit(start, {
        kind: 'retype',
        line: 1,
        shown: {
          text: 'あ え う',
          start: 30,
          end: 36,
          words: [
            { text: 'あ ', start: 30, end: 31 },
            { text: 'え ', start: 31, end: 35 },
            { text: 'う', start: 35, end: 36 }
          ]
        }
      })
      expect(times(on)).toStrictEqual([
        [30, 31],
        [31, 35],
        [35, 36]
      ])
    })

    it('won’t retype the lyrics’ own line', () => {
      const start = coding({ lines: [line(), addedLine] })
      expect(applyEdit(start, { kind: 'retype', line: 0, shown: shownLine('a b', 10) })).toBe(start)
    })
  })

  describe('removeLine', () => {
    it('removes an added line with its second voices', () => {
      const start = coding({
        lines: [
          line(),
          line({
            text: 'x',
            added: true,
            guessed: true,
            start: 30,
            end: 32,
            words: [word('x', 30, 32)]
          }),
          line({ text: 'xv', under: 1, start: 30, end: 32, words: [word('xv', 30, 32)] }),
          line({ text: 'later', start: 40, end: 42, words: [word('later', 40, 42)] }),
          line({ text: 'ah', under: 3, start: 41, end: 42, words: [word('ah', 41, 42)] })
        ]
      })
      const result = applyEdit(deepFreeze(start), { kind: 'removeLine', line: 1 })
      expect(result.lines.map((one) => one.text)).toStrictEqual([
        'hello world today',
        'later',
        'ah'
      ])
      expect(lineAt(result, 2).under).toBe(1)
    })

    it('refuses when a voice of it isn’t right after it', () => {
      const X = line({
        text: 'X',
        added: true,
        guessed: true,
        start: 30,
        end: 32,
        words: [word('X', 30, 32)]
      })
      const B = line({ text: 'B', start: 40, end: 42, words: [word('B', 40, 42)] })
      const v = line({ text: 'xv', under: 0, start: 30, end: 32, words: [word('xv', 30, 32)] })
      const start = coding({ lines: [X, B, v] })
      expect(applyEdit(start, { kind: 'removeLine', line: 0 })).toBe(start)
    })

    it('won’t remove the lyrics’ own line', () => {
      const start = two()
      expect(applyEdit(start, { kind: 'removeLine', line: 0 })).toBe(start)
    })
  })

  describe('moveLine', () => {
    const X = line({
      text: 'X x',
      added: true,
      guessed: true,
      start: 30,
      end: 34,
      words: [word('X ', 30, 32, ['ichika']), word('x', 32, 34, ['ichika'])]
    })
    const voiceOfA = line({ text: 'oh', under: 0, start: 12, end: 14, words: [word('oh', 12, 14)] })
    function plain(): SongColors {
      const B = line({ text: 'B', start: 40, end: 42, words: [word('B', 40, 42)] })
      return coding({ lines: [line(), voiceOfA, X, B] })
    }

    it('moves an added line past the lyrics’ own line, voices and all', () => {
      const start = plain()
      const up = applyEdit(deepFreeze(start), { kind: 'moveLine', line: 2, delta: -1 })
      expect(up.lines.map((one) => one.text)).toStrictEqual(['X x', 'hello world today', 'oh', 'B'])
      expect(lineAt(up, 2).under).toBe(1)
      expect(lineAt(up, 0)).toStrictEqual(X)
      const down1 = applyEdit(up, { kind: 'moveLine', line: 0, delta: 1 })
      expect(down1.lines.map((one) => one.text)).toStrictEqual([
        'hello world today',
        'oh',
        'X x',
        'B'
      ])
      expect(lineAt(down1, 1).under).toBe(0)
      const down2 = applyEdit(down1, { kind: 'moveLine', line: 2, delta: 1 })
      expect(down2.lines.map((one) => one.text)).toStrictEqual([
        'hello world today',
        'oh',
        'B',
        'X x'
      ])
      expect(lineAt(down2, 3)).toStrictEqual(X)
    })

    it('stays put at either end, and won’t move the lyrics’ own lines', () => {
      const start = plain()
      expect(applyEdit(start, { kind: 'moveLine', line: 0, delta: 1 })).toBe(start)
      expect(applyEdit(start, { kind: 'moveLine', line: 3, delta: 1 })).toBe(start)
      const first = coding({ lines: [X, line()] })
      expect(applyEdit(first, { kind: 'moveLine', line: 0, delta: -1 })).toBe(first)
      const last = coding({ lines: [line(), X] })
      expect(applyEdit(last, { kind: 'moveLine', line: 1, delta: 1 })).toBe(last)
      // times don't make an impossible move possible
      expect(applyEdit(last, { kind: 'moveLine', line: 1, delta: 1, start: 1, end: 2 })).toBe(last)
    })

    it('re-times a moved line when the move brings times (R13)', () => {
      const timedX = line({
        text: 'X x',
        added: true,
        timed: true,
        start: 30,
        end: 34,
        words: [word('X ', 30, 32, ['ichika']), word('x', 32, 34, ['ichika'])]
      })
      const A = line({ timed: true, start: 10, end: 14 })
      const voice = line({ text: 'v', under: 1, start: 28, end: 30, words: [word('v', 28, 30)] })
      const start = coding({ lines: [A, timedX, voice] })
      const result = applyEdit(deepFreeze(start), {
        kind: 'moveLine',
        line: 1,
        delta: -1,
        start: 6,
        end: 8
      })
      expect(result.lines.map((one) => one.text)).toStrictEqual(['X x', 'v', 'hello world today'])
      const moved = lineAt(result, 0)
      expect([moved.start, moved.end]).toStrictEqual([6, 8])
      expect(moved.words.map((w) => [w.start, w.end])).toStrictEqual([
        [6, 7],
        [7, 8]
      ])
      expect(moved.words.map((w) => w.singers)).toStrictEqual([['ichika'], ['ichika']])
      expect(moved.guessed).toBe(true)
      expect(moved.timed).toBeUndefined()
      const v = lineAt(result, 1)
      expect(v.under).toBe(0)
      expect([v.start, v.end]).toStrictEqual([4, 6])
      expect(lineAt(result, 2)).toStrictEqual(A)
    })

    it('keeps second voices of a shifted line guessed, as their times come from a guess', () => {
      const timedX = line({
        text: 'X x',
        added: true,
        timed: true,
        start: 30,
        end: 34,
        words: [word('X ', 30, 32), word('x', 32, 34)]
      })
      const voice = line({
        text: 'v',
        under: 1,
        timed: true,
        start: 28,
        end: 30,
        words: [word('v', 28, 30)]
      })
      const start = coding({ lines: [line({ timed: true }), timedX, voice] })
      const result = applyEdit(start, { kind: 'moveLine', line: 1, delta: -1, start: 6, end: 8 })
      expect(lineAt(result, 1).guessed).toBe(true)
      expect(lineAt(result, 1).timed).toBeUndefined()
    })

    it('refuses when a voice isn’t right after its main line', () => {
      const B = line({ text: 'B', start: 40, end: 42, words: [word('B', 40, 42)] })
      const start = coding({ lines: [line(), B, voiceOfA, X] })
      expect(applyEdit(start, { kind: 'moveLine', line: 3, delta: -1 })).toBe(start)
      const strayX = coding({
        lines: [
          X,
          B,
          line({ text: 'xv', under: 0, start: 30, end: 31, words: [word('xv', 30, 31)] })
        ]
      })
      expect(applyEdit(strayX, { kind: 'moveLine', line: 0, delta: 1 })).toBe(strayX)
    })

    it('refuses half a span or a backwards one', () => {
      const start = coding({ lines: [line(), X] })
      const base = { kind: 'moveLine' as const, line: 1, delta: -1 as const }
      expect(applyEdit(start, { ...base, start: 6 })).toBe(start)
      expect(applyEdit(start, { ...base, end: 6 })).toBe(start)
      expect(applyEdit(start, { ...base, start: 8, end: 6 })).toBe(start)
      expect(applyEdit(start, { ...base, start: -1, end: 2 })).toBe(start)
      expect(applyEdit(start, { ...base, start: Number.NaN, end: 8 })).toBe(start)
    })
  })

  it('newWords leaves an added line alone', () => {
    const start = coding({
      lines: [line(), line({ text: 'x', added: true, guessed: true, words: [word('x', 10, 22)] })]
    })
    expect(applyEdit(start, { kind: 'newWords', line: 1, shown: shownLine('y', 10) })).toBe(start)
  })

  it('every new edit’s result passes parseSongColors unchanged', () => {
    const known = (id: string): boolean => castSinger(id) !== undefined
    const X = line({
      text: 'X x',
      added: true,
      guessed: true,
      start: 30,
      end: 34,
      words: [word('X ', 30, 32, ['ichika']), word('x', 32, 34)]
    })
    const start = coding({
      lines: [line(), X, line({ text: 'z', start: 40, end: 42, words: [word('z', 40, 42)] })]
    })
    const edits: ColorEdit[] = [
      { kind: 'addLines', at: 1, lines: [shownLine('a b', 1, { timed: true })] },
      { kind: 'retype', line: 1, shown: shownLine('X y', 0) },
      { kind: 'removeLine', line: 1 },
      { kind: 'moveLine', line: 1, delta: -1 },
      { kind: 'moveLine', line: 1, delta: 1, start: 41, end: 44 }
    ]
    for (const edit of edits) {
      const result = applyEdit(start, edit)
      expect(result).not.toBe(start)
      expect(parseSongColors(JSON.parse(JSON.stringify(result)), known)).toStrictEqual(result)
    }
  })
})

describe('heardTimes', () => {
  function heard(): SongColors {
    return coding({
      lines: [
        line(),
        line({
          text: 'new one',
          start: 30,
          end: 34,
          added: true,
          guessed: true,
          words: [word('new ', 30, 32, ['miku']), word('one', 32, 34)]
        })
      ]
    })
  }

  it('sets the times and marks the lines timed, singers kept', () => {
    const start = deepFreeze(heard())
    const result = applyEdit(start, {
      kind: 'heardTimes',
      lines: [
        {
          line: 0,
          start: 11,
          end: 20,
          words: [
            { start: 11, end: 13 },
            { start: 13, end: 16 },
            { start: 16, end: 20 }
          ]
        },
        {
          line: 1,
          start: 40,
          end: 43,
          // Pulled onto the line in order: never before it or the word before, never past its end.
          words: [
            { start: 39, end: 41 },
            { start: 40.5, end: 45 }
          ]
        }
      ]
    })
    expect(lineAt(result, 0)).toEqual({
      ...line(),
      start: 11,
      end: 20,
      words: [
        word('hello ', 11, 13, ['ichika']),
        word('world ', 13, 16, ['saki']),
        word('today', 16, 20)
      ],
      timed: true
    })
    const second = lineAt(result, 1)
    expect(second.timed).toBe(true)
    expect(second.guessed).toBeUndefined()
    expect(second.added).toBe(true)
    expect(second.start).toBe(40)
    expect(second.end).toBe(43)
    expect(second.words).toEqual([word('new ', 40, 41, ['miku']), word('one', 40.5, 43)])
  })

  it('skips an entry whose words don’t fit the line', () => {
    const start = heard()
    const good = {
      line: 1,
      start: 40,
      end: 42,
      words: [
        { start: 40, end: 41 },
        { start: 41, end: 42 }
      ]
    }
    const result = applyEdit(start, {
      kind: 'heardTimes',
      lines: [{ line: 0, start: 11, end: 20, words: [{ start: 11, end: 20 }] }, good]
    })
    expect(lineAt(result, 0)).toBe(start.lines[0])
    expect(lineAt(result, 1).start).toBe(40)

    const bad = [
      { ...good, words: [{ start: 40, end: 41 }] },
      { ...good, line: 2 },
      { ...good, start: -1 },
      { ...good, end: 40 },
      { ...good, start: Number.NaN },
      {
        ...good,
        words: [
          { start: 40, end: 41 },
          { start: 'x', end: 42 }
        ]
      }
    ] as unknown as Extract<ColorEdit, { kind: 'heardTimes' }>['lines']
    for (const entry of bad) {
      expect(applyEdit(start, { kind: 'heardTimes', lines: [entry] })).toBe(start)
    }
    expect(applyEdit(start, { kind: 'heardTimes', lines: [] })).toBe(start)
    const notAList = { kind: 'heardTimes', lines: 'x' } as unknown as ColorEdit
    expect(applyEdit(start, notAList)).toBe(start)
  })
})

describe('timed lines', () => {
  // A line the user set times on shows at them; one they didn't keeps the lyrics' own times.
  it('lineTime and wordTime mark the line timed', () => {
    expect(lineAt(applyEdit(coding(), { kind: 'lineTime', line: 0, start: 11 }), 0).timed).toBe(
      true
    )
    const worded = applyEdit(coding(), { kind: 'wordTime', line: 0, word: 1, start: 15 })
    expect(lineAt(worded, 0).timed).toBe(true)
  })

  it('edits that set no time keep the mark as it was', () => {
    const timed = coding({ lines: [line({ timed: true })] })
    const kept: ColorEdit[] = [
      { kind: 'assign', line: 0, from: 0, to: 1, singers: ['saki'] },
      { kind: 'splitWord', line: 0, word: 0, at: 2 },
      { kind: 'romajiSplits', line: 0, splits: [3] }
    ]
    for (const edit of kept) {
      expect(lineAt(applyEdit(timed, edit), 0).timed).toBe(true)
      expect(lineAt(applyEdit(coding(), edit), 0)).not.toHaveProperty('timed')
    }
  })

  it('a tap on the first word of a line nobody timed is where the line starts, later or earlier', () => {
    // Auto-sync's times are close but not set by anyone, so the tap wins either way.
    const later = applyEdit(coding(), { kind: 'tapTime', line: 0, word: 0, start: 12 })
    expect(lineAt(later, 0).start).toBe(12)
    expect(lineAt(later, 0).timed).toBe(true)
    // A start the user set stays when their tap is later: they put the line there.
    const own = coding({ lines: [line({ timed: true })] })
    expect(lineAt(applyEdit(own, { kind: 'tapTime', line: 0, word: 0, start: 12 }), 0).start).toBe(
      10
    )
  })

  it('a second voice made from a timed line is timed too, and the line stays timed', () => {
    const timed = coding({ lines: [line({ timed: true })] })
    const result = applyEdit(timed, { kind: 'makeVoice', line: 0, from: 1, to: 2 })
    expect(lineAt(result, 0).timed).toBe(true)
    expect(lineAt(result, 1).timed).toBe(true)
    const untimed = applyEdit(coding(), { kind: 'makeVoice', line: 0, from: 1, to: 2 })
    expect(lineAt(untimed, 1)).not.toHaveProperty('timed')
  })
})

describe('lines whose times the editor guessed', () => {
  // A plain song's lines are spread over it (5–95%), so the guess can be 30 s off the singing.
  const guessed = (): SongColors => coding({ lines: [line({ guessed: true })] })

  it('a tap on the first word moves the whole line there and marks it timed', () => {
    const result = applyEdit(deepFreeze(guessed()), {
      kind: 'tapTime',
      line: 0,
      word: 0,
      start: 40
    })
    const tapped = lineAt(result, 0)
    expect(tapped.start).toBe(40)
    expect(tapped.words.map((w) => w.start)).toStrictEqual([40, 44, 48])
    expect(tapped.timed).toBe(true)
    expect(tapped).not.toHaveProperty('guessed')
  })

  it('setting the line’s start marks it timed', () => {
    const result = applyEdit(guessed(), { kind: 'lineTime', line: 0, start: 11 })
    expect(lineAt(result, 0).timed).toBe(true)
    expect(lineAt(result, 0)).not.toHaveProperty('guessed')
  })

  it('stays a guess while its start is still the guess: the times are kept for the editor', () => {
    const notTheStart: ColorEdit[] = [
      { kind: 'lineTime', line: 0, end: 30 },
      { kind: 'wordTime', line: 0, word: 1, start: 15 },
      { kind: 'wordTime', line: 0, word: 0, end: 13 },
      { kind: 'tapTime', line: 0, word: 1, start: 15 },
      { kind: 'tapTime', line: 0, word: 0, end: 13 }
    ]
    for (const edit of notTheStart) {
      const result = applyEdit(guessed(), edit)
      expect(result).not.toBe(guessed())
      expect(lineAt(result, 0)).not.toHaveProperty('timed')
      expect(lineAt(result, 0).guessed).toBe(true)
    }
    const ended = applyEdit(guessed(), { kind: 'lineTime', line: 0, end: 30 })
    expect(lineAt(ended, 0).end).toBe(30)
  })

  it('a second voice made from a guessed line, or added under one, is a guess too', () => {
    const made = applyEdit(guessed(), { kind: 'makeVoice', line: 0, from: 1, to: 2 })
    expect(lineAt(made, 1).guessed).toBe(true)
    const added = applyEdit(guessed(), { kind: 'addVoice', line: 0, text: 'la la' })
    expect(lineAt(added, 1).guessed).toBe(true)
    const heard = applyEdit(coding(), { kind: 'addVoice', line: 0, text: 'la la' })
    expect(lineAt(heard, 1)).not.toHaveProperty('guessed')
  })
})

describe('splitWord', () => {
  function oneWord(): SongColors {
    return coding({
      lines: [
        line({ text: '始まる', start: 10, end: 13, words: [word('始まる', 10, 13, ['miku'])] })
      ]
    })
  }

  it('splits 始まる at 2 into 始ま + る, sharing the time by length and keeping the singers', () => {
    const result = applyEdit(deepFreeze(oneWord()), { kind: 'splitWord', line: 0, word: 0, at: 2 })
    expect(lineAt(result, 0).words).toStrictEqual([
      word('始ま', 10, 12, ['miku']),
      word('る', 12, 13, ['miku'])
    ])
  })

  it('counts whole characters, not UTF-16 halves', () => {
    const start = coding({
      lines: [line({ text: '😀a', start: 0, end: 2, words: [word('😀a', 0, 2)] })]
    })
    const result = applyEdit(start, { kind: 'splitWord', line: 0, word: 0, at: 1 })
    expect(lineAt(result, 0).words.map((w) => w.text)).toStrictEqual(['😀', 'a'])
  })

  it('splits a word among others and leaves the rest', () => {
    const result = applyEdit(coding(), { kind: 'splitWord', line: 0, word: 1, at: 2 })
    expect(lineAt(result, 0).words.map((w) => w.text)).toStrictEqual([
      'hello ',
      'wo',
      'rld ',
      'today'
    ])
    // 6 characters (the space counts), a third of its 4 s in the first half.
    expect(wordAt(result, 0, 1).end).toBeCloseTo(14 + 4 / 3, 9)
    expect(wordAt(result, 0, 2).start).toBe(wordAt(result, 0, 1).end)
    expect(wordAt(result, 0, 2).end).toBe(18)
  })

  it('does not share singers between the halves', () => {
    const result = applyEdit(oneWord(), { kind: 'splitWord', line: 0, word: 0, at: 1 })
    expect(wordAt(result, 0, 0).singers).not.toBe(wordAt(result, 0, 1).singers)
  })

  it('does nothing unless the cut is strictly inside the word', () => {
    const start = oneWord()
    for (const at of [0, 3, 4, -1, 1.5, Number.NaN]) {
      expect(applyEdit(start, { kind: 'splitWord', line: 0, word: 0, at })).toBe(start)
    }
    expect(applyEdit(start, { kind: 'splitWord', line: 0, word: 1, at: 1 })).toBe(start)
    expect(applyEdit(start, { kind: 'splitWord', line: 1, word: 0, at: 1 })).toBe(start)
  })
})

describe('makeVoice', () => {
  function echoLine(): SongColors {
    return coding({
      lines: [
        line({
          text: 'hello (echo) world',
          start: 10,
          end: 22,
          words: [
            word('hello ', 10, 14, ['ichika']),
            word('(echo) ', 14, 18, ['saki']),
            word('world', 18, 22, ['ichika'])
          ]
        })
      ]
    })
  }

  it('moves the chosen words into a new line under the main one, with their own times', () => {
    const result = applyEdit(deepFreeze(echoLine()), {
      kind: 'makeVoice',
      line: 0,
      from: 1,
      to: 2
    })
    expect(result.lines).toHaveLength(2)
    const main = lineAt(result, 0)
    expect(main.words.map((w) => w.text)).toStrictEqual(['hello ', 'world'])
    // The line's own text is what the lyrics show, which is how it's found again.
    expect(main.text).toBe('hello (echo) world')
    expect(lineAt(result, 1)).toStrictEqual({
      text: 'echo',
      start: 14,
      end: 18,
      under: 0,
      words: [word('echo ', 14, 18, ['saki'])]
    })
  })

  it('strips one pair of brackets off the outer words of a longer selection', () => {
    const start = coding({
      lines: [
        line({
          text: 'go (oh yeah) now',
          words: [
            word('go ', 10, 12),
            word('(oh ', 12, 15),
            word('yeah) ', 15, 19),
            word('now', 19, 22)
          ]
        })
      ]
    })
    const result = applyEdit(start, { kind: 'makeVoice', line: 0, from: 1, to: 3 })
    expect(lineAt(result, 1).text).toBe('oh yeah')
    expect(lineAt(result, 1).words.map((w) => w.text)).toStrictEqual(['oh ', 'yeah '])
    expect([lineAt(result, 1).start, lineAt(result, 1).end]).toStrictEqual([12, 19])
  })

  it('strips full-width brackets too', () => {
    const start = coding({
      lines: [
        line({
          text: '君が（こだま）だよ',
          words: [word('君が', 10, 13), word('（こだま）', 13, 18), word('だよ', 18, 22)]
        })
      ]
    })
    const result = applyEdit(start, { kind: 'makeVoice', line: 0, from: 1, to: 2 })
    expect(lineAt(result, 1).text).toBe('こだま')
    expect(wordAt(result, 1, 0).text).toBe('こだま')
  })

  it('strips just one pair', () => {
    const start = coding({
      lines: [line({ text: '((x))', words: [word('((x))', 10, 14), word('y', 14, 16)] })]
    })
    const result = applyEdit(start, { kind: 'makeVoice', line: 0, from: 0, to: 1 })
    expect(lineAt(result, 1).text).toBe('(x)')
  })

  it('leaves brackets that are not one wrapped part alone', () => {
    const start = coding({
      lines: [
        line({
          text: '(a) and (b)',
          words: [word('(a) ', 10, 12), word('and ', 12, 14), word('(b)', 14, 18)]
        })
      ]
    })
    const result = applyEdit(start, { kind: 'makeVoice', line: 0, from: 0, to: 3 })
    expect(lineAt(result, 1).text).toBe('(a) and (b)')
    const plain = applyEdit(start, { kind: 'makeVoice', line: 0, from: 1, to: 2 })
    expect(lineAt(plain, 1).text).toBe('and')
  })

  it('does not strip brackets when nothing would be left', () => {
    const start = coding({
      lines: [line({ text: '() x', words: [word('()', 10, 12), word(' x', 12, 14)] })]
    })
    const result = applyEdit(start, { kind: 'makeVoice', line: 0, from: 0, to: 1 })
    expect(wordAt(result, 1, 0).text).toBe('()')
  })

  it('goes after the line and its voices, and later second voices keep their main line', () => {
    const start = coding({
      lines: [
        line({ text: 'A' }),
        line({ text: 'a1', under: 0, start: 11, end: 13, words: [word('a1', 11, 13)] }),
        line({ text: 'B', start: 30, end: 40, words: [word('b ', 30, 35), word('(c)', 35, 40)] }),
        line({ text: 'b1', under: 2, start: 31, end: 33, words: [word('b1', 31, 33)] })
      ]
    })
    const result = applyEdit(deepFreeze(start), { kind: 'makeVoice', line: 0, from: 1, to: 2 })
    expect(result.lines.map((l) => [l.text, l.under])).toStrictEqual([
      ['A', undefined],
      ['a1', 0],
      ['world', 0],
      ['B', undefined],
      ['b1', 3]
    ])
    const later = applyEdit(deepFreeze(start), { kind: 'makeVoice', line: 2, from: 1, to: 2 })
    expect(later.lines.map((l) => [l.text, l.under])).toStrictEqual([
      ['A', undefined],
      ['a1', 0],
      ['B', undefined],
      ['b1', 2],
      ['c', 2]
    ])
  })

  it("from a second voice, hangs the new one under that voice's main line", () => {
    const start = coding({
      lines: [
        line({ text: 'A' }),
        line({
          text: 'oh (yes) oh',
          under: 0,
          start: 11,
          end: 17,
          words: [word('oh ', 11, 12), word('(yes) ', 12, 15), word('oh', 15, 17)]
        })
      ]
    })
    const result = applyEdit(start, { kind: 'makeVoice', line: 1, from: 1, to: 2 })
    expect(result.lines.map((l) => [l.text, l.under])).toStrictEqual([
      ['A', undefined],
      ['oh (yes) oh', 0],
      ['yes', 0]
    ])
    expect(lineAt(result, 1).words.map((w) => w.text)).toStrictEqual(['oh ', 'oh'])
  })

  it('does nothing for a second voice picked whole, or a range that is not there', () => {
    const start = coding({
      lines: [
        line(),
        line({ text: 'echo', under: 0, start: 11, end: 13, words: [word('echo', 11, 13)] })
      ]
    })
    expect(applyEdit(start, { kind: 'makeVoice', line: 1, from: 0, to: 1 })).toBe(start)
    const bad: [number, number, number][] = [
      [4, 0, 1],
      [0, 2, 2],
      [0, 3, 1],
      [0, 0, 4],
      [0, -1, 1],
      [0, 0.5, 1]
    ]
    for (const [lineIndex, from, to] of bad) {
      expect(applyEdit(start, { kind: 'makeVoice', line: lineIndex, from, to })).toBe(start)
    }
  })
})

describe('addVoice', () => {
  it('adds a voice line under the line, its words split on spaces and timed across the main line', () => {
    const result = applyEdit(deepFreeze(coding()), {
      kind: 'addVoice',
      line: 0,
      text: 'la la laaa'
    })
    expect(result.lines).toHaveLength(2)
    const voice = lineAt(result, 1)
    expect(voice.under).toBe(0)
    expect(voice.text).toBe('la la laaa')
    expect(voice.words.map((w) => w.text)).toStrictEqual(['la ', 'la ', 'laaa'])
    expect(voice.words.map((w) => w.singers)).toStrictEqual([null, null, null])
    expect(voice.start).toBe(10)
    expect(voice.end).toBe(22)
    // Together they fill the main line's span, in order.
    expect(voice.words[0]?.start).toBe(10)
    expect(voice.words[2]?.end).toBe(22)
    for (let i = 1; i < voice.words.length; i++) {
      expect(wordAt(result, 1, i).start).toBeCloseTo(wordAt(result, 1, i - 1).end, 9)
    }
  })

  it("goes after the line's other voices and keeps later ones under their main lines", () => {
    const start = coding({
      lines: [
        line({ text: 'A' }),
        line({ text: 'a1', under: 0, start: 11, end: 13, words: [word('a1', 11, 13)] }),
        line({ text: 'B', start: 30, end: 40, words: [word('b', 30, 40)] }),
        line({ text: 'b1', under: 2, start: 31, end: 33, words: [word('b1', 31, 33)] })
      ]
    })
    const result = applyEdit(start, { kind: 'addVoice', line: 0, text: 'x' })
    expect(result.lines.map((l) => [l.text, l.under])).toStrictEqual([
      ['A', undefined],
      ['a1', 0],
      ['x', 0],
      ['B', undefined],
      ['b1', 3]
    ])
  })

  it('on a second voice attaches to its main line and its span', () => {
    const start = coding({
      lines: [
        line(),
        line({ text: 'echo', under: 0, start: 11, end: 13, words: [word('echo', 11, 13)] })
      ]
    })
    const result = applyEdit(start, { kind: 'addVoice', line: 1, text: 'yo' })
    expect(lineAt(result, 2).under).toBe(0)
    expect([lineAt(result, 2).start, lineAt(result, 2).end]).toStrictEqual([10, 22])
  })

  it('does nothing for blank words or a line that is not there', () => {
    const start = coding()
    expect(applyEdit(start, { kind: 'addVoice', line: 0, text: '' })).toBe(start)
    expect(applyEdit(start, { kind: 'addVoice', line: 0, text: '  \t ' })).toBe(start)
    expect(applyEdit(start, { kind: 'addVoice', line: 2, text: 'la' })).toBe(start)
    expect(applyEdit(start, { kind: 'addVoice', line: -1, text: 'la' })).toBe(start)
  })

  it('collapses extra spaces', () => {
    const result = applyEdit(coding(), { kind: 'addVoice', line: 0, text: '  oh   yeah ' })
    expect(lineAt(result, 1).text).toBe('oh yeah')
    expect(lineAt(result, 1).words.map((w) => w.text)).toStrictEqual(['oh ', 'yeah'])
  })
})

describe('setCast', () => {
  it('keeps the known ids once each, in the order given', () => {
    const start = coding({ extra: [{ id: 'extra:guest', name: 'Guest', color: '#112233' }] })
    const result = applyEdit(start, {
      kind: 'setCast',
      cast: ['miku', 'extra:guest', 'nobody', 'miku', 'rin', 'extra:ghost']
    })
    expect(result.cast).toStrictEqual(['miku', 'extra:guest', 'rin'])
  })

  it('hands back the same coding when the cast is already that', () => {
    const start = coding()
    expect(applyEdit(start, { kind: 'setCast', cast: ['ichika', 'saki'] })).toBe(start)
    expect(applyEdit(start, { kind: 'setCast', cast: ['ichika', 'saki', 'zzz'] })).toBe(start)
  })

  it('can empty the cast', () => {
    expect(applyEdit(coding(), { kind: 'setCast', cast: [] }).cast).toStrictEqual([])
  })
})

describe('addSinger', () => {
  it('gives the id extra:<slug> of the name', () => {
    const result = applyEdit(deepFreeze(coding()), {
      kind: 'addSinger',
      name: ' Guest Star! ',
      color: '#A1B2C3'
    })
    expect(result.extra).toStrictEqual([
      { id: 'extra:guest-star', name: 'Guest Star!', color: '#A1B2C3' }
    ])
  })

  it('numbers a slug that is taken', () => {
    let result = coding()
    for (const name of ['A B', 'a-b', 'A_B']) {
      result = applyEdit(result, { kind: 'addSinger', name, color: '#112233' })
    }
    expect(result.extra.map((s) => s.id)).toStrictEqual(['extra:a-b', 'extra:a-b-2', 'extra:a-b-3'])
  })

  it('numbers a name with no letters or digits an id of its own can be made from', () => {
    let result = coding()
    for (const name of ['初音ミク', '鏡音レン', '★']) {
      result = applyEdit(result, { kind: 'addSinger', name, color: '#112233' })
    }
    expect(result.extra.map((s) => s.id)).toStrictEqual([
      'extra:singer-1',
      'extra:singer-2',
      'extra:singer-3'
    ])
  })

  it('does not add a name twice, whatever its case', () => {
    const start = applyEdit(coding(), { kind: 'addSinger', name: 'Guest', color: '#112233' })
    expect(applyEdit(start, { kind: 'addSinger', name: ' GUEST ', color: '#445566' })).toBe(start)
  })

  it('does not add a built-in character again', () => {
    const start = coding()
    expect(applyEdit(start, { kind: 'addSinger', name: 'ichika', color: '#112233' })).toBe(start)
  })

  it('does nothing for a blank name or a color that is not #RRGGBB', () => {
    const start = coding()
    for (const name of ['', '   ', '\n']) {
      expect(applyEdit(start, { kind: 'addSinger', name, color: '#112233' })).toBe(start)
    }
    for (const color of ['', 'red', '#fff', '#12345', '#1234567', '112233', '#GGGGGG']) {
      expect(applyEdit(start, { kind: 'addSinger', name: 'Guest', color })).toBe(start)
    }
  })

  it('cuts a long name to the limit by whole characters', () => {
    const name = '歌'.repeat(MAX_SINGER_NAME + 20)
    const result = applyEdit(coding(), { kind: 'addSinger', name, color: '#112233' })
    expect(Array.from(result.extra[0]?.name ?? '')).toHaveLength(MAX_SINGER_NAME)
  })

  it('can then be given words', () => {
    const added = applyEdit(coding(), { kind: 'addSinger', name: 'Guest', color: '#112233' })
    const result = applyEdit(added, {
      kind: 'assign',
      line: 0,
      from: 0,
      to: 1,
      singers: ['extra:guest']
    })
    expect(wordAt(result, 0, 0).singers).toStrictEqual(['extra:guest'])
  })
})

describe('romajiSplits', () => {
  it('sorts the points, drops repeats, and drops what is not an offset', () => {
    const result = applyEdit(deepFreeze(coding()), {
      kind: 'romajiSplits',
      line: 0,
      splits: [9, 3, 3, -1, 2.5, Number.NaN, 0]
    })
    expect(lineAt(result, 0).romajiSplits).toStrictEqual([0, 3, 9])
  })

  it('removes them with null', () => {
    const start = coding({ lines: [line({ romajiSplits: [4] })] })
    const result = applyEdit(start, { kind: 'romajiSplits', line: 0, splits: null })
    expect('romajiSplits' in lineAt(result, 0)).toBe(false)
  })

  it('hands back the same coding when there is nothing to change', () => {
    const start = coding({ lines: [line({ romajiSplits: [4] })] })
    expect(applyEdit(start, { kind: 'romajiSplits', line: 0, splits: [4] })).toBe(start)
    const plain = coding()
    expect(applyEdit(plain, { kind: 'romajiSplits', line: 0, splits: null })).toBe(plain)
    expect(applyEdit(start, { kind: 'romajiSplits', line: 1, splits: [1] })).toBe(start)
  })
})

describe('every result is a coding the parser would keep as it is', () => {
  const known = (id: string): boolean => castSinger(id) !== undefined

  const withVoice = coding({
    lines: [
      line({
        text: 'hello (echo) world',
        words: [word('hello ', 10, 14), word('(echo) ', 14, 18), word('world', 18, 22)]
      }),
      line({ text: 'oh', under: 0, start: 12, end: 14, words: [word('oh', 12, 14)] }),
      line({ text: '始まる', start: 30, end: 33, words: [word('始まる', 30, 33, ['miku'])] })
    ]
  })

  const cases: [string, SongColors, ColorEdit][] = [
    ['assign', coding(), { kind: 'assign', line: 0, from: 0, to: 2, singers: ['ichika', 'saki'] }],
    ['assign everyone', coding(), { kind: 'assign', line: 0, from: 0, to: 3, singers: 'everyone' }],
    ['assign clear', coding(), { kind: 'assign', line: 0, from: 0, to: 3, singers: null }],
    ['assign on a voice', withVoice, { kind: 'assign', line: 1, from: 0, to: 1, singers: ['rin'] }],
    ['lineTime shrink', coding(), { kind: 'lineTime', line: 0, start: 15, end: 19 }],
    ['lineTime grow', coding(), { kind: 'lineTime', line: 0, start: 1, end: 40 }],
    ['wordTime start', coding(), { kind: 'wordTime', line: 0, word: 1, start: 12 }],
    ['wordTime past next', coding(), { kind: 'wordTime', line: 0, word: 0, start: 20 }],
    ['wordTime end', coding(), { kind: 'wordTime', line: 0, word: 0, end: 50 }],
    ['tapTime late', coding(), { kind: 'tapTime', line: 0, word: 0, start: 16 }],
    ['tapTime early', coding(), { kind: 'tapTime', line: 0, word: 0, start: 2 }],
    ['tapTime held', coding(), { kind: 'tapTime', line: 0, word: 1, end: 40 }],
    [
      'newWords',
      coding(),
      {
        kind: 'newWords',
        line: 0,
        shown: {
          text: 'hello  world',
          start: 1,
          end: 3,
          words: [{ text: 'hello  world', start: 1, end: 3 }]
        }
      }
    ],
    [
      'addLine with an edit',
      withVoice,
      {
        kind: 'addLine',
        at: 2,
        shown: {
          text: 'x y',
          start: 25,
          end: 28,
          words: [
            { text: 'x ', start: 25, end: 26 },
            { text: 'y', start: 26, end: 28 }
          ],
          timed: true
        },
        then: { kind: 'makeVoice', line: 2, from: 1, to: 2 }
      }
    ],
    ['splitWord', withVoice, { kind: 'splitWord', line: 2, word: 0, at: 2 }],
    ['makeVoice', withVoice, { kind: 'makeVoice', line: 0, from: 1, to: 2 }],
    ['makeVoice on a later line', withVoice, { kind: 'makeVoice', line: 2, from: 0, to: 1 }],
    ['addVoice', withVoice, { kind: 'addVoice', line: 0, text: 'la la' }],
    ['addVoice on a later line', withVoice, { kind: 'addVoice', line: 2, text: 'la la' }],
    ['setCast', coding(), { kind: 'setCast', cast: ['miku', 'rin', 'bogus'] }],
    ['addSinger', coding(), { kind: 'addSinger', name: 'Guest', color: '#abcdef' }],
    ['romajiSplits', coding(), { kind: 'romajiSplits', line: 0, splits: [8, 3, 3] }],
    [
      'heardTimes',
      withVoice,
      {
        kind: 'heardTimes',
        lines: [
          {
            line: 2,
            start: 29,
            end: 31,
            words: [{ start: 28, end: 32 }]
          },
          {
            line: 0,
            start: 9,
            end: 21,
            words: [
              { start: 9, end: 12 },
              { start: 13, end: 12 },
              { start: 15, end: 21 }
            ]
          }
        ]
      }
    ],
    [
      'romajiSplits cleared',
      coding({ lines: [line({ romajiSplits: [2] })] }),
      { kind: 'romajiSplits', line: 0, splits: null }
    ]
  ]

  for (const [name, start, edit] of cases) {
    it(name, () => {
      expect(parseSongColors(start, known)).toStrictEqual(start)
      const result = applyEdit(deepFreeze(structuredClone(start)), edit)
      expect(result).not.toBe(start)
      expect(parseSongColors(result, known)).toStrictEqual(result)
    })
  }

  it('after a run of edits one on another', () => {
    const edits: ColorEdit[] = [
      { kind: 'addSinger', name: 'Guest', color: '#123456' },
      { kind: 'setCast', cast: ['ichika', 'extra:guest'] },
      { kind: 'splitWord', line: 0, word: 1, at: 2 },
      { kind: 'assign', line: 0, from: 0, to: 4, singers: 'everyone' },
      { kind: 'makeVoice', line: 0, from: 1, to: 3 },
      { kind: 'addVoice', line: 0, text: 'ha ha' },
      { kind: 'lineTime', line: 0, start: 11, end: 20 },
      { kind: 'wordTime', line: 0, word: 0, start: 12, end: 13 }
    ]
    let result = coding()
    for (const edit of edits) {
      result = applyEdit(result, edit)
      expect(parseSongColors(result, known)).toStrictEqual(result)
    }
    expect(result.lines).toHaveLength(3)
  })
})

describe('createEditHistory', () => {
  const recolor = (singer: string): ColorEdit => ({
    kind: 'assign',
    line: 0,
    from: 0,
    to: 3,
    singers: [singer]
  })

  it('starts where it was given, with nothing to undo or redo', () => {
    const start = coding()
    const history = createEditHistory(start)
    expect(history.now()).toBe(start)
    expect(history.canUndo()).toBe(false)
    expect(history.canRedo()).toBe(false)
    expect(history.undo()).toBeNull()
    expect(history.redo()).toBeNull()
  })

  it('gives the start back on undo and the edit again on redo', () => {
    const start = coding()
    const history = createEditHistory(start)
    const edited = history.apply(recolor('miku'))
    expect(edited).not.toBe(start)
    expect(history.now()).toBe(edited)
    expect(history.canUndo()).toBe(true)

    expect(history.undo()).toBe(start)
    expect(history.now()).toBe(start)
    expect(history.canUndo()).toBe(false)
    expect(history.canRedo()).toBe(true)

    expect(history.redo()).toBe(edited)
    expect(history.now()).toBe(edited)
    expect(history.canRedo()).toBe(false)
    expect(history.redo()).toBeNull()
  })

  it('walks back through several edits', () => {
    const start = coding()
    const history = createEditHistory(start)
    const one = history.apply(recolor('miku'))
    const two = history.apply(recolor('rin'))
    expect(history.undo()).toBe(one)
    expect(history.undo()).toBe(start)
    expect(history.undo()).toBeNull()
    expect(history.redo()).toBe(one)
    expect(history.redo()).toBe(two)
  })

  it('forgets the redo list on a new edit', () => {
    const history = createEditHistory(coding())
    history.apply(recolor('miku'))
    history.undo()
    expect(history.canRedo()).toBe(true)
    history.apply(recolor('rin'))
    expect(history.canRedo()).toBe(false)
    expect(history.redo()).toBeNull()
  })

  it('does not keep an edit that changed nothing', () => {
    const start = coding()
    const history = createEditHistory(start)
    expect(history.apply({ kind: 'lineTime', line: 9, start: 1 })).toBe(start)
    expect(history.apply({ kind: 'assign', line: 0, from: 0, to: 1, singers: ['ichika'] })).toBe(
      start
    )
    expect(history.canUndo()).toBe(false)
    // A no-op doesn't clear what could be redone, either.
    history.apply(recolor('miku'))
    history.undo()
    history.apply({ kind: 'lineTime', line: 9, start: 1 })
    expect(history.canRedo()).toBe(true)
  })

  it('keeps at most the limit, dropping the oldest', () => {
    const history = createEditHistory(coding(), 3)
    const singers = ['miku', 'rin', 'len', 'luka', 'meiko']
    for (const singer of singers) history.apply(recolor(singer))
    let steps = 0
    while (history.undo()) steps++
    expect(steps).toBe(3)
    // The oldest state still reachable is the one after the first two edits.
    expect(wordAt(history.now(), 0, 0).singers).toStrictEqual(['rin'])
  })

  it('keeps 200 by default', () => {
    const history = createEditHistory(coding())
    for (let i = 0; i < 250; i++) history.apply({ kind: 'romajiSplits', line: 0, splits: [i] })
    let steps = 0
    while (history.undo()) steps++
    expect(steps).toBe(200)
  })
})

describe('addBreak', () => {
  const two = (): SongColors =>
    coding({
      lines: [
        line(),
        line({ text: 'echo', under: 0, words: [word('echo', 12, 13)] }),
        line({ start: 40, end: 44, words: [word('hello world today', 40, 44)] })
      ]
    })

  it('puts a music break in at `at`: no words, added, its times a guess', () => {
    const start = deepFreeze(two())
    const result = applyEdit(start, { kind: 'addBreak', at: 2, start: 25, end: 40 })
    expect(lineAt(result, 2)).toEqual({
      text: '',
      start: 25,
      end: 40,
      words: [],
      added: true,
      guessed: true,
      instrumental: true
    })
    expect(result.lines).toHaveLength(4)
    // The voice still sits under its line.
    expect(lineAt(result, 1).under).toBe(0)
  })

  it('re-points second voices below the break', () => {
    const start = coding({
      lines: [
        line(),
        line({ start: 40, end: 44 }),
        line({ text: 'echo', under: 1, words: [word('echo', 41, 42)] })
      ]
    })
    const result = applyEdit(start, { kind: 'addBreak', at: 1, start: 25, end: 40 })
    expect(lineAt(result, 3).under).toBe(2)
  })

  it('refuses a place inside a line’s voices, or times that aren’t a span', () => {
    const start = two()
    expect(applyEdit(start, { kind: 'addBreak', at: 1, start: 25, end: 40 })).toBe(start)
    expect(applyEdit(start, { kind: 'addBreak', at: 9, start: 25, end: 40 })).toBe(start)
    expect(applyEdit(start, { kind: 'addBreak', at: 2, start: 30, end: 30 })).toBe(start)
    expect(applyEdit(start, { kind: 'addBreak', at: 2, start: -1, end: 30 })).toBe(start)
  })

  it('takes no words, voices or retyping on a break; it’s removed like an added line', () => {
    const start = applyEdit(two(), { kind: 'addBreak', at: 2, start: 25, end: 40 })
    expect(applyEdit(start, { kind: 'addVoice', line: 2, text: 'ooh' })).toBe(start)
    expect(
      applyEdit(start, {
        kind: 'retype',
        line: 2,
        shown: { text: 'la', start: 25, end: 40, words: [{ text: 'la', start: 25, end: 40 }] }
      })
    ).toBe(start)
    expect(applyEdit(start, { kind: 'removeLine', line: 2 }).lines).toHaveLength(3)
  })

  it('reads back from the file, and a break mark on a line with words is dropped', () => {
    const start = applyEdit(two(), { kind: 'addBreak', at: 2, start: 25, end: 40 })
    expect(
      parseSongColors(JSON.parse(JSON.stringify(start)), (id) => castSinger(id) !== undefined)
    ).toEqual(start)
    const odd = JSON.parse(JSON.stringify(two())) as { lines: Record<string, unknown>[] }
    odd.lines[2] = { ...odd.lines[2], added: true, instrumental: true }
    expect(
      parseSongColors(odd, (id) => castSinger(id) !== undefined)?.lines[2]?.instrumental
    ).toBeUndefined()
  })
})
