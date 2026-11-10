import { describe, expect, it } from 'vitest'
import { castSinger } from '../../../main/services/lyrics/singers/cast'
import { parseSongColors } from '../../../main/services/lyrics/singers/parse'
import type { CodedLine, ListenState, SongColors, SyncedLine } from '../../../main/ipc'
import { japaneseWords } from '../../widgets/music/wordWeights'
import {
  changedLines,
  deleteAction,
  editorKey,
  listenView,
  noteApplies,
  noteStep,
  shownLineAt,
  startingColors,
  wordRange
} from './editorView'

const known = (id: string): boolean => castSinger(id) !== undefined

const synced: SyncedLine[] = [
  { timeSec: 10, text: 'Hello, little world' },
  { timeSec: 14, text: '' },
  { timeSec: 18, text: 'Sing it  loud  ' },
  { timeSec: 24, text: 'one more line' }
]

describe('startingColors marks lines timed only when their times are real', () => {
  it('marks synced lyrics’ lines timed: they came with their times', () => {
    expect(startingColors(synced, 60, 0).lines.every((line) => line.timed === true)).toBe(true)
    expect(startingColors(synced, 60, 0, 'lrclib').lines.every((line) => line.timed === true)).toBe(
      true
    )
  })

  it('leaves auto-synced lines unmarked, so auto-sync’s later times still show', () => {
    const lines = startingColors(synced, 60, 0, 'autosync').lines
    expect(lines.some((line) => 'timed' in line)).toBe(false)
  })

  it('leaves plain lyrics unmarked: their times are made up', () => {
    const lines = startingColors(['one two', '', 'three'], 60, 0, 'vocadb').lines
    expect(lines).toHaveLength(2)
    expect(lines.some((line) => 'timed' in line)).toBe(false)
  })

  it('marks plain lyrics’ lines guessed, and no others', () => {
    const plain = startingColors(['one two', '', 'three'], 60, 0, 'vocadb').lines
    expect(plain.every((line) => line.guessed === true)).toBe(true)
    for (const source of ['lrclib', 'autosync'] as const) {
      expect(startingColors(synced, 60, 0, source).lines.some((line) => 'guessed' in line)).toBe(
        false
      )
    }
  })
})

describe('shownLineAt', () => {
  it('is the shown line as a song would start with it, without singers', () => {
    const start = startingColors(synced, 60, 2).lines[1]
    expect(shownLineAt(synced, 2, 60, 2)).toEqual({
      text: start?.text,
      start: start?.start,
      end: start?.end,
      words: start?.words.map(({ text, start: from, end }) => ({ text, start: from, end })),
      timed: true
    })
  })

  it('is unmarked for plain or auto-synced lyrics, and nothing for a gap or a line not there', () => {
    expect(shownLineAt(['one', '', 'two'], 2, 60, 0, 'vocadb')).toMatchObject({ text: 'two' })
    expect(shownLineAt(['one', '', 'two'], 2, 60, 0, 'vocadb')).not.toHaveProperty('timed')
    expect(shownLineAt(['one', '', 'two'], 2, 60, 0, 'vocadb')?.guessed).toBe(true)
    expect(shownLineAt(synced, 0, 60, 0, 'autosync')).not.toHaveProperty('guessed')
    expect(shownLineAt(synced, 0, 60, 0, 'autosync')).not.toHaveProperty('timed')
    expect(shownLineAt(synced, 1, 60, 0)).toBeNull()
    expect(shownLineAt(synced, 9, 60, 0)).toBeNull()
  })
})

