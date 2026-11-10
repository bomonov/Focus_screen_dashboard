import { describe, expect, it } from 'vitest'
import type { CodedLine, SingerRef, SongColors } from '../../../main/ipc'
import {
  cueTime,
  lineParts,
  lineRows,
  lineSingers,
  resolveSingers,
  romajiByLine,
  textPieces
} from './lineRows'

function line(words: [string, SingerRef | null][], text?: string, under?: number): CodedLine {
  return {
    text: text ?? words.map(([word]) => word).join(''),
    start: 0,
    end: 1,
    words: words.map(([word, singers]) => ({ text: word, start: 0, end: 1, singers })),
    ...(under === undefined ? {} : { under })
  }
}

function colors(lines: CodedLine[], cast: string[] = []): SongColors {
  return { version: 1, lines, cast, extra: [] }
}

describe('resolveSingers', () => {
  it('reads everyone as the cast once it has two', () => {
    expect(resolveSingers('everyone', ['ichika', 'miku'])).toEqual(['ichika', 'miku'])
    expect(resolveSingers('everyone', ['ichika'])).toBeNull()
  })

  it('is nobody for none', () => {
    expect(resolveSingers(null, ['ichika'])).toBeNull()
    expect(resolveSingers([], ['ichika'])).toBeNull()
    expect(resolveSingers(['miku'], [])).toEqual(['miku'])
  })
})

describe('lineSingers', () => {
  it('lists each singer once, in the order they come in, and notes everyone', () => {
    const coded = line([
      ['a ', ['miku']],
      ['b ', ['ichika', 'miku']],
      ['c', 'everyone']
    ])
    expect(lineSingers(coded, ['ichika', 'miku'])).toEqual({
      ids: ['miku', 'ichika'],
      everyone: true
    })
    expect(lineSingers(coded, ['ichika']).everyone).toBe(false)
  })
})

describe('lineParts', () => {
  it('groups neighbouring words with the same singers', () => {
    const coded = line([
      ['a ', ['miku']],
      ['b ', ['miku']],
      ['c', 'everyone']
    ])
    const hexes = (ids: readonly string[]): string[] => ids.map((id) => `#${id}`)
    expect(lineParts(coded, ['ichika', 'miku'], hexes)).toEqual([
      { from: 0, to: 2, colors: ['#miku'] },
      { from: 2, to: 3, colors: ['#ichika', '#miku'] }
    ])
  })
})

describe('lineRows', () => {
  it('leaves a music break unnumbered, and never "also in the lyrics"', () => {
    const pause: CodedLine = {
      text: '',
      start: 5,
      end: 9,
      words: [],
      added: true,
      guessed: true,
      instrumental: true
    }
    const rows = lineRows(colors([line([['hello', null]]), pause, line([['world', null]])]), [
      'hello',
      '',
      'world'
    ])
    expect(rows[1]).toMatchObject({ number: null, instrumental: true, added: true })
    expect(rows[1]?.alsoInLyrics).toBe(false)
    expect(rows[2]?.number).toBe(2)
  })

  const song = colors([
    line([['hello', null]]),
    line([['(echo)', null]], undefined, 0),
    line([['gone', null]]),
    line([['world', null]])
  ])

  it('numbers main lines only and marks second voices and changed lines', () => {
    expect(lineRows(song, ['hello', 'world'])).toEqual([
      {
        index: 0,
        number: 1,
        voice: false,
        changed: false,
        added: false,
        alsoInLyrics: false,
        text: 'hello'
      },
      {
        index: 1,
        number: null,
        voice: true,
        changed: false,
        added: false,
        alsoInLyrics: false,
        text: '(echo)'
      },
      {
        index: 2,
        number: 2,
        voice: false,
        changed: true,
        added: false,
        alsoInLyrics: false,
        text: 'gone'
      },
      {
        index: 3,
        number: 3,
        voice: false,
        changed: false,
        added: false,
        alsoInLyrics: false,
        text: 'world'
      }
    ])
  })

  it('shows the words, not the text, once a second voice took some away', () => {
    const made = colors([line([['Stay with me ', null]], 'Stay with me (tonight)')])
    expect(lineRows(made, ['Stay with me (tonight)'])[0]?.text).toBe('Stay with me ')
  })
})

describe('romajiByLine', () => {
  it('puts each shown line’s romaji on its coded line, as the Focus Screen matches them', () => {
    const song = colors([
      line([['星空', null]]),
      line([['(echo)', null]], undefined, 0),
      line([['ありがとう', null]])
    ])
    const shown = ['星空', '', 'ありがとう']
    expect(romajiByLine(song, shown, ['hoshizora', '', 'arigatou'])).toEqual([
      'hoshizora',
      null,
      'arigatou'
    ])
  })

  it('is nothing without romaji', () => {
    const song = colors([line([['星空', null]])])
    expect(romajiByLine(song, ['星空'], null)).toEqual([null])
  })
})

describe('textPieces', () => {
  it('keeps each part whole and the uncolored words between as their own runs', () => {
    const words = ['a ', 'b ', 'c ', 'd ', 'e']
    const parts = [
      { from: 1, to: 3, colors: ['#1', '#2'] },
      { from: 3, to: 4, colors: ['#3'] }
    ]
    expect(textPieces(words, parts)).toEqual([
      { text: 'a ', colors: null },
      { text: 'b c ', colors: ['#1', '#2'] },
      { text: 'd ', colors: ['#3'] },
      { text: 'e', colors: null }
    ])
  })

  it('is one plain run with no parts, and nothing with no words', () => {
    expect(textPieces(['a ', 'b'], [])).toEqual([{ text: 'a b', colors: null }])
    expect(textPieces([], [])).toEqual([])
  })
})

describe('cueTime', () => {
  it('writes minutes, seconds and hundredths', () => {
    expect(cueTime(62.4)).toBe('1:02.40')
    expect(cueTime(0)).toBe('0:00.00')
    expect(cueTime(59.999)).toBe('1:00.00')
  })

  it('treats nonsense as zero', () => {
    expect(cueTime(Number.NaN)).toBe('0:00.00')
    expect(cueTime(-3)).toBe('0:00.00')
  })
})

describe('lineRows marks', () => {
  const VERSE = '夜空に浮かぶ 小さな灯り'
  const added = (text: string): CodedLine => ({ ...line([[text, null]]), added: true })

  it('marks added lines, and those also in the lyrics now', () => {
    const stand = lineRows(colors([line([['A', null]]), added(VERSE), line([['C', null]])]), [
      'A',
      '夜空に浮かぶ　小さな灯り',
      'C'
    ])
    expect(stand[1]).toMatchObject({ added: true, alsoInLyrics: true })
    const exact = lineRows(colors([line([['A', null]]), added(VERSE)]), ['A', VERSE])
    expect(exact[1]).toMatchObject({ added: true, alsoInLyrics: true })
    const alone = lineRows(colors([line([['A', null]]), added('zzz')]), ['A'])
    expect(alone[0]).toMatchObject({ added: false, alsoInLyrics: false })
    expect(alone[1]).toMatchObject({ added: true, alsoInLyrics: false })
  })
})
