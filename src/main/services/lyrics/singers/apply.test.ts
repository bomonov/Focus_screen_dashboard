import { describe, expect, it } from 'vitest'
import { syncedLineIndex, type Lyrics, type SyncedLine } from '../types'
import { colorLyrics } from './apply'
import type { CodedLine, CodedWord, SingerRef, SongColors } from './types'

/**
 * A line made of its words, one second each from `start`, all sung by `singers`, and timed by
 * the user (or from lyrics that came with times).
 */
function coded(
  text: string,
  start: number,
  singers: SingerRef | null = ['ichika'],
  extra: Partial<CodedLine> = {}
): CodedLine {
  const words: CodedWord[] = text.split(/(?<= )/).map((word, i) => ({
    text: word,
    start: start + i,
    end: start + i + 1,
    singers
  }))
  return { text, start, end: start + words.length, words, timed: true, ...extra }
}

/** The same, on times nobody set: spread over plain lyrics, or copied from auto-sync's. */
function untimed(
  text: string,
  start: number,
  singers: SingerRef | null = ['ichika'],
  extra: Partial<CodedLine> = {}
): CodedLine {
  const line = coded(text, start, singers, extra)
  delete line.timed
  return line
}

function song(lines: CodedLine[], cast: string[] = ['ichika', 'saki']): SongColors {
  return { version: 1, lines, cast, extra: [] }
}

function synced(...texts: string[]): Lyrics {
  const lines: SyncedLine[] = texts.map((text, i) => ({ timeSec: 100 + i * 5, text }))
  return { kind: 'synced', lines, source: 'lrclib' }
}

function plain(...lines: string[]): Lyrics {
  return { kind: 'plain', lines, source: 'vocadb' }
}

function lines(lyrics: Lyrics): SyncedLine[] {
  if (lyrics.kind !== 'synced') throw new Error('expected synced lyrics')
  return lyrics.lines
}

/** Synced lyrics with each line at its own time. */
function at(...rows: [text: string, timeSec: number][]): Lyrics {
  return {
    kind: 'synced',
    lines: rows.map(([text, timeSec]) => ({ timeSec, text })),
    source: 'lrclib'
  }
}

/** A line the user added, its times still the editor's guess. */
function added(
  text: string,
  start: number,
  singers: SingerRef | null = ['ichika'],
  extra: Partial<CodedLine> = {}
): CodedLine {
  return untimed(text, start, singers, { added: true, guessed: true, ...extra })
}

const texts = (lyrics: Lyrics): string[] => lines(lyrics).map((line) => line.text)

/** Auto-synced lyrics: each line's words a second apart from its time. */
function autoSynced(...texts: string[]): Lyrics {
  const lines: SyncedLine[] = texts.map((text, i) => {
    const timeSec = 100 + i * 5
    const words = text.split(/(?<= )/).map((word, k) => ({
      text: word,
      start: timeSec + k,
      end: timeSec + k + 1
    }))
    return { timeSec, text, words }
  })
  return { kind: 'synced', lines, source: 'autosync', plain: texts }
}

describe('colorLyrics and times nobody set', () => {
  it('keeps plain lyrics plain, colored per line, while their coded times are made up', () => {
    const coding = song([untimed('one two ', 10, ['saki']), untimed('three four ', 20)])
    const shown = plain('one two ', '', 'three four ')

    const result = colorLyrics(shown, coding)

    expect(result!.lyrics).toEqual(shown)
    expect(result!.colors.lines).toEqual([[['saki'], ['saki']], null, [['ichika'], ['ichika']]])
  })

  it('keeps plain lyrics plain while only some of their lines are timed', () => {
    const coding = song([coded('one two ', 10), untimed('three four ', 20)])
    const shown = plain('one two ', 'three four ')

    expect(colorLyrics(shown, coding)!.lyrics).toEqual(shown)
  })

  it('keeps auto-sync’s times on lines nobody timed, with the coding’s singers on its words', () => {
    const coding = song([untimed('one two ', 10, ['saki']), untimed('three four ', 20)])

    const result = colorLyrics(autoSynced('one two ', 'three four '), coding)

    expect(lines(result!.lyrics)).toEqual(lines(autoSynced('one two ', 'three four ')))
    expect(result!.lyrics).toMatchObject({ source: 'autosync', plain: ['one two ', 'three four '] })
    expect(result!.colors.lines).toEqual([
      [['saki'], ['saki']],
      [['ichika'], ['ichika']]
    ])
  })

  it('places coded words split differently from auto-sync’s by their letters', () => {
    const line = untimed('hello world ', 10)
    line.words = [
      { text: 'hel', start: 10, end: 11, singers: ['saki'] },
      { text: 'lo ', start: 11, end: 12, singers: ['ichika'] },
      { text: 'world ', start: 12, end: 13, singers: null }
    ]

    const result = colorLyrics(autoSynced('hello world '), song([line]))

    // Auto-sync has "hello " 100–101 and "world " 101–102: "hel" is the first 3 of its 5 letters.
    expect(lines(result!.lyrics)[0]?.words).toEqual([
      { text: 'hel', start: 100, end: 100.6 },
      { text: 'lo ', start: 100.6, end: 101 },
      { text: 'world ', start: 101, end: 102 }
    ])
  })

  it('lets a line the user timed win over auto-sync’s time', () => {
    const coding = song([coded('one two ', 50, ['saki']), untimed('three four ', 20)])

    const out = lines(colorLyrics(autoSynced('one two ', 'three four '), coding)!.lyrics)

    expect(out[0]?.timeSec).toBe(50)
    expect(out[0]?.words?.map((word) => word.start)).toEqual([50, 51])
    // The line after it, nobody's timing, keeps auto-sync's.
    expect(out[1]?.timeSec).toBe(105)
    expect(out[1]?.words?.map((word) => word.start)).toEqual([105, 106])
  })

  it('puts an untimed line’s words inside the shown line when it has no word timings', () => {
    const coding = song([untimed('one two ', 10)])

    const out = lines(colorLyrics(synced('one two ', 'next '), coding)!.lyrics)

    expect(out[0]).toEqual({
      timeSec: 100,
      text: 'one two ',
      words: [
        { text: 'one ', start: 100, end: 101 },
        { text: 'two ', start: 101, end: 102 }
      ]
    })
  })

  it('moves an untimed second voice with its main line', () => {
    const coding = song([untimed('one two ', 10), untimed('(two) ', 11.5, ['saki'], { under: 0 })])

    const result = colorLyrics(autoSynced('one two '), coding)

    expect(result!.colors.voices[0]?.words).toEqual([{ text: '(two) ', start: 101.5, end: 102.5 }])
  })
})