describe('startingColors from synced lyrics', () => {
  it('keeps line and word text exactly as shown', () => {
    const colors = startingColors(synced, 60, 0)
    expect(colors.lines.map((line) => line.text)).toEqual([
      'Hello, little world',
      'Sing it  loud  ',
      'one more line'
    ])
    for (const line of colors.lines) {
      expect(line.words.map((word) => word.text).join('')).toBe(line.text)
    }
  })

  it('never trims or tidies a line’s own text, since it is how the line is found again', () => {
    const padded = ' \u3000 padded  line '
    const colors = startingColors([{ timeSec: 1, text: padded }], 60, 0)
    expect(colors.lines[0]?.text).toBe(padded)
  })

  it('splits Japanese lines without spaces the way the Focus Screen does', () => {
    const text = 'まだ終わらない夢の続きを'
    const colors = startingColors([{ timeSec: 5, text }], 60, 0)
    const words = colors.lines[0]?.words.map((word) => word.text)
    expect(words).toEqual(japaneseWords(text))
    expect(words?.length).toBeGreaterThan(1)
    expect(words?.join('')).toBe(text)
  })

  it('has times in order, inside the line and the song', () => {
    const colors = startingColors(synced, 60, 0)
    let previousStart = 0
    for (const line of colors.lines) {
      expect(line.start).toBeGreaterThanOrEqual(previousStart)
      expect(line.end).toBeGreaterThanOrEqual(line.start)
      expect(line.end).toBeLessThanOrEqual(60)
      let wordStart = line.start
      for (const word of line.words) {
        expect(word.start).toBeGreaterThanOrEqual(wordStart)
        expect(word.end).toBeGreaterThanOrEqual(word.start)
        expect(word.end).toBeLessThanOrEqual(line.end)
        wordStart = word.start
      }
      previousStart = line.start
    }
  })

  it('assigns nobody, and starts with no cast, extras or second voices', () => {
    const colors = startingColors(synced, 60, 0)
    expect(colors.version).toBe(1)
    expect(colors.cast).toEqual([])
    expect(colors.extra).toEqual([])
    for (const line of colors.lines) {
      expect(line.under).toBeUndefined()
      for (const word of line.words) expect(word.singers).toBeNull()
    }
  })

  it('passes the parser as it is', () => {
    const colors = startingColors(synced, 60, 0)
    expect(parseSongColors(colors, known)).toEqual(colors)
  })

  it('leaves out stanza gaps and breaks, which are not lines', () => {
    const colors = startingColors(synced, 60, 0)
    expect(colors.lines).toHaveLength(3)
    expect(startingColors([{ timeSec: 3, text: '' }], 60, 0).lines).toEqual([])
    expect(startingColors([], 60, 0).lines).toEqual([])
  })

  it('ends a line where the next row starts, a break included, and the last where it is sung', () => {
    const colors = startingColors(synced, 60, 0)
    expect(colors.lines[0]?.end).toBe(14)
    expect(colors.lines[1]?.end).toBe(24)
    const last = colors.lines[2]
    expect(last?.end).toBe(last?.words.at(-1)?.end)
    expect(last?.end).toBeLessThanOrEqual(60)
  })

  it('keeps a line’s own word timings when they spell it out', () => {
    const words = [
      { text: 'Hello ', start: 10.2, end: 10.8 },
      { text: 'world', start: 11, end: 12 }
    ]
    const colors = startingColors([{ timeSec: 10, text: 'Hello world', words }], 60, 0)
    expect(colors.lines[0]?.words.map(({ text, start, end }) => ({ text, start, end }))).toEqual(
      words
    )
  })

  it('works the words out afresh when the timed ones do not spell the line', () => {
    const words = [{ text: 'something else', start: 10.2, end: 11 }]
    const colors = startingColors([{ timeSec: 10, text: 'Hello world', words }], 60, 0)
    expect(colors.lines[0]?.words.map((word) => word.text).join('')).toBe('Hello world')
  })

  it('stores true song times: the line’s offset comes off every time', () => {
    const lines: SyncedLine[] = [
      {
        timeSec: 10,
        text: 'Hello world',
        words: [
          { text: 'Hello ', start: 10.2, end: 10.8 },
          { text: 'world', start: 11, end: 12 }
        ]
      },
      { timeSec: 16, text: 'next line' }
    ]
    const colors = startingColors(lines, 60, 2)
    const first = colors.lines[0]
    expect(first?.start).toBe(8)
    expect(first?.end).toBe(14)
    expect(first?.words.map((word) => [word.start, word.end])).toEqual([
      [8.2, 8.8],
      [9, 10]
    ])
    expect(colors.lines[1]?.start).toBe(14)
  })

  it('keeps every time inside the song when an offset pushes it out', () => {
    const early = startingColors([{ timeSec: 1, text: 'Hello world' }], 60, 5)
    expect(early.lines[0]?.start).toBe(0)
    expect(early.lines[0]?.words.every((word) => word.start >= 0 && word.end >= 0)).toBe(true)
    const late = startingColors([{ timeSec: 58, text: 'Hello world' }], 60, -5)
    expect(late.lines[0]?.start).toBe(60)
    expect(late.lines[0]?.end).toBe(60)
    expect(late.lines[0]?.words.every((word) => word.end <= 60)).toBe(true)
    expect(parseSongColors(late, known)).toEqual(late)
  })

  it('never lets a line end before it starts, even from lines out of order', () => {
    const colors = startingColors(
      [
        { timeSec: 20, text: 'late one' },
        { timeSec: 10, text: 'early one' }
      ],
      60,
      0
    )
    expect(colors.lines[0]?.end).toBeGreaterThanOrEqual(colors.lines[0]?.start ?? 0)
    expect(parseSongColors(colors, known)).not.toBeNull()
  })
})

