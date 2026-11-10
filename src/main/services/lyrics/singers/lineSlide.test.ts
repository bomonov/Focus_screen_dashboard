import { describe, expect, it } from 'vitest'
import { applyEdit } from './edit'
import { slideTo } from './lineSlide'
import type { CodedLine, CodedWord, ShownLine, SongColors } from './types'

function word(
  text: string,
  start: number,
  end: number,
  singers: string[] | null = null
): CodedWord {
  return { text, start, end, singers }
}

/** A two-word line from `start`, 4 s long, its words 2 s each. */
function line(text: string, start: number, over: Partial<CodedLine> = {}): CodedLine {
  const [a = '', b = ''] = text.split(' ')
  return {
    text,
    start,
    end: start + 4,
    words: [word(`${a} `, start, start + 2, ['ichika']), word(b, start + 2, start + 4)],
    timed: true,
    ...over
  }
}

function coding(lines: CodedLine[]): SongColors {
  return { version: 1, lines, cast: ['ichika'], extra: [] }
}

/** Frozen all the way down, so an edit that changed its input would throw. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}

const at = (colors: SongColors, i: number): CodedLine => {
  const found = colors.lines[i]
  if (!found) throw new Error(`no line ${i}`)
  return found
}

describe('slideLine', () => {
  it('moves a line whole, its words and second voices along, and makes it timed', () => {
    const start = deepFreeze(
      coding([
        line('a b', 10),
        line('c d', 20, { guessed: true, timed: undefined }),
        line('echo e', 21, { under: 1, guessed: true, timed: undefined }),
        line('f g', 40)
      ])
    )
    const result = applyEdit(start, { kind: 'slideLine', line: 1, start: 25, songEnd: 200 })
    expect(at(result, 1)).toMatchObject({ start: 25, end: 29, timed: true })
    expect(at(result, 1).guessed).toBeUndefined()
    expect(at(result, 1).words.map((w) => [w.start, w.end])).toEqual([
      [25, 27],
      [27, 29]
    ])
    // Singers stay on their words.
    expect(at(result, 1).words[0]?.singers).toEqual(['ichika'])
    // The second voice keeps its distance from its line.
    expect(at(result, 2)).toMatchObject({ start: 26, end: 30, under: 1 })
  })

  it('keeps a line that came with the lyrics between the lines either side of it', () => {
    const start = coding([line('a b', 10), line('c d', 20), line('f g', 30)])
    expect(at(applyEdit(start, { kind: 'slideLine', line: 1, start: 2 }), 1).start).toBeCloseTo(
      10.05
    )
    expect(at(applyEdit(start, { kind: 'slideLine', line: 1, start: 50 }), 1).start).toBeCloseTo(
      29.95
    )
  })

  it('lets a line pass neighbours whose times are only guesses (plain lyrics)', () => {
    const guess = { guessed: true as const, timed: undefined }
    const start = coding([line('a b', 10, guess), line('c d', 20, guess), line('f g', 30, guess)])
    expect(at(applyEdit(start, { kind: 'slideLine', line: 1, start: 45 }), 1).start).toBe(45)
    // A real time still holds it.
    const mixed = coding([line('a b', 10), line('c d', 20, guess), line('f g', 30, guess)])
    expect(at(applyEdit(mixed, { kind: 'slideLine', line: 1, start: 5 }), 1).start).toBeCloseTo(
      10.05
    )
  })

  it('lets a line the user added go past others, taking its place by its new start', () => {
    const start = deepFreeze(
      coding([
        line('a b', 10),
        line('new one', 12, { added: true }),
        line('c d', 20),
        line('echo e', 21, { under: 2 }),
        line('f g', 30)
      ])
    )
    const result = applyEdit(start, { kind: 'slideLine', line: 1, start: 25 })
    expect(result.lines.map((l) => l.text)).toEqual(['a b', 'c d', 'echo e', 'new one', 'f g'])
    // The voice still points at its own line, which moved up one place.
    expect(at(result, 2).under).toBe(1)
    expect(at(result, 3)).toMatchObject({ start: 25, added: true, timed: true })
  })

  it('keeps the line inside the song, its length kept', () => {
    const start = coding([line('new one', 50, { added: true })])
    expect(at(applyEdit(start, { kind: 'slideLine', line: 0, start: -5 }), 0)).toMatchObject({
      start: 0,
      end: 4
    })
    expect(
      at(applyEdit(start, { kind: 'slideLine', line: 0, start: 99, songEnd: 100 }), 0)
    ).toMatchObject({ start: 96, end: 100 })
  })

  it('leaves the coding as it was for a second voice, a line not there, or no move', () => {
    const start = coding([line('a b', 10), line('echo e', 11, { under: 0 })])
    expect(applyEdit(start, { kind: 'slideLine', line: 1, start: 30 })).toBe(start)
    expect(applyEdit(start, { kind: 'slideLine', line: 7, start: 30 })).toBe(start)
    expect(applyEdit(start, { kind: 'slideLine', line: 0, start: 10 })).toBe(start)
    expect(applyEdit(start, { kind: 'slideLine', line: 0, start: Number.NaN })).toBe(start)
  })
})

describe('slideTo', () => {
  it('is the line as it would land, for the waveform to draw while it is dragged', () => {
    const start = coding([line('a b', 10), line('c d', 20), line('f g', 30)])
    expect(slideTo(start, 1, 60, 200)?.start).toBeCloseTo(29.95)
    expect(slideTo(start, 1, 60, 200)?.words[0]?.start).toBeCloseTo(29.95)
    expect(slideTo(start, 1, 60, 200)?.timed).toBe(true)
    expect(slideTo(start, 5, 60, 200)).toBeNull()
  })
})

describe('resetTimes', () => {
  const shown: ShownLine = {
    text: 'c d',
    start: 40,
    end: 48,
    words: [
      { text: 'c ', start: 40, end: 44 },
      { text: 'd', start: 44, end: 48 }
    ],
    timed: true
  }

  it('puts a line that came with the lyrics back on their time, its words and singers kept', () => {
    const start = deepFreeze(
      coding([
        line('c d', 20, {
          words: [word('c ', 20, 21, ['ichika']), word('d', 21, 24, ['saki'])]
        }),
        line('echo e', 22, { under: 0 })
      ])
    )
    const result = applyEdit(start, { kind: 'resetTimes', line: 0, shown })
    expect(at(result, 0)).toMatchObject({ start: 40, end: 48, timed: true })
    // Each word keeps its share of the line, and its singers.
    expect(at(result, 0).words.map((w) => [w.start, w.end, w.singers])).toEqual([
      [40, 42, ['ichika']],
      [42, 48, ['saki']]
    ])
    // Its second voice goes along with it.
    expect(at(result, 1)).toMatchObject({ start: 42, end: 46 })
  })

  it('takes the lyrics’ own mark: a guess for plain lyrics, neither for auto-sync’s', () => {
    const start = coding([line('c d', 20)])
    const plain = applyEdit(start, {
      kind: 'resetTimes',
      line: 0,
      shown: { ...shown, timed: undefined, guessed: true }
    })
    expect(at(plain, 0)).toMatchObject({ guessed: true })
    expect(at(plain, 0).timed).toBeUndefined()
    const heard = applyEdit(start, {
      kind: 'resetTimes',
      line: 0,
      shown: { ...shown, timed: undefined }
    })
    expect(at(heard, 0).timed).toBeUndefined()
    expect(at(heard, 0).guessed).toBeUndefined()
  })

  it('only takes back a line of the lyrics’ own, with the same words', () => {
    const start = coding([
      line('c d', 20),
      line('c d', 30, { added: true }),
      line('c d', 31, { under: 0 })
    ])
    expect(applyEdit(start, { kind: 'resetTimes', line: 1, shown })).toBe(start)
    expect(applyEdit(start, { kind: 'resetTimes', line: 2, shown })).toBe(start)
    expect(
      applyEdit(start, {
        kind: 'resetTimes',
        line: 0,
        shown: { ...shown, text: 'c e', words: [{ text: 'c e', start: 40, end: 48 }] }
      })
    ).toBe(start)
  })
})