describe('colorLyrics', () => {
  it('keeps matched lines and drops changed ones', () => {
    const coding = song([
      coded('one two ', 10, ['saki']),
      coded('three four ', 20, ['ichika']),
      coded('five six ', 30, ['saki', 'ichika'])
    ])
    const before = structuredClone(coding)
    const shown = synced('one two ', 'three for ', 'five six ')

    const result = colorLyrics(shown, coding)

    expect(result).not.toBeNull()
    const out = lines(result!.lyrics)
    expect(out).toHaveLength(3)
    // A and C take the coded timing and words, without the singers (those go in `colors`).
    expect(out[0]).toEqual({
      timeSec: 10,
      text: 'one two ',
      words: [
        { text: 'one ', start: 10, end: 11 },
        { text: 'two ', start: 11, end: 12 }
      ]
    })
    expect(out[2]?.timeSec).toBe(30)
    expect(out[2]?.words).toEqual([
      { text: 'five ', start: 30, end: 31 },
      { text: 'six ', start: 31, end: 32 }
    ])
    // B' keeps its place between them: it moves with A, the matched line before it (100 → 10).
    expect(out[1]).toEqual({ timeSec: 15, text: 'three for ' })
    expect(result!.colors.lines[0]).toEqual([['saki'], ['saki']])
    expect(result!.colors.lines[1]).toBeNull()
    expect(result!.colors.lines[2]).toEqual([
      ['saki', 'ichika'],
      ['saki', 'ichika']
    ])
    // Nothing is thrown away or changed: the coding is the user's.
    expect(coding).toEqual(before)
  })

  it('resolves everyone to the cast in order', () => {
    const coding = song([coded('all together ', 10, 'everyone')], ['saki', 'ichika', 'honami'])

    const result = colorLyrics(synced('all together '), coding)

    expect(result!.colors.lines[0]).toEqual([
      ['saki', 'ichika', 'honami'],
      ['saki', 'ichika', 'honami']
    ])
  })

  it('gives everyone to nobody while the cast has fewer than two singers', () => {
    const alone = song([coded('all together ', 10, 'everyone')], ['saki'])
    const empty = song([coded('all together ', 10, 'everyone')], [])

    expect(colorLyrics(synced('all together '), alone)!.colors.lines[0]).toEqual([null, null])
    expect(colorLyrics(synced('all together '), empty)!.colors.lines[0]).toEqual([null, null])
  })

  it('a duet word keeps its singers in the order picked', () => {
    const coding = song([
      coded('la la ', 10, ['saki', 'ichika', 'airi']),
      coded('na na ', 20, ['airi', 'saki'])
    ])

    const result = colorLyrics(synced('la la ', 'na na '), coding)

    expect(result!.colors.lines[0]?.[0]).toEqual(['saki', 'ichika', 'airi'])
    expect(result!.colors.lines[1]?.[1]).toEqual(['airi', 'saki'])
  })

  it('leaves a word nobody was given as null, and the rest of its line colored', () => {
    const line = coded('one two ', 10, ['saki'])
    line.words[1] = { ...line.words[1]!, singers: null }

    const result = colorLyrics(synced('one two '), song([line]))

    expect(result!.colors.lines[0]).toEqual([['saki'], null])
  })

  it('copies the singers, so a later edit of the coding never reaches the shown colors', () => {
    const coding = song([coded('one two ', 10, ['saki'])])

    const result = colorLyrics(synced('one two '), coding)
    ;(coding.lines[0]!.words[0]!.singers as string[]).push('honami')

    expect(result!.colors.lines[0]?.[0]).toEqual(['saki'])
  })

  it('plain lyrics fully coded become synced', () => {
    const coding = song([coded('one two ', 10, ['saki']), coded('three four ', 20, ['ichika'])])
    const shown: Lyrics = {
      kind: 'plain',
      lines: ['one two ', '', 'three four '],
      source: 'ytmusic',
      credit: 'Musixmatch'
    }

    const result = colorLyrics(shown, coding)

    expect(result!.lyrics.kind).toBe('synced')
    expect(result!.lyrics.source).toBe('ytmusic')
    expect(result!.lyrics).toMatchObject({ credit: 'Musixmatch' })
    const out = lines(result!.lyrics)
    expect(out.map((line) => line.text)).toEqual(['one two ', '', 'three four '])
    expect(out[0]?.timeSec).toBe(10)
    // A stanza gap starts where the line before it ended.
    expect(out[1]).toEqual({ timeSec: 12, text: '' })
    expect(out[2]?.timeSec).toBe(20)
    expect(result!.colors.lines).toHaveLength(3)
    expect(result!.colors.lines[1]).toBeNull()
  })

  it('starts a stanza gap at the top of the song at 0', () => {
    const coding = song([coded('one two ', 10)])

    const result = colorLyrics(plain('', 'one two ', ''), coding)

    expect(lines(result!.lyrics)).toEqual([
      { timeSec: 0, text: '' },
      expect.objectContaining({ timeSec: 10, text: 'one two ' }),
      { timeSec: 12, text: '' }
    ])
  })

  it('keeps plain lyrics plain, colored per line, when a line did not match', () => {
    const coding = song([coded('one two ', 10, ['saki']), coded('three four ', 20)])
    const shown = plain('one two ', 'three for ')

    const result = colorLyrics(shown, coding)

    expect(result!.lyrics).toEqual(shown)
    expect(result!.colors.lines).toEqual([[['saki'], ['saki']], null])
  })

  it('a second voice follows its main line', () => {
    const coding = song([
      coded('one two ', 10),
      coded('three four ', 20),
      coded('(oh) ', 21, ['saki'], { under: 1 }),
      coded('five six ', 30)
    ])

    const result = colorLyrics(synced('one two ', 'three four ', 'five six '), coding)

    expect(result!.colors.voices).toEqual([
      { under: 1, words: [{ text: '(oh) ', start: 21, end: 22 }], singers: [['saki']] }
    ])
    // The shown lines stay the main lines: voices never become rows of their own.
    expect(lines(result!.lyrics)).toHaveLength(3)
  })

  it('finds a second voice by its main line even when lines before it were not shown', () => {
    const coding = song([
      coded('gone ', 5),
      coded('one two ', 10),
      coded('(oh) ', 11, ['saki'], { under: 1 })
    ])

    const result = colorLyrics(synced('one two '), coding)

    expect(result!.colors.voices.map((voice) => voice.under)).toEqual([0])
  })

  it('drops a second voice whose main line did not match', () => {
    const coding = song([
      coded('one two ', 10),
      coded('three four ', 20),
      coded('(oh) ', 21, ['saki'], { under: 1 })
    ])

    const result = colorLyrics(synced('one two ', 'three for '), coding)

    expect(result!.colors.voices).toEqual([])
  })

  it('resolves a second voice everyone like any other word', () => {
    const coding = song(
      [coded('one two ', 10), coded('(oh) ', 11, 'everyone', { under: 0 })],
      ['saki', 'ichika']
    )

    const result = colorLyrics(synced('one two '), coding)

    expect(result!.colors.voices[0]?.singers).toEqual([['saki', 'ichika']])
  })

  it('keeps voices in the order of their main lines', () => {
    const coding = song([
      coded('one two ', 10),
      coded('three four ', 20),
      coded('(later) ', 21, ['saki'], { under: 1 }),
      coded('(first) ', 11, ['saki'], { under: 0 })
    ])

    const result = colorLyrics(synced('one two ', 'three four '), coding)

    expect(result!.colors.voices.map((voice) => voice.under)).toEqual([0, 1])
  })

  it('uses a coded line once, and never goes back past the last match', () => {
    const coding = song([coded('one ', 10), coded('two ', 20)])

    // The second "one" has nothing left to match.
    const twice = colorLyrics(synced('one ', 'one '), coding)
    expect(twice!.colors.lines.map((line) => line !== null)).toEqual([true, false])

    // Out of order, only one of the two can keep its coding: matching both would go back.
    const swapped = colorLyrics(synced('two ', 'one '), coding)
    expect(swapped!.colors.lines.filter((line) => line !== null)).toHaveLength(1)
  })

  it('matches a repeated line to its own place in the song', () => {
    const coding = song([coded('la ', 10), coded('di ', 20), coded('la ', 30)])

    const result = colorLyrics(synced('la ', 'di ', 'la '), coding)

    expect(lines(result!.lyrics).map((line) => line.timeSec)).toEqual([10, 20, 30])
  })

  it('does not match a line to a second voice with the same words', () => {
    const coding = song([coded('one ', 10), coded('echo ', 11, ['saki'], { under: 0 })])

    const result = colorLyrics(synced('one ', 'echo '), coding)

    expect(result!.colors.lines.map((line) => line !== null)).toEqual([true, false])
  })

  it("an extra line equal to a later coded line doesn't uncolor the lines between", () => {
    // The shown version opens with one more chorus line than the coding was made on.
    const coding = song([
      coded('v1a ', 10),
      coded('v1b ', 12),
      coded('chorus ', 14),
      coded('v2a ', 20),
      coded('v2b ', 22),
      coded('chorus ', 24)
    ])
    const shown = synced('chorus ', 'v1a ', 'v1b ', 'chorus ', 'v2a ', 'v2b ', 'chorus ')

    const result = colorLyrics(shown, coding)

    expect(result!.colors.lines.map((line) => line !== null)).toEqual([
      false,
      true,
      true,
      true,
      true,
      true,
      true
    ])
    // The extra line goes ahead of the first coded one, with it (105 → 10, so 100 → 5).
    expect(lines(result!.lyrics).map((line) => line.timeSec)).toEqual([5, 10, 12, 14, 20, 22, 24])
  })

  it('still matches in order when the shown version leaves a coded line out', () => {
    const coding = song([coded('a ', 10), coded('b ', 20), coded('c ', 30), coded('b ', 40)])

    const result = colorLyrics(synced('a ', 'c ', 'b '), coding)

    expect(lines(result!.lyrics).map((line) => line.timeSec)).toEqual([10, 30, 40])
  })

  it('output timeSec is non-decreasing', () => {
    // LRCLIB is 2.5 s ahead of the user's timing, with a changed line between two matched ones.
    const coding = song([coded('a ', 10), coded('b ', 12), coded('c ', 14)])
    const shown: Lyrics = {
      kind: 'synced',
      source: 'lrclib',
      lines: [
        { timeSec: 7.5, text: 'a ' },
        { timeSec: 9.5, text: "b' " },
        { timeSec: 11.5, text: 'c ' }
      ]
    }

    const out = lines(colorLyrics(shown, coding)!.lyrics)

    expect(out.map((line) => line.timeSec)).toEqual([10, 12, 14])
    // So a binary search by time finds every line, the first included.
    expect(syncedLineIndex(out, 10.5)).toBe(0)
    expect(syncedLineIndex(out, 12.5)).toBe(1)
    expect(syncedLineIndex(out, 14.5)).toBe(2)
  })

  it('keeps timeSec in order when the user timed two lines the wrong way round', () => {
    const coding = song([coded('a ', 20), coded('b ', 10), coded('c ', 30)])

    const out = lines(colorLyrics(synced('a ', 'b ', 'c '), coding)!.lyrics)

    expect(out.map((line) => line.timeSec)).toEqual([20, 20, 30])
  })

  it('keeps timeSec in order through the extra-chorus case too', () => {
    const coding = song([coded('a ', 10), coded('chorus ', 14), coded('b ', 20)])
    const shown = synced('chorus ', 'a ', 'chorus ', 'x ', 'b ')

    const times = lines(colorLyrics(shown, coding)!.lyrics).map((line) => line.timeSec)

    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it('an unmatched run moves with its matched neighbour', () => {
    const coding = song([coded('a ', 10), coded('d ', 30)])
    const shown: Lyrics = {
      kind: 'synced',
      source: 'autosync',
      lines: [
        { timeSec: 98, text: 'intro ' },
        { timeSec: 100, text: 'a ' },
        {
          timeSec: 103,
          text: 'b ',
          words: [
            { text: 'b ', start: 103, end: 104 },
            { text: 'x ', start: 104, end: 105 }
          ]
        },
        { timeSec: 106, text: '' },
        { timeSec: 108, text: 'c ' },
        { timeSec: 112, text: 'd ' },
        { timeSec: 116, text: 'outro ' }
      ]
    }

    const out = lines(colorLyrics(shown, coding)!.lyrics)

    // The run before the first match moves with the first match (100 → 10, so by -90),
    // the runs after a match with that match.
    expect(out.map((line) => line.timeSec)).toEqual([8, 10, 13, 16, 18, 30, 34])
    expect(out[2]?.words).toEqual([
      { text: 'b ', start: 13, end: 14 },
      { text: 'x ', start: 14, end: 15 }
    ])
    // The second run moves with "a" (-90) up to "d", which is at 30.
    expect(out[4]).toEqual({ timeSec: 18, text: 'c ' })
  })

  it('moves a run after the last match with the last match', () => {
    const coding = song([coded('a ', 10), coded('b ', 30)])
    const shown: Lyrics = {
      kind: 'synced',
      source: 'lrclib',
      lines: [
        { timeSec: 100, text: 'a ' },
        { timeSec: 112, text: 'b ' },
        { timeSec: 120, text: 'outro ' }
      ]
    }

    const out = lines(colorLyrics(shown, coding)!.lyrics)

    // "b" moved by 30 - 112 = -82, and the outro goes with it.
    expect(out.map((line) => line.timeSec)).toEqual([10, 30, 38])
  })

  it('never moves a line before the start of the song', () => {
    const coding = song([coded('a ', 10)])
    const shown: Lyrics = {
      kind: 'synced',
      source: 'lrclib',
      lines: [
        { timeSec: 1, text: 'intro ' },
        { timeSec: 100, text: 'a ' }
      ]
    }

    const out = lines(colorLyrics(shown, coding)!.lyrics)

    expect(out.map((line) => line.timeSec)).toEqual([0, 10])
  })

  it('starts a stanza gap no later than the line after it', () => {
    // The two lines overlap: the first ends at 12, the second starts at 11.
    const coding = song([coded('a b ', 10), coded('c ', 11)])

    const out = lines(colorLyrics(plain('a b ', '', 'c '), coding)!.lyrics)

    expect(out.map((line) => line.timeSec)).toEqual([10, 11, 11])
  })

  it('carries the romaji splits to the shown line they belong to', () => {
    const coding = song([
      coded('one ', 10, ['saki'], { romajiSplits: [3, 7] }),
      coded('two ', 20),
      coded('three ', 30, ['saki'], { romajiSplits: [2] })
    ])

    const result = colorLyrics(synced('one ', 'twp ', 'three '), coding)

    expect(result!.colors.romajiSplits).toEqual([[3, 7], null, [2]])
    // A copy: the shown colors never share an array with the saved coding.
    expect(result!.colors.romajiSplits[0]).not.toBe(coding.lines[0]?.romajiSplits)
  })

  it("carries the song's extra singers", () => {
    const coding: SongColors = {
      ...song([coded('one ', 10)]),
      extra: [{ id: 'extra:fan', name: 'Fan', color: '#aa00ff' }]
    }

    const result = colorLyrics(synced('one '), coding)

    expect(result!.colors.extra).toEqual([{ id: 'extra:fan', name: 'Fan', color: '#aa00ff' }])
  })

  it('never adds, removes or reorders the shown lines of a song with nothing added', () => {
    const coding = song([coded('one ', 10), coded('two ', 20), coded('three ', 30)])
    const shown = synced('intro words ', 'one ', '', 'two ', 'extra ', 'three ', 'outro ')

    const result = colorLyrics(shown, coding)

    expect(lines(result!.lyrics).map((line) => line.text)).toEqual(lines(shown).map((l) => l.text))
    expect(result!.colors.lines).toHaveLength(7)
    expect(result!.colors.romajiSplits).toHaveLength(7)
    expect(result!.colors.lines.map((line) => line !== null)).toEqual([
      false,
      true,
      false,
      true,
      false,
      true,
      false
    ])
  })

  it('keeps what else the synced lyrics knew', () => {
    const coding = song([coded('one ', 10)])
    const shown: Lyrics = {
      kind: 'synced',
      source: 'autosync',
      wordsFrom: 'vocadb',
      plain: ['one '],
      from: { id: 7, artist: 'Someone', durationSec: 180, credit: 'singers' },
      lines: [{ timeSec: 4, text: 'one ' }]
    }

    const result = colorLyrics(shown, coding)

    expect(result!.lyrics).toMatchObject({
      kind: 'synced',
      source: 'autosync',
      wordsFrom: 'vocadb',
      plain: ['one '],
      from: { id: 7 }
    })
  })

  it('leaves the lyrics it was given as they were', () => {
    const coding = song([coded('one ', 10)])
    const shown = synced('one ', 'two ')
    const before = structuredClone(shown)

    colorLyrics(shown, coding)

    expect(shown).toEqual(before)
  })

  it('takes the coded timing without words for a coded line that has none, still marked coded', () => {
    const line = coded('one ', 10)
    line.words = []

    const result = colorLyrics(synced('one '), song([line]))

    expect(lines(result!.lyrics)[0]).toEqual({ timeSec: 10, text: 'one ' })
    // All of it was made a second voice: the screen draws its words (none), not its text.
    expect(result!.colors.lines[0]).toEqual([])
  })

  it('returns null when nothing matches', () => {
    const coding = song([coded('one two ', 10), coded('(oh) ', 11, ['saki'], { under: 0 })])

    expect(colorLyrics(synced('uno dos ', ''), coding)).toBeNull()
    expect(colorLyrics(plain('uno dos '), coding)).toBeNull()
    // A second voice's words are not a main line to match against.
    expect(colorLyrics(synced('(oh) '), coding)).toBeNull()
    expect(colorLyrics(synced(), coding)).toBeNull()
    expect(colorLyrics(plain(), coding)).toBeNull()
    expect(colorLyrics(synced('one two '), song([]))).toBeNull()
  })

  it('returns null for an instrumental', () => {
    const coding = song([coded('one two ', 10)])

    expect(colorLyrics({ kind: 'instrumental', source: 'lrclib' }, coding)).toBeNull()
  })
})

describe('colorLyrics and the lines the user added', () => {
  it('shows an added line at its time among synced lines, even as a guess', () => {
    const x: CodedLine = {
      text: 'X x',
      start: 20,
      end: 24,
      words: [
        { text: 'X ', start: 20, end: 22, singers: ['ichika'] },
        { text: 'x', start: 22, end: 24, singers: ['ichika'] }
      ],
      added: true,
      guessed: true
    }
    const coding = song([coded('A', 10, ['saki']), x, coded('C', 30, ['saki'])])

    const result = colorLyrics(at(['A', 10], ['C', 30]), coding)

    expect(texts(result!.lyrics)).toEqual(['A', 'X x', 'C'])
    expect(lines(result!.lyrics)[1]).toEqual({
      timeSec: 20,
      text: 'X x',
      words: [
        { text: 'X ', start: 20, end: 22 },
        { text: 'x', start: 22, end: 24 }
      ]
    })
    expect(result!.colors.lines).toEqual([[['saki']], [['ichika'], ['ichika']], [['saki']]])
    expect(result!.colors.romajiSplits).toHaveLength(3)
    expect(result!.colors.own?.kind).toBe('synced')
    expect(texts(result!.colors.own!)).toEqual(['A', 'C'])
  })

  it('an added line stands in for a like shown line, shown once', () => {
    const verse = '夜空に浮かぶ 小さな灯り'
    const coding = song([coded('A', 10), added(verse, 21, ['saki']), coded('C', 30)])

    const result = colorLyrics(at(['A', 10], ['夜空に浮かぶ　小さな灯り', 20], ['C', 30]), coding)

    const out = lines(result!.lyrics)
    expect(out).toHaveLength(3)
    expect(out[1]?.text).toBe(verse)
    expect(out[1]?.timeSec).toBe(21)
    expect(result!.colors.lines[1]).toEqual([['saki'], ['saki']])
    expect(texts(result!.colors.own!)).toEqual(['A', '夜空に浮かぶ　小さな灯り', 'C'])

    // Plain lyrics too: the user's words in the lyrics' line's place.
    const asPlain = colorLyrics(plain('A', '夜空に浮かぶ　小さな灯り', 'C'), coding)
    expect(asPlain!.lyrics).toEqual(plain('A', verse, 'C'))
    expect(asPlain!.colors.own).toEqual(plain('A', '夜空に浮かぶ　小さな灯り', 'C'))
  })

  it('an exact match shows the line once', () => {
    const coding = song([coded('A', 10), added('X x', 21, ['saki']), coded('C', 30)])

    const result = colorLyrics(at(['A', 10], ['X x', 20], ['C', 30]), coding)

    expect(texts(result!.lyrics)).toEqual(['A', 'X x', 'C'])
    // Still a guess, so the lyrics' own time wins, as for any line nobody timed.
    expect(lines(result!.lyrics)[1]?.timeSec).toBe(20)
    expect(result!.colors.lines[1]).toEqual([['saki'], ['saki']])
    expect(result!.colors).not.toHaveProperty('own')
  })

  it('an added line next to its own twin doesn’t take its row', () => {
    // A repeated line: the user added the first time it's sung, the lyrics have the second.
    const coding = song([
      coded('A', 10, ['saki']),
      added('hello', 18, ['ichika']),
      coded('hello', 22, ['saki']),
      coded('B', 30, ['saki'])
    ])

    const result = colorLyrics(at(['A', 10], ['hello', 22], ['B', 30]), coding)

    expect(lines(result!.lyrics).map((line) => [line.text, line.timeSec])).toEqual([
      ['A', 10],
      ['hello', 18],
      ['hello', 22],
      ['B', 30]
    ])
    expect(result!.colors.lines).toEqual([[['saki']], [['ichika']], [['saki']], [['saki']]])
    expect(texts(result!.colors.own!)).toEqual(['A', 'hello', 'B'])
  })

  it('an added line gives way only to a twin that isn’t added', () => {
    // The user added the same line twice; the lyrics have since gained the first.
    const coding = song([coded('A', 10), added('X', 15), added('X', 25), coded('B', 30)])

    const result = colorLyrics(at(['A', 10], ['X', 15], ['B', 30]), coding)

    // The lyrics' X is the first added one, shown once at 15; the second keeps its own time.
    expect(lines(result!.lyrics).map((line) => [line.text, line.timeSec])).toEqual([
      ['A', 10],
      ['X', 15],
      ['X', 25],
      ['B', 30]
    ])
  })

  it('each shown line is stood in for once', () => {
    const coding = song([
      coded('A', 10),
      added('夜空に浮かぶ 小さな灯り', 20),
      added('夜空に浮かぶ 小さな光', 24),
      coded('C', 30)
    ])

    const result = colorLyrics(
      at(['A', 10], ['夜空に浮かぶ　小さな灯り', 20], ['まだ見ぬ明日', 27], ['C', 30]),
      coding
    )

    // The more alike one stands in; the other goes in by its time, and takes no row of its own:
    // the unlike line stays.
    expect(lines(result!.lyrics).map((line) => [line.text, line.timeSec])).toEqual([
      ['A', 10],
      ['夜空に浮かぶ 小さな灯り', 20],
      ['夜空に浮かぶ 小さな光', 24],
      ['まだ見ぬ明日', 27],
      ['C', 30]
    ])
    expect(result!.colors.lines).toHaveLength(5)
    expect(texts(result!.colors.own!)).toEqual([
      'A',
      '夜空に浮かぶ　小さな灯り',
      'まだ見ぬ明日',
      'C'
    ])
  })

  it('a verse the lyrics gained shows once, every line of it', () => {
    const coding = song([
      coded('A', 10),
      added('夜空に浮かぶ 小さな灯り', 21),
      added('遠く 遠く 届くように', 26),
      coded('C', 30)
    ])

    const result = colorLyrics(
      at(['A', 10], ['夜空に浮かぶ　小さな灯り', 20], ['遠く　遠く　届くように', 25], ['C', 30]),
      coding
    )

    // Both of the lyrics' lines are left out, and the user's two show in their stead.
    expect(lines(result!.lyrics).map((line) => [line.text, line.timeSec])).toEqual([
      ['A', 10],
      ['夜空に浮かぶ 小さな灯り', 21],
      ['遠く 遠く 届くように', 26],
      ['C', 30]
    ])
    expect(texts(result!.colors.own!)).toEqual([
      'A',
      '夜空に浮かぶ　小さな灯り',
      '遠く　遠く　届くように',
      'C'
    ])
  })

  it('puts added rows by start among the lyrics’ own, then in coding order', () => {
    const coding = song([
      coded('A', 10),
      added('late', 26),
      added('early', 12),
      added('same', 12),
      added('tie', 15),
      coded('C', 30)
    ])

    const result = colorLyrics(at(['A', 10], ['B', 15], ['C', 30]), coding)

    // "tie" starts as B does, so it comes after it: only a later row goes behind an added one.
    expect(texts(result!.lyrics)).toEqual(['A', 'early', 'same', 'B', 'tie', 'late', 'C'])
  })

  it('plain lyrics take added lines in coding order', () => {
    // The lyrics' own lines aren't all timed, so the song stays plain.
    const coding = song([untimed('A', 10), added('X', 20, ['saki']), untimed('C', 30)])

    const result = colorLyrics(plain('A', '', 'C'), coding)

    expect(result!.lyrics).toEqual(plain('A', 'X', '', 'C'))
    expect(result!.colors.lines).toEqual([[['ichika']], [['saki']], null, [['ichika']]])
    expect(result!.colors.own).toEqual(plain('A', '', 'C'))

    // First when no shown coded line comes before it, and after an added row already put in.
    const more = song([
      added('W', 5),
      untimed('A', 10),
      added('X', 20),
      untimed('B', 22),
      added('Y', 24),
      untimed('C', 30)
    ])
    expect(colorLyrics(plain('A', '', 'C'), more)!.lyrics).toEqual(
      plain('W', 'A', 'X', 'Y', '', 'C')
    )
  })

  it('plain lyrics put an added verse before the next shown coded line when none before it shows', () => {
    // The lines before the verse have changed in these lyrics, so none of them is placed.
    const coding = song([
      untimed('伸ばした手を', 10),
      untimed('君の声が', 15),
      added('added verse', 20),
      untimed('P3', 30),
      untimed('P4', 35)
    ])

    const result = colorLyrics(plain('伸ばした手', '君の声', 'P3', 'P4'), coding)

    expect(result!.lyrics).toEqual(plain('伸ばした手', '君の声', 'added verse', 'P3', 'P4'))
  })

  it('plain lyrics timed through by hand turn synced, a guessed added line at its start', () => {
    const shown = plain('A', '', 'C')

    const result = colorLyrics(shown, song([coded('A', 10), added('X', 20), coded('C', 30)]))

    // The rows the user didn't add are exactly as they'd be with nothing added.
    expect(lines(result!.lyrics).map((line) => [line.text, line.timeSec])).toEqual([
      ['A', 10],
      ['', 11],
      ['X', 20],
      ['C', 30]
    ])
    expect(lines(result!.lyrics)[2]?.words).toEqual([{ text: 'X', start: 20, end: 21 }])
    expect(result!.colors.lines).toEqual([[['ichika']], null, [['ichika']], [['ichika']]])
    expect(result!.colors.own).toEqual({
      kind: 'synced',
      source: 'vocadb',
      lines: [
        { timeSec: 10, text: 'A', words: [{ text: 'A', start: 10, end: 11 }] },
        { timeSec: 11, text: '' },
        { timeSec: 30, text: 'C', words: [{ text: 'C', start: 30, end: 31 }] }
      ]
    })
  })

  it('only the lyrics’ own lines turn plain lyrics synced', () => {
    // The added line is timed, but one of the lyrics' own isn't: still plain, in coding order.
    const coding = song([
      untimed('A', 10),
      coded('X', 20, ['ichika'], { added: true }),
      coded('C', 30)
    ])

    const result = colorLyrics(plain('A', '', 'C'), coding)

    expect(result!.lyrics).toEqual(plain('A', 'X', '', 'C'))
    expect(result!.colors.own).toEqual(plain('A', '', 'C'))
  })

  it('a row stood in for keeps plain lyrics plain: it is one of their own, and nobody timed it', () => {
    const verse = '夜空に浮かぶ 小さな灯り'
    const coding = song([
      coded('A', 10),
      coded(verse, 20, ['ichika'], { added: true }),
      coded('C', 30)
    ])

    const result = colorLyrics(plain('A', '夜空に浮かぶ　小さな灯り', 'C'), coding)

    expect(result!.lyrics).toEqual(plain('A', verse, 'C'))
    expect(result!.colors.own).toEqual(plain('A', '夜空に浮かぶ　小さな灯り', 'C'))
  })

  it('second voices follow their rows after lines are put in', () => {
    const coding = song([
      coded('A', 10),
      added('X', 20),
      untimed('(x)', 20.5, ['saki'], { under: 1, guessed: true }),
      coded('C', 30),
      coded('(c)', 30.5, ['saki'], { under: 3 })
    ])

    const result = colorLyrics(at(['A', 10], ['C', 30]), coding)

    expect(result!.colors.voices).toEqual([
      // Under an added line it keeps its own times: there's no shown line to move it onto.
      { under: 1, words: [{ text: '(x)', start: 20.5, end: 21.5 }], singers: [['saki']] },
      { under: 2, words: [{ text: '(c)', start: 30.5, end: 31.5 }], singers: [['saki']] }
    ])
    // Plain lyrics (not all timed, so in coding order): under X's row 1, and C's row 3.
    const plainCoding = song([
      untimed('A', 10),
      added('X', 20),
      untimed('(x)', 20.5, ['saki'], { under: 1, guessed: true }),
      untimed('C', 30),
      coded('(c)', 30.5, ['saki'], { under: 3 })
    ])
    const fromPlain = colorLyrics(plain('A', '', 'C'), plainCoding)
    expect(fromPlain!.colors.voices.map((voice) => voice.under)).toEqual([1, 3])
  })

  it('romaji splits follow their rows', () => {
    const coding = song([
      coded('A', 10, ['ichika'], { romajiSplits: [1] }),
      added('X', 20, ['ichika'], { romajiSplits: [2] }),
      coded('C', 30, ['ichika'], { romajiSplits: [3] })
    ])

    const result = colorLyrics(at(['A', 10], ['B', 15], ['C', 30]), coding)

    expect(texts(result!.lyrics)).toEqual(['A', 'B', 'X', 'C'])
    expect(result!.colors.romajiSplits).toEqual([[1], null, [2], [3]])
    expect(result!.colors.romajiSplits[2]).not.toBe(coding.lines[1]?.romajiSplits)
  })

  it('nothing shows when only an added line matches', () => {
    const coding = song([coded('A', 10), added('X x', 20), coded('C', 30)])

    expect(colorLyrics(at(['A2', 10], ['X x', 20], ['C2', 30]), coding)).toBeNull()
    expect(colorLyrics(plain('A2', 'X x', 'C2'), coding)).toBeNull()
  })

  it('a song without added lines comes out as before', () => {
    // The fixture of "keeps matched lines and drops changed ones".
    const syncedCoding = song([
      coded('one two ', 10, ['saki']),
      coded('three four ', 20, ['ichika']),
      coded('five six ', 30, ['saki', 'ichika'])
    ])
    const fromSynced = colorLyrics(synced('one two ', 'three for ', 'five six '), syncedCoding)

    expect(lines(fromSynced!.lyrics)).toEqual([
      {
        timeSec: 10,
        text: 'one two ',
        words: [
          { text: 'one ', start: 10, end: 11 },
          { text: 'two ', start: 11, end: 12 }
        ]
      },
      { timeSec: 15, text: 'three for ' },
      {
        timeSec: 30,
        text: 'five six ',
        words: [
          { text: 'five ', start: 30, end: 31 },
          { text: 'six ', start: 31, end: 32 }
        ]
      }
    ])
    expect(fromSynced!.colors.lines).toEqual([
      [['saki'], ['saki']],
      null,
      [
        ['saki', 'ichika'],
        ['saki', 'ichika']
      ]
    ])
    expect(fromSynced!.colors).not.toHaveProperty('own')

    // The fixture of "plain lyrics fully coded become synced".
    const plainCoding = song([
      coded('one two ', 10, ['saki']),
      coded('three four ', 20, ['ichika'])
    ])
    const fromPlain = colorLyrics(
      {
        kind: 'plain',
        lines: ['one two ', '', 'three four '],
        source: 'ytmusic',
        credit: 'Musixmatch'
      },
      plainCoding
    )

    expect(fromPlain!.lyrics).toMatchObject({
      kind: 'synced',
      source: 'ytmusic',
      credit: 'Musixmatch'
    })
    expect(lines(fromPlain!.lyrics).map((line) => [line.text, line.timeSec])).toEqual([
      ['one two ', 10],
      ['', 12],
      ['three four ', 20]
    ])
    expect(fromPlain!.colors.lines).toEqual([[['saki'], ['saki']], null, [['ichika'], ['ichika']]])
    expect(fromPlain!.colors).not.toHaveProperty('own')
  })
})

describe('colorLyrics and music breaks the user marked', () => {
  /** A break as the editor adds it: an added line with no words. */
  const pause = (start: number, end: number): CodedLine => ({
    text: '',
    start,
    end,
    words: [],
    added: true,
    guessed: true,
    instrumental: true
  })

  it('shows a break in synced lyrics as a row of its own at its start, the note’s row', () => {
    const coding = song([coded('one ', 100), pause(103, 110), coded('two ', 110)])
    const result = colorLyrics(synced('one ', 'two '), coding)
    expect(lines(result!.lyrics)).toEqual([
      { timeSec: 100, text: 'one ', words: [{ text: 'one ', start: 100, end: 101 }] },
      { timeSec: 103, text: '' },
      { timeSec: 110, text: 'two ', words: [{ text: 'two ', start: 110, end: 111 }] }
    ])
    // Nobody sings a break: an empty list, like a line with no words.
    expect(result!.colors.lines).toEqual([[['ichika']], [], [['ichika']]])
  })

  it('never stands in for the lyrics’ own gap or line, nor shows in untimed lyrics', () => {
    const coding = song([untimed('one ', 100), pause(103, 110), untimed('two ', 110)])
    const fromPlain = colorLyrics(plain('one ', '', 'two '), coding)
    expect(fromPlain!.lyrics).toEqual(plain('one ', '', 'two '))
    const withGap = colorLyrics(
      synced('one ', '', 'two '),
      song([coded('one ', 100), pause(106, 109), coded('two ', 110)])
    )
    expect(texts(withGap!.lyrics)).toEqual(['one ', '', '', 'two '])
  })
})