describe('startingColors from plain lyrics', () => {
  it('spreads the lines over 5% to 95% of the song by length, leaving gaps out', () => {
    const colors = startingColors(['aa', '', 'bbbb'], 100, 0)
    expect(colors.lines).toHaveLength(2)
    const [first, second] = colors.lines
    expect(first?.start).toBeCloseTo(5)
    // Two thirds of the 90 s go to the longer line.
    expect(first?.end).toBeCloseTo(35)
    expect(second?.start).toBeCloseTo(35)
    expect(second?.end).toBeCloseTo(95)
  })

  it('counts whole characters, so a Japanese or emoji line is not weighed double', () => {
    const colors = startingColors(['あい', '😀😀'], 100, 0)
    const [first, second] = colors.lines
    expect((first?.end ?? 0) - (first?.start ?? 0)).toBeCloseTo(45)
    expect((second?.end ?? 0) - (second?.start ?? 0)).toBeCloseTo(45)
  })

  it('keeps text as shown, has no offset to take off, and parses', () => {
    const lines = ['First line here', 'Second  line ', 'まだ終わらない夢の続きを']
    const colors = startingColors(lines, 180, 4)
    expect(colors.lines.map((line) => line.text)).toEqual(lines)
    for (const line of colors.lines) {
      expect(line.words.map((word) => word.text).join('')).toBe(line.text)
      for (const word of line.words) expect(word.singers).toBeNull()
    }
    expect(colors).toEqual(startingColors(lines, 180, 0))
    expect(parseSongColors(colors, known)).toEqual(colors)
    expect(colors.lines[0]?.start).toBeCloseTo(9)
    expect(colors.lines.at(-1)?.end).toBeCloseTo(171)
  })

  it('has no lines for no lyrics', () => {
    expect(startingColors([], 100, 0).lines).toEqual([])
    expect(startingColors(['', ''], 100, 0).lines).toEqual([])
  })
})

describe('changedLines', () => {
  const coded = (texts: string[]): SongColors => ({
    version: 1,
    lines: texts.map((text, i) => ({ text, start: i, end: i + 1, words: [] })),
    cast: [],
    extra: []
  })

  it('marks only the lines the shown lyrics no longer have', () => {
    const colors = coded(['one', 'two', 'three'])
    expect(changedLines(colors, ['one', '', 'three', 'four'])).toEqual(new Set([1]))
    expect(changedLines(colors, ['one', 'two', 'three'])).toEqual(new Set())
  })

  it('compares text exactly', () => {
    expect(changedLines(coded(['one ']), ['one'])).toEqual(new Set([0]))
  })

  it('leaves second voices alone: they were never among the shown lines', () => {
    const colors = coded(['one', '(echo)'])
    const echo = colors.lines[1]
    if (echo) echo.under = 0
    expect(changedLines(colors, ['one'])).toEqual(new Set())
  })

  it('never marks an added line', () => {
    const colors = coded(['one', 'verse'])
    const verse = colors.lines[1]
    if (verse) verse.added = true
    expect(changedLines(colors, ['one'])).toEqual(new Set())
  })

  it('has nothing changed for a coding made from the shown lines', () => {
    const colors = startingColors(synced, 60, 0)
    expect(
      changedLines(
        colors,
        synced.map((line) => line.text)
      )
    ).toEqual(new Set())
  })
})

