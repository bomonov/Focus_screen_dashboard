import { describe, expect, it } from 'vitest'
import { castSinger } from './cast'
import { MAX_SINGER_NAME, parseSongColors } from './parse'
import type { CodedLine, SongColors } from './types'

const known = (id: string): boolean => castSinger(id) !== undefined

function line(over: Partial<CodedLine> = {}): CodedLine {
  return {
    text: 'hello world',
    start: 10,
    end: 20,
    words: [
      { text: 'hello ', start: 10, end: 14, singers: ['ichika'] },
      { text: 'world', start: 14, end: 20, singers: ['ichika'] }
    ],
    ...over
  }
}

function coding(over: Partial<SongColors> = {}): SongColors {
  return { version: 1, lines: [line()], cast: ['ichika', 'saki'], extra: [], ...over }
}

/** What a saved file looks like once it's been through the disk. */
function viaDisk(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

describe('parseSongColors', () => {
  it('keeps a line marked timed by the user, and only a mark that is true', () => {
    const timed = coding({ lines: [line({ timed: true })] })
    expect(parseSongColors(viaDisk(timed), known)).toStrictEqual(timed)
    for (const mark of [false, 'yes', 1, null]) {
      const parsed = parseSongColors({ ...coding(), lines: [{ ...line(), timed: mark }] }, known)
      expect(parsed?.lines[0]).toStrictEqual(line())
    }
  })

  it('keeps the added mark on a main line, drops it on a second voice', () => {
    const added = coding({
      lines: [
        line({ added: true, guessed: true }),
        line({ added: true, guessed: true, under: 0 }),
        line()
      ]
    })
    const parsed = parseSongColors(viaDisk(added), known)
    expect(parsed?.lines[0]?.added).toBe(true)
    expect(parsed?.lines[1]?.under).toBe(0)
    expect(parsed?.lines[1]).not.toHaveProperty('added')
    expect(parsed?.lines[2]).not.toHaveProperty('added')
    const odd = parseSongColors(
      viaDisk({ ...coding(), lines: [{ ...line(), added: 'yes' }] }),
      known
    )
    expect(odd?.lines[0]).not.toHaveProperty('added')
  })

  it('keeps a line marked guessed, and only a mark that is true on a line not timed', () => {
    const guessed = coding({ lines: [line({ guessed: true })] })
    expect(parseSongColors(viaDisk(guessed), known)).toStrictEqual(guessed)
    for (const mark of [false, 'yes', 1, null]) {
      const parsed = parseSongColors({ ...coding(), lines: [{ ...line(), guessed: mark }] }, known)
      expect(parsed?.lines[0]).toStrictEqual(line())
    }
    // Both can't be true: a line with times set isn't a guess.
    const both = parseSongColors(
      { ...coding(), lines: [{ ...line(), timed: true, guessed: true }] },
      known
    )
    expect(both?.lines[0]).toStrictEqual(line({ timed: true }))
  })

  it('reads back what it would write', () => {
    const written: SongColors = {
      version: 1,
      cast: ['ichika', 'saki', 'extra:guest'],
      extra: [{ id: 'extra:guest', name: 'Guest', color: '#12AB34' }],
      lines: [
        {
          text: 'hello world again',
          start: 10,
          end: 22.5,
          romajiSplits: [6],
          words: [
            { text: 'hello ', start: 10, end: 14, singers: ['ichika', 'saki'] },
            { text: 'world ', start: 14, end: 18, singers: 'everyone' },
            { text: 'again', start: 18, end: 22.5, singers: null }
          ]
        },
        {
          text: '(oh)',
          start: 15,
          end: 17,
          under: 0,
          words: [{ text: '(oh)', start: 15, end: 17, singers: ['extra:guest'] }]
        }
      ]
    }
    expect(parseSongColors(viaDisk(written), known)).toStrictEqual(written)
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'colors'],
    ['a number', 7],
    ['an array', [coding()]],
    ['another version', { ...coding(), version: 2 }],
    ['no version', { lines: [], cast: [], extra: [] }],
    ['lines that is not an array', { ...coding(), lines: { 0: line() } }],
    ['no lines', { version: 1, cast: [], extra: [] }],
    ['a line that ends before it starts', coding({ lines: [line({ start: 20, end: 10 })] })]
  ])('is null for %s', (_name, raw) => {
    expect(parseSongColors(viaDisk(raw), known)).toBeNull()
  })

  it('takes a line that starts and ends together', () => {
    const lines = [line({ start: 10, end: 10, words: [] })]
    expect(parseSongColors(viaDisk(coding({ lines })), known)?.lines).toEqual(lines)
  })

  it('drops unknown singer ids', () => {
    const lines = [
      line({
        words: [
          { text: 'a ', start: 10, end: 12, singers: ['ichika', 'nobody'] },
          { text: 'b ', start: 12, end: 14, singers: ['nobody'] },
          { text: 'c', start: 14, end: 16, singers: ['saki', 'ichika'] }
        ]
      })
    ]
    const parsed = parseSongColors(viaDisk(coding({ lines })), known)
    expect(parsed?.lines[0]?.words.map((w) => w.singers)).toEqual([
      ['ichika'],
      null,
      ['saki', 'ichika']
    ])
  })

  it('never takes inherited property names for singers', () => {
    const lines = [
      line({ words: [{ text: 'a', start: 10, end: 12, singers: ['constructor', '__proto__'] }] })
    ]
    const parsed = parseSongColors(viaDisk(coding({ lines })), known)
    expect(parsed?.lines[0]?.words[0]?.singers).toBeNull()
  })

  it('takes "everyone" as the only non-array singers, and makes anything else nobody', () => {
    const word = (singers: unknown): unknown => ({ text: 'a', start: 10, end: 12, singers })
    const raw = {
      ...coding(),
      lines: [
        {
          ...line(),
          words: [
            word('everyone'),
            word('Everyone'),
            word('ichika'),
            word(7),
            word([]),
            word({ 0: 'ichika' }),
            word(undefined),
            word([3, null, 'saki', 'saki', 'ichika'])
          ]
        }
      ]
    }
    expect(parseSongColors(viaDisk(raw), known)?.lines[0]?.words.map((w) => w.singers)).toEqual([
      'everyone',
      null,
      null,
      null,
      null,
      null,
      null,
      ['saki', 'ichika']
    ])
  })

  it('drops a second voice whose under is not an earlier main line', () => {
    const voice = (under: unknown): unknown => ({ ...line({ text: 'voice' }), under })
    const main = line()
    // Indexes: 0 main, 1 voice under 0 (good), then five bad ones, then a voice under a voice.
    const raw = {
      ...coding(),
      lines: [
        main,
        voice(0),
        voice(2), // itself
        voice(5), // a later line
        voice(-1),
        voice(0.5),
        voice('0'),
        voice(1) // a voice, not a main line
      ]
    }
    const parsed = parseSongColors(viaDisk(raw), known)
    expect(parsed?.lines.map((l) => l.text)).toEqual(['hello world', 'voice'])
    expect(parsed?.lines[1]?.under).toBe(0)
  })

  it('keeps under pointing at the same main line when a bad line before it is dropped', () => {
    const raw = {
      ...coding(),
      lines: [
        line({ text: 'first' }),
        { ...line({ text: 'broken' }), start: 'soon' },
        line({ text: 'second' }),
        line({ text: 'voice of second', under: 2 })
      ]
    }
    const parsed = parseSongColors(viaDisk(raw), known)
    expect(parsed?.lines.map((l) => l.text)).toEqual(['first', 'second', 'voice of second'])
    expect(parsed?.lines[2]?.under).toBe(1)
  })

  it('drops a second voice along with the main line it sat under', () => {
    const raw = {
      ...coding(),
      lines: [
        line({ text: 'first' }),
        { ...line({ text: 'broken' }), words: 'none' },
        line({ text: 'voice of broken', under: 1 }),
        line({ text: 'last' })
      ]
    }
    const parsed = parseSongColors(viaDisk(raw), known)
    expect(parsed?.lines.map((l) => l.text)).toEqual(['first', 'last'])
  })

  it('keeps word times inside their line and in order', () => {
    const lines = [
      line({
        start: 10,
        end: 20,
        words: [
          { text: 'a ', start: 8, end: 12, singers: null }, // before the line
          { text: 'b ', start: 11, end: 13, singers: null }, // fine as it is
          { text: 'c ', start: 15, end: 14, singers: null }, // ends before it starts
          { text: 'd ', start: 16, end: 99, singers: null }, // ends after the line
          { text: 'e', start: 25, end: 30, singers: null } // starts after the line
        ]
      })
    ]
    const parsed = parseSongColors(viaDisk(coding({ lines })), known)
    expect(parsed?.lines[0]?.words.map((w) => [w.start, w.end])).toEqual([
      [10, 12],
      [11, 13],
      [15, 15],
      [16, 20],
      [20, 20]
    ])
  })

  it('clamps a word that starts before the one before it', () => {
    const lines = [
      line({
        words: [
          { text: 'a ', start: 15, end: 16, singers: null },
          { text: 'b', start: 12, end: 18, singers: null }
        ]
      })
    ]
    const parsed = parseSongColors(viaDisk(coding({ lines })), known)
    expect(parsed?.lines[0]?.words.map((w) => [w.start, w.end])).toEqual([
      [15, 16],
      [15, 18]
    ])
  })

  it('drops a line with a time that is not a number of seconds', () => {
    const bad = (words: unknown, start: unknown = 10, end: unknown = 20): unknown => ({
      ...line({ text: 'bad' }),
      start,
      end,
      words
    })
    const raw = {
      ...coding(),
      lines: [
        line({ text: 'good' }),
        bad([], -1),
        bad([], 10, '20'),
        bad([], 10, null),
        bad([{ text: 'x', start: 'now', end: 12, singers: null }]),
        bad([{ text: 'x', start: 11, end: -2, singers: null }]),
        bad([{ text: 5, start: 11, end: 12, singers: null }]),
        bad([null]),
        'not a line',
        null
      ]
    }
    const parsed = parseSongColors(viaDisk(raw), known)
    expect(parsed?.lines.map((l) => l.text)).toEqual(['good'])
  })

  it('rejects an extra singer with a bad color, and its uses with it', () => {
    const lines = [
      line({
        words: [
          { text: 'a ', start: 10, end: 12, singers: ['extra:bad', 'ichika'] },
          { text: 'b ', start: 12, end: 14, singers: ['extra:bad'] },
          { text: 'c', start: 14, end: 16, singers: ['extra:ok'] }
        ]
      })
    ]
    const raw = viaDisk(
      coding({
        lines,
        cast: ['ichika', 'extra:bad', 'extra:ok'],
        extra: [
          { id: 'extra:bad', name: 'Bad', color: 'red' },
          { id: 'extra:ok', name: 'Okay', color: '#aabbcc' }
        ]
      })
    )
    const parsed = parseSongColors(raw, known)
    expect(parsed?.extra).toEqual([{ id: 'extra:ok', name: 'Okay', color: '#aabbcc' }])
    expect(parsed?.cast).toEqual(['ichika', 'extra:ok'])
    expect(parsed?.lines[0]?.words.map((w) => w.singers)).toEqual([['ichika'], null, ['extra:ok']])
  })

  it.each(['red', '#fff', '#12345', '#1234567', '#12345G', '123456', ' #123456', '', 7, null])(
    'does not take %j as a color',
    (color) => {
      const raw = viaDisk(coding({ extra: [{ id: 'extra:a', name: 'A', color: color as string }] }))
      expect(parseSongColors(raw, known)?.extra).toEqual([])
    }
  )

  it('takes an extra singer only with an id of its own kind, a name and no repeat', () => {
    const raw = viaDisk(
      coding({
        extra: [
          { id: 'ichika', name: 'Imposter', color: '#123456' }, // would shadow a character
          { id: 'extra:', name: 'Nobody', color: '#123456' },
          { id: 'extra:blank', name: '   ', color: '#123456' },
          { id: 'extra:a', name: 'First', color: '#111111' },
          { id: 'extra:a', name: 'Again', color: '#222222' },
          { id: 'extra:b', name: 'B', color: '#333333' }
        ]
      })
    )
    expect(parseSongColors(raw, known)?.extra).toEqual([
      { id: 'extra:a', name: 'First', color: '#111111' },
      { id: 'extra:b', name: 'B', color: '#333333' }
    ])
  })

  it('cuts a very long extra name', () => {
    const raw = viaDisk(
      coding({ extra: [{ id: 'extra:a', name: 'x'.repeat(500), color: '#111111' }] })
    )
    expect(parseSongColors(raw, known)?.extra[0]?.name).toHaveLength(MAX_SINGER_NAME)
  })

  it('takes a malformed extra list as no extras', () => {
    const raw = { ...coding(), extra: 'many', cast: 'all' }
    const parsed = parseSongColors(viaDisk(raw), known)
    expect(parsed?.extra).toEqual([])
    expect(parsed?.cast).toEqual([])
  })

  it('keeps only known singers in the cast, once each and in order', () => {
    const raw = { ...coding(), cast: ['saki', 'nobody', 7, 'ichika', 'saki'] }
    expect(parseSongColors(viaDisk(raw), known)?.cast).toEqual(['saki', 'ichika'])
  })

  it('keeps romajiSplits that are whole offsets, in order, and leaves out the rest', () => {
    const raw = {
      ...coding(),
      lines: [
        line({ text: 'sorted', romajiSplits: [9, 3, 3, 12] }),
        line({ text: 'empty', romajiSplits: [] }),
        { ...line({ text: 'fraction' }), romajiSplits: [2, 1.5] },
        { ...line({ text: 'negative' }), romajiSplits: [-1] },
        { ...line({ text: 'text' }), romajiSplits: ['3'] },
        { ...line({ text: 'not a list' }), romajiSplits: 4 }
      ]
    }
    const parsed = parseSongColors(viaDisk(raw), known)
    expect(parsed?.lines.map((l) => l.romajiSplits)).toEqual([
      [3, 9, 12],
      [],
      undefined,
      undefined,
      undefined,
      undefined
    ])
    // Absent, not set to undefined, so a coding compares equal to the one that was saved.
    expect('romajiSplits' in (parsed?.lines[2] ?? {})).toBe(false)
  })

  it('ignores fields it does not know', () => {
    const raw = { ...coding(), future: true, lines: [{ ...line(), colorHint: 'x' }] }
    expect(parseSongColors(viaDisk(raw), known)).toStrictEqual(coding())
  })

  it('does not hand back the objects it was given', () => {
    const raw = viaDisk(coding()) as SongColors
    const parsed = parseSongColors(raw, known)
    expect(parsed?.lines[0]).not.toBe(raw.lines[0])
    expect(parsed?.lines[0]?.words[0]).not.toBe(raw.lines[0]?.words[0])
  })
})
