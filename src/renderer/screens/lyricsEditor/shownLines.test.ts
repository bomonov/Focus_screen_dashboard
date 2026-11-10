import { describe, expect, it } from 'vitest'
import type { CodedLine, ColorEdit, LyricsState, ShownLine, SongColors } from '../../../main/ipc'
import { editorLyrics, listEntries, newLines, newWordsFor, onNewLine, ownRowOf } from './shownLines'

function line(text: string, under?: number): CodedLine {
  return {
    text,
    start: 0,
    end: 1,
    words: [{ text, start: 0, end: 1, singers: null }],
    ...(under === undefined ? {} : { under })
  }
}

function colors(lines: CodedLine[]): SongColors {
  return { version: 1, lines, cast: [], extra: [] }
}

// Coded when the lyrics were A, B, C; they're now A, B' (a typo fixed), C, and a new D.
const coded = colors([line('A'), line('(a)', 0), line('B'), line('C')])
const shown = ['A', '', 'B2', 'C', 'D']

describe('newLines', () => {
  it('lists shown lines no coded line matches, each where it goes in the coding', () => {
    expect(newLines(coded, shown)).toEqual([
      // After the changed line and before C, the next line that matched.
      { shown: 2, text: 'B2', place: 3 },
      // After everything.
      { shown: 4, text: 'D', place: 4 }
    ])
  })

  it('goes after a matched line’s second voices, never between them', () => {
    expect(newLines(colors([line('A'), line('(a)', 0), line('C')]), ['A', 'new', 'C'])).toEqual([
      { shown: 1, text: 'new', place: 2 }
    ])
  })

  it('lists nothing when every shown line is coded, and skips blank ones', () => {
    expect(newLines(colors([line('A'), line('C')]), ['A', ' ', 'C'])).toEqual([])
  })

  it('lists them all at the top when nothing matches and nothing is like them', () => {
    expect(newLines(colors([line('old')]), ['x', 'y'])).toEqual([
      { shown: 0, text: 'x', place: 0 },
      { shown: 1, text: 'y', place: 0 }
    ])
  })

  it('puts a line the lyrics gained before a changed line sung after it', () => {
    // もう一度 歌おう is new; 光の中で 手をのばした was fixed to 手を伸ばした.
    const coding = colors([line('A'), line('光の中で 手をのばした'), line('C')])
    const lyrics = ['A', 'もう一度 歌おう', '光の中で 手を伸ばした', 'C']
    expect(newLines(coding, lyrics)).toEqual([
      { shown: 1, text: 'もう一度 歌おう', place: 1 },
      { shown: 2, text: '光の中で 手を伸ばした', place: 2 }
    ])
  })
})

describe('newWordsFor', () => {
  it('pairs each changed line with the new shown line in its place, in order', () => {
    expect(newWordsFor(coded, shown)).toEqual(new Map([[2, 2]]))
    // Two changed lines and one new line between the same matched ones: the first pairs.
    const two = colors([line('A'), line('x'), line('y'), line('C')])
    expect(newWordsFor(two, ['A', 'x2', 'C'])).toEqual(new Map([[1, 1]]))
  })

  it('pairs a changed line with the new line most like it, not just the next one', () => {
    const coding = colors([line('A'), line('光の中で 手をのばした'), line('C')])
    const lyrics = ['A', 'もう一度 歌おう', '光の中で 手を伸ばした', 'C']
    expect(newWordsFor(coding, lyrics)).toEqual(new Map([[1, 2]]))
    // Nothing alike: nothing to offer.
    expect(newWordsFor(coding, ['A', 'もう一度 歌おう', 'C'])).toEqual(new Map())
  })

  it('pairs nothing where there’s no new line to take', () => {
    expect(newWordsFor(coded, ['A', 'C'])).toEqual(new Map())
  })
})

describe('listEntries', () => {
  it('puts each new line in the list where it goes, in shown order', () => {
    const entries = listEntries(coded, newLines(coded, shown))
    expect(
      entries.map((entry) => (entry.kind === 'coded' ? entry.index : `new ${entry.line.text}`))
    ).toEqual([0, 1, 2, 'new B2', 3, 'new D'])
  })
})