describe('wordRange', () => {
  it('runs from the anchor to the focus, either way, the last word included', () => {
    expect(wordRange(2, 5)).toEqual({ from: 2, to: 6 })
    expect(wordRange(5, 2)).toEqual({ from: 2, to: 6 })
    expect(wordRange(3, 3)).toEqual({ from: 3, to: 4 })
  })
})

describe('editorKey', () => {
  const press = (
    key: string,
    more: Partial<{
      metaKey: boolean
      shiftKey: boolean
      altKey: boolean
      type: 'keydown' | 'keyup'
      repeat: boolean
      inField: boolean
    }> = {}
  ): ReturnType<typeof editorKey> =>
    editorKey({
      key,
      metaKey: false,
      shiftKey: false,
      type: 'keydown',
      repeat: false,
      inField: false,
      ...more
    })

  it('moves between lines with the arrows', () => {
    expect(press('ArrowUp')).toEqual({ kind: 'line', delta: -1 })
    expect(press('ArrowDown')).toEqual({ kind: 'line', delta: 1 })
    expect(press('ArrowDown', { repeat: true })).toEqual({ kind: 'line', delta: 1 })
  })

  it('plays the line on Space, once per press', () => {
    expect(press(' ')).toEqual({ kind: 'playLine' })
    expect(press(' ', { type: 'keyup' })).toBeNull()
    expect(press(' ', { repeat: true })).toBeNull()
  })

  it('assigns the cast row’s slots with the number keys', () => {
    expect(press('1')).toEqual({ kind: 'assign', slot: 0 })
    expect(press('2')).toEqual({ kind: 'assign', slot: 1 })
    expect(press('9')).toEqual({ kind: 'assign', slot: 8 })
    expect(press('0')).toBeNull()
    expect(press('2', { type: 'keyup' })).toBeNull()
    expect(press('2', { metaKey: true })).toBeNull()
  })

  it('clears with Delete or Backspace', () => {
    expect(press('Delete')).toEqual({ kind: 'clear' })
    expect(press('Backspace')).toEqual({ kind: 'clear' })
  })

  it('undoes with ⌘Z and redoes with ⇧⌘Z', () => {
    expect(press('z', { metaKey: true })).toEqual({ kind: 'undo' })
    expect(press('z', { metaKey: true, shiftKey: true })).toEqual({ kind: 'redo' })
    // Holding Shift makes the browser report a capital.
    expect(press('Z', { metaKey: true, shiftKey: true })).toEqual({ kind: 'redo' })
    expect(press('z')).toBeNull()
  })

  it('taps with J: down, up, and never from a held key', () => {
    expect(press('j')).toEqual({ kind: 'tap', phase: 'down' })
    expect(press('j', { type: 'keyup' })).toEqual({ kind: 'tap', phase: 'up' })
    expect(press('j', { repeat: true })).toBeNull()
    expect(press('J')).toEqual({ kind: 'tap', phase: 'down' })
  })

  it('lets go of a tap even if ⌘ went down in the meantime, but never starts one with ⌘', () => {
    expect(press('j', { metaKey: true })).toBeNull()
    expect(press('j', { type: 'keyup', metaKey: true })).toEqual({ kind: 'tap', phase: 'up' })
  })

  it('adds lines with ⌘N, once per press', () => {
    expect(press('n', { metaKey: true })).toEqual({ kind: 'addLines' })
    expect(press('n', { metaKey: true, repeat: true })).toBeNull()
    expect(press('n', { metaKey: true, shiftKey: true })).toBeNull()
    expect(press('n', { metaKey: true, type: 'keyup' })).toBeNull()
    expect(press('n')).toBeNull()
  })

  it('moves an added line with ⌥↑/⌥↓ and runs the selection on with ⇧↑/⇧↓', () => {
    expect(press('ArrowUp', { altKey: true })).toEqual({ kind: 'moveLine', delta: -1 })
    expect(press('ArrowDown', { altKey: true })).toEqual({ kind: 'moveLine', delta: 1 })
    expect(press('ArrowUp', { shiftKey: true })).toEqual({ kind: 'extendLines', delta: -1 })
    expect(press('ArrowDown', { shiftKey: true })).toEqual({ kind: 'extendLines', delta: 1 })
    expect(press('ArrowDown', { shiftKey: true, repeat: true })).toEqual({
      kind: 'extendLines',
      delta: 1
    })
    // Both at once is neither.
    expect(press('ArrowUp', { altKey: true, shiftKey: true })).toBeNull()
  })

  it('moves a line once per press: a held ⌥↑ would swap lines back and forth', () => {
    expect(press('ArrowUp', { altKey: true, repeat: true })).toBeNull()
    expect(press('ArrowDown', { altKey: true, repeat: true })).toBeNull()
  })

  it('replays from the line before with ⇧Space, once per press; plain keys unchanged', () => {
    expect(press(' ', { shiftKey: true })).toEqual({ kind: 'replayLine' })
    expect(press(' ', { shiftKey: true, repeat: true })).toBeNull()
    expect(press(' ')).toEqual({ kind: 'playLine' })
    expect(press('ArrowUp')).toEqual({ kind: 'line', delta: -1 })
    expect(press('ArrowDown')).toEqual({ kind: 'line', delta: 1 })
  })

  it('is no key at all while typing in a field', () => {
    for (const key of ['ArrowUp', ' ', '2', 'Delete', 'Backspace', 'j']) {
      expect(press(key, { inField: true })).toBeNull()
    }
    expect(press('j', { type: 'keyup', inField: true })).toBeNull()
    expect(press('z', { metaKey: true, inField: true })).toBeNull()
    expect(press('n', { metaKey: true, inField: true })).toBeNull()
    expect(press('ArrowUp', { altKey: true, inField: true })).toBeNull()
    expect(press(' ', { shiftKey: true, inField: true })).toBeNull()
  })

  it('ignores other keys', () => {
    expect(press('a')).toBeNull()
    expect(press('Enter')).toBeNull()
    expect(press('Escape')).toBeNull()
  })
})

