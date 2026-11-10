import { describe, expect, it } from 'vitest'
import type { Lyrics } from '../../../main/ipc'
import { colorLyrics } from '../../../main/services/lyrics/singers/apply'
import { applyEdit } from '../../../main/services/lyrics/singers/edit'
import type { CodedWord, SongColors } from '../../../main/services/lyrics/singers/types'
import { lineWords, syncedRows, type GlideRow } from './lyricsGlide'
import { rowPaint, singerHexes } from './singerColors'

// The whole way from a coding the editor changed to what the Focus Screen draws.

const night = (ids: readonly string[]): string[] => singerHexes(ids, [], '#191919')

const TEXT = 'I wait for you (for you)'

function word(text: string, start: number, singers: string[] | null): CodedWord {
  return { text, start, end: start + 0.5, singers }
}

/** "I wait" Miku's, "for you" Ichika's, the echo nobody's yet. */
function coding(): SongColors {
  return {
    version: 1,
    lines: [
      {
        text: TEXT,
        start: 10,
        end: 14,
        words: [
          word('I ', 10, ['miku']),
          word('wait ', 10.5, ['miku']),
          word('for ', 11, ['ichika']),
          word('you ', 11.5, ['ichika']),
          word('(for ', 12, null),
          word('you)', 12.5, null)
        ]
      }
    ],
    cast: ['miku', 'ichika'],
    extra: []
  }
}

describe('a line after "Make second voice", on the Focus Screen', () => {
  const shown: Lyrics = {
    kind: 'synced',
    source: 'lrclib',
    lines: [
      { timeSec: 10, text: TEXT },
      { timeSec: 20, text: 'next line' }
    ]
  }

  /** The main line's row (an intro row of dots comes before it). */
  function mainRow(): GlideRow {
    const voiced = applyEdit(coding(), { kind: 'makeVoice', line: 0, from: 4, to: 6 })
    const colored = colorLyrics(shown, voiced)
    if (!colored || colored.lyrics.kind !== 'synced') throw new Error('not colored')
    const row = syncedRows(colored.lyrics.lines, null, colored.colors).find(
      (one) => one.text === TEXT
    )
    if (!row) throw new Error('no row')
    return row
  }

  it('draws only the words the main line kept, timed', () => {
    const main = mainRow()

    const words = lineWords(main, 20)

    expect(words.timed).toBe(true)
    expect(words.words.map((one) => one.text)).toEqual(['I ', 'wait ', 'for ', 'you '])
    expect(words.words.map((one) => one.start)).toEqual([10, 10.5, 11, 11.5])
  })

  it('colors each kept word by its singer, and the echo once, under it', () => {
    const main = mainRow()

    const paint = rowPaint(main, lineWords(main, 20), night)

    expect(paint?.parts).toEqual([
      { from: 0, to: 2, colors: night(['miku']) },
      { from: 2, to: 4, colors: night(['ichika']) }
    ])
    expect(main.voices?.map((voice) => voice.words.map((one) => one.text))).toEqual([
      ['for ', 'you']
    ])
  })
})