describe('onNewLine', () => {
  const words: ShownLine = { text: 'D', start: 5, end: 6, words: [{ text: 'D', start: 5, end: 6 }] }
  const place = { shown: 4, text: 'D', place: 4 }

  it('adds the line with its first edit', () => {
    const edit = { kind: 'assign', line: 4, from: 0, to: 1, singers: ['miku'] } as const
    expect(onNewLine(edit, place, words)).toEqual({
      kind: 'addLine',
      at: 4,
      shown: words,
      then: edit
    })
  })

  it('leaves an edit for another line, or none, as it is', () => {
    const other = { kind: 'assign', line: 0, from: 0, to: 1, singers: ['miku'] } as const
    expect(onNewLine(other, place, words)).toBe(other)
    const cast: ColorEdit = { kind: 'setCast', cast: ['miku'] }
    expect(onNewLine(cast, place, words)).toBe(cast)
  })

  it('drops an edit on the line that can’t come with its add', () => {
    // Main makes only a line's words and singers with an add, and the line isn't there to time.
    const times: ColorEdit[] = [
      { kind: 'lineTime', line: 4, start: 5 },
      { kind: 'tapTime', line: 4, word: 0, start: 5 },
      { kind: 'removeLine', line: 4 }
    ]
    for (const edit of times) expect(onNewLine(edit, place, words)).toBeNull()
  })
})

describe('editorLyrics', () => {
  const found: LyricsState = {
    trackId: 't',
    status: 'found',
    lyrics: {
      kind: 'synced',
      source: 'lrclib',
      lines: [
        { timeSec: 1, text: 'A' },
        { timeSec: 2, text: 'B' }
      ]
    },
    offsetSec: 0,
    romaji: null
  }

  it('is the lyrics on screen while they’re the editor song’s, playing', () => {
    expect(editorLyrics({ playingThis: true, shownLines: ['A', 'B'] }, found)).toBe(found.lyrics)
  })

  it('is the lyrics’ own lines, not the shown ones, when the user added some', () => {
    const own = found.lyrics
    if (own?.kind !== 'synced') throw new Error('not synced')
    const withAdded: LyricsState = {
      ...found,
      lyrics: { ...own, lines: [...own.lines, { timeSec: 3, text: 'new verse' }] },
      colors: { lines: [], voices: [], romajiSplits: [], extra: [], own }
    }
    expect(editorLyrics({ playingThis: true, shownLines: ['A', 'B'] }, withAdded)).toBe(own)
  })

  it('is nothing while another song plays, or the lines aren’t the editor song’s', () => {
    expect(editorLyrics({ playingThis: false, shownLines: ['A', 'B'] }, found)).toBeNull()
    expect(editorLyrics({ playingThis: true, shownLines: ['A', 'C'] }, found)).toBeNull()
    expect(editorLyrics({ playingThis: true, shownLines: ['A', 'B'] }, null)).toBeNull()
    const instrumental: LyricsState = {
      ...found,
      lyrics: { kind: 'instrumental', source: 'lrclib' }
    }
    expect(editorLyrics({ playingThis: true, shownLines: [] }, instrumental)).toBeNull()
  })
})

describe('added lines in the list', () => {
  const VERSE = '夜空に浮かぶ 小さな灯り'
  const withAdded: SongColors = colors([line('A'), { ...line(VERSE), added: true }, line('C')])

  it('a shown line an added line stands in for is neither new nor offered as new words', () => {
    const rows = ['A', '夜空に浮かぶ　小さな灯り', 'C']
    expect(newLines(withAdded, rows)).toEqual([])
    expect(newWordsFor(withAdded, rows).size).toBe(0)
  })
})

describe('ownRowOf', () => {
  it('is the shown line a coded line of the lyrics’ own is matched to, repeats told apart', () => {
    const song = colors([line('A'), line('(a)', 0), line('B'), line('A')])
    const rows = ['A', '', 'B', 'A']
    expect(ownRowOf(song, 0, rows)).toBe(0)
    expect(ownRowOf(song, 3, rows)).toBe(3)
    expect(ownRowOf(song, 2, rows)).toBe(2)
  })

  it('is nothing for a second voice, an added line, or a line the lyrics no longer have', () => {
    const song = colors([line('A'), line('(a)', 0), { ...line('A'), added: true }, line('Gone')])
    const rows = ['A', 'B']
    expect(ownRowOf(song, 1, rows)).toBeNull()
    expect(ownRowOf(song, 2, rows)).toBeNull()
    expect(ownRowOf(song, 3, rows)).toBeNull()
  })
})