describe('listenView: what “Time by listening” offers for a run of lines', () => {
  const coded = (text: string, start: number, end: number, timed = true): CodedLine => ({
    text,
    start,
    end,
    words: text === '' ? [] : [{ text, start, end, singers: null }],
    ...(timed ? { timed: true as const } : { guessed: true as const })
  })
  const song: SongColors = {
    version: 1,
    lines: [coded('a', 10, 14), coded('b', 15, 19), coded('c', 20, 24), coded('', 25, 26)],
    cast: [],
    extra: []
  }
  const listen = (over: Partial<ListenState> = {}): ListenState => ({
    installed: true,
    heard: [],
    timing: [],
    note: null,
    noteLines: [],
    fixSec: 0,
    ...over
  })
  const run = { from: 0, to: 2 }

  it('says the add-on is needed before anything else', () => {
    const missing = listen({ installed: false, heard: [[0, 60]], timing: [1] })
    expect(listenView(missing, song, run, 60, null)).toEqual({ kind: 'notInstalled' })
  })

  it('counts the lines a run is timing, whichever lines are picked', () => {
    expect(listenView(listen({ timing: [0, 1, 2] }), song, { from: 3, to: 4 }, 60, null)).toEqual({
      kind: 'timing',
      count: 3
    })
  })

  it('asks for the stretch to be played until most of it has been heard', () => {
    // Lines a and b are heard from a's start to c's: 10–20.
    expect(listenView(listen(), song, run, 60, null)).toEqual({ kind: 'notHeard' })
    expect(listenView(listen({ heard: [[10, 15]] }), song, run, 60, null)).toEqual({
      kind: 'notHeard'
    })
    expect(listenView(listen({ heard: [[9, 21]] }), song, run, 60, null)).toEqual({
      kind: 'ready'
    })
  })

  it('works the stretch out in song time, under the song’s timing fix', () => {
    const heard: [number, number][] = [[8, 18]]
    expect(listenView(listen({ heard, fixSec: 2 }), song, run, 60, null)).toEqual({
      kind: 'ready'
    })
    expect(listenView(listen({ heard, fixSec: 0 }), song, run, 60, null)).toEqual({
      kind: 'notHeard'
    })
  })

  it('goes by the lyrics’ own times where they have them', () => {
    const guessed: SongColors = {
      ...song,
      lines: [coded('a', 10, 14, false), coded('b', 15, 19, false), coded('c', 20, 24, false)]
    }
    const own = {
      kind: 'synced' as const,
      source: 'lrclib' as const,
      lines: [
        { timeSec: 30, text: 'a' },
        { timeSec: 35, text: 'b' },
        { timeSec: 40, text: 'c' }
      ]
    }
    const heard: [number, number][] = [[30, 40]]
    expect(listenView(listen({ heard }), guessed, run, 60, own)).toEqual({ kind: 'ready' })
    // Without them, the guesses are all there is: 10 s on, a run of two hears 16 s.
    expect(listenView(listen({ heard }), guessed, run, 60, null)).toEqual({ kind: 'notHeard' })
  })

  it('offers nothing for lines with no words, and asks to play a stretch with no room', () => {
    expect(listenView(listen({ heard: [[0, 60]] }), song, { from: 3, to: 4 }, 60, null)).toBeNull()
    expect(listenView(listen({ heard: [[0, 60]] }), song, run, 0, null)).toEqual({
      kind: 'notHeard'
    })
  })
})

