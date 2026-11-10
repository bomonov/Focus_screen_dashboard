import { describe, expect, it } from 'vitest'
// The editor's own starting coding, as its page makes it (a pure helper, no browser needed).
import { startingColors } from '../../../../renderer/screens/lyricsEditor/editorView'
import { needsTiming } from '../../autosync/service'
import type { Lyrics, LyricsState } from '../types'
import { colorLyrics } from './apply'
import { applyEdit } from './edit'
import type { SongColors } from './types'

// A plain song colored in the editor, the whole way to the Focus Screen and auto-sync: the
// times the editor spreads plain lines over are only for editing, never shown.

const LINES = ['one two', '', 'three four']
const PLAIN: Lyrics = { kind: 'plain', lines: LINES, source: 'vocadb' }

/** What auto-sync makes of the song once it has heard it. */
const AUTO_SYNCED: Lyrics = {
  kind: 'synced',
  source: 'autosync',
  wordsFrom: 'vocadb',
  plain: LINES,
  lines: [
    {
      timeSec: 30,
      text: 'one two',
      words: [
        { text: 'one ', start: 30, end: 31 },
        { text: 'two', start: 31, end: 32 }
      ]
    },
    { timeSec: 40, text: '' },
    {
      timeSec: 50,
      text: 'three four',
      words: [
        { text: 'three ', start: 50, end: 51 },
        { text: 'four', start: 51, end: 52 }
      ]
    }
  ]
}

function shown(lyrics: Lyrics, colors: LyricsState['colors']): LyricsState {
  return { trackId: 't', status: 'found', lyrics, offsetSec: 0, romaji: null, colors }
}

/** The song as the editor begins it, with one word given to Miku. */
function oneAssignment(): SongColors {
  const begun = startingColors(LINES, 200, 0, 'vocadb')
  return applyEdit(begun, { kind: 'assign', line: 0, from: 0, to: 1, singers: ['miku'] })
}

describe('a plain song colored in the editor', () => {
  it('stays plain with one assignment, and auto-sync still times it', () => {
    const colored = colorLyrics(PLAIN, oneAssignment())

    expect(colored?.lyrics).toEqual(PLAIN)
    expect(colored?.colors.lines[0]).toEqual([['miku'], null])
    expect(needsTiming(shown(colored!.lyrics, colored!.colors), 't')).toEqual(LINES)
  })

  it('shows at auto-sync’s times once it has them, not the editor’s made-up ones', () => {
    const colored = colorLyrics(AUTO_SYNCED, oneAssignment())
    if (colored?.lyrics.kind !== 'synced') throw new Error('not synced')

    expect(colored.lyrics.lines.map((line) => line.timeSec)).toEqual([30, 40, 50])
    expect(colored.lyrics.lines[0]?.words).toEqual(AUTO_SYNCED.lines[0]?.words)
    expect(colored.colors.lines[0]).toEqual([['miku'], null])
  })

  it('lets a line the user timed win over auto-sync’s', () => {
    const timed = applyEdit(oneAssignment(), { kind: 'lineTime', line: 0, start: 33, end: 36 })

    const colored = colorLyrics(AUTO_SYNCED, timed)
    if (colored?.lyrics.kind !== 'synced') throw new Error('not synced')

    expect(colored.lyrics.lines[0]?.timeSec).toBe(33)
    expect(colored.lyrics.lines[2]?.timeSec).toBe(50)
  })

  it('shows a line at the tap on its first word, not at the editor’s guess before it', () => {
    // The reviewer's case: line 0's guess starts at 10 s, the singing at 33 s.
    const tapped = applyEdit(oneAssignment(), {
      kind: 'tapTime',
      line: 0,
      word: 0,
      start: 33,
      songEnd: 200
    })

    const colored = colorLyrics(AUTO_SYNCED, tapped)
    if (colored?.lyrics.kind !== 'synced') throw new Error('not synced')

    expect(colored.lyrics.lines[0]?.timeSec).toBe(33)
  })

  it('keeps the lyrics’ own time for a line until its start is set, whatever else is', () => {
    let edited = applyEdit(oneAssignment(), {
      kind: 'tapTime',
      line: 0,
      word: 1,
      start: 35,
      songEnd: 200
    })
    edited = applyEdit(edited, { kind: 'lineTime', line: 1, end: 60 })

    const synced = colorLyrics(AUTO_SYNCED, edited)
    if (synced?.lyrics.kind !== 'synced') throw new Error('not synced')
    expect(synced.lyrics.lines.map((line) => line.timeSec)).toEqual([30, 40, 50])
    // And a plain song stays plain, for auto-sync to time.
    const plain = colorLyrics(PLAIN, edited)
    expect(plain?.lyrics).toEqual(PLAIN)
    expect(needsTiming(shown(plain!.lyrics, plain!.colors), 't')).toEqual(LINES)
  })

  it('turns synced on the user’s times once every line has them', () => {
    let timed = applyEdit(oneAssignment(), { kind: 'lineTime', line: 0, start: 33, end: 36 })
    expect(colorLyrics(PLAIN, timed)?.lyrics.kind).toBe('plain')
    timed = applyEdit(timed, { kind: 'lineTime', line: 1, start: 52, end: 55 })

    const colored = colorLyrics(PLAIN, timed)

    expect(colored?.lyrics.kind).toBe('synced')
    expect(colored?.lyrics.kind === 'synced' && colored.lyrics.lines[2]?.timeSec).toBe(52)
  })
})

describe('a plain song the user added lines to', () => {
  const ADDED = {
    text: 'a new verse',
    start: 20,
    end: 24,
    words: [
      { text: 'a ', start: 20, end: 21 },
      { text: 'new ', start: 21, end: 22.5 },
      { text: 'verse', start: 22.5, end: 24 }
    ],
    guessed: true as const
  }

  it('auto-sync times only the lyrics’ own lines when the user added some', () => {
    const coding = applyEdit(oneAssignment(), { kind: 'addLines', at: 1, lines: [ADDED] })
    const colored = colorLyrics(PLAIN, coding)
    if (!colored) throw new Error('not colored')

    expect(colored.lyrics.kind === 'plain' && colored.lyrics.lines).toContain('a new verse')
    expect(needsTiming(shown(colored.lyrics, colored.colors), 't')).toEqual(LINES)
  })

  it('a song timed through, added lines too, needs no timing', () => {
    let coding = applyEdit(oneAssignment(), { kind: 'addLines', at: 1, lines: [ADDED] })
    coding = applyEdit(coding, { kind: 'lineTime', line: 0, start: 33, end: 36 })
    coding = applyEdit(coding, { kind: 'lineTime', line: 2, start: 52, end: 55 })
    coding = applyEdit(coding, { kind: 'lineTime', line: 1, start: 40, end: 44 })
    const colored = colorLyrics(PLAIN, coding)
    if (!colored) throw new Error('not colored')

    expect(colored.lyrics.kind).toBe('synced')
    expect(needsTiming(shown(colored.lyrics, colored.colors), 't')).toBeNull()
  })
})