describe('a run’s note', () => {
  it('applies while the selected lines include one it names', () => {
    expect(noteApplies([2, 3], { from: 3, to: 4 })).toBe(true)
    expect(noteApplies([2, 3], { from: 0, to: 3 })).toBe(true)
    // `to` is past the run.
    expect(noteApplies([2, 3], { from: 0, to: 2 })).toBe(false)
    expect(noteApplies([2, 3], { from: 4, to: 6 })).toBe(false)
    expect(noteApplies([2, 3], null)).toBe(false)
    expect(noteApplies([], { from: 0, to: 9 })).toBe(false)
  })

  it('is dropped once it has shown and the selection has moved off its lines', () => {
    // Shown on its lines...
    let step = noteStep(null, 'a', true)
    expect(step).toEqual({ shown: 'a', drop: false })
    // ...and the selection moves away: main drops it.
    step = noteStep(step.shown, 'a', false)
    expect(step).toEqual({ shown: null, drop: true })
  })

  it('waits for its lines when it comes while the selection is elsewhere', () => {
    // Not shown yet, so moving between other lines leaves it.
    expect(noteStep(null, 'a', false)).toEqual({ shown: null, drop: false })
    // Another note after one that showed: the new one hasn't shown.
    expect(noteStep('a', 'b', false)).toEqual({ shown: null, drop: false })
  })

  it('forgets what it showed once main has no note', () => {
    expect(noteStep('a', null, false)).toEqual({ shown: null, drop: false })
  })
})

describe('deleteAction', () => {
  const coded = (text: string, over: Partial<CodedLine> = {}): CodedLine => ({
    text,
    start: 10,
    end: 12,
    words: [{ text, start: 10, end: 12, singers: null }],
    ...over
  })
  const song: SongColors = {
    version: 1,
    lines: [coded('own'), coded('(echo)', { under: 0 }), coded('mine', { added: true })],
    cast: [],
    extra: []
  }
  const back = {
    text: 'own',
    start: 30,
    end: 32,
    words: [{ text: 'own', start: 30, end: 32 }],
    timed: true as const
  }

  it('removes a line the user added', () => {
    expect(deleteAction(song, 2, 'line', null)).toEqual({
      kind: 'edit',
      edit: { kind: 'removeLine', line: 2 }
    })
  })

  it('puts a line of the lyrics’ own back on their time, while their time is there', () => {
    expect(deleteAction(song, 0, 'line', back)).toEqual({
      kind: 'edit',
      edit: { kind: 'resetTimes', line: 0, shown: back }
    })
    expect(deleteAction(song, 0, 'line', null)).toBeNull()
  })

  it('clears singers when words were picked last, and on a second voice', () => {
    expect(deleteAction(song, 2, 'words', null)).toEqual({ kind: 'clear' })
    expect(deleteAction(song, 0, 'words', back)).toEqual({ kind: 'clear' })
    expect(deleteAction(song, 1, 'line', null)).toEqual({ kind: 'clear' })
  })

  it('does nothing with no line selected', () => {
    expect(deleteAction(song, null, 'line', null)).toBeNull()
    expect(deleteAction(song, 9, 'line', null)).toBeNull()
  })
})
