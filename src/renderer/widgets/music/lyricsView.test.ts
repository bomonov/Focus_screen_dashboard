import { describe, expect, it } from 'vitest'
import type { LyricsState, SyncedLine, Track } from '../../../main/ipc'
import { AD_TRACK_ID } from '../../../main/services/music/types'
import {
  colorsShown,
  formatOffset,
  lineChanges,
  lyricsCaption,
  lyricsLayout,
  type ShownLyrics
} from './lyricsView'

const track: Track = {
  id: 'a',
  title: 'Song',
  artist: 'Artist',
  album: '',
  durationSec: 200,
  artwork: null
}

const LINES: SyncedLine[] = [
  { timeSec: 10, text: 'One' },
  { timeSec: 15, text: 'Two' },
  { timeSec: 20, text: '' },
  { timeSec: 30, text: 'Three' }
]

function state(change: Partial<LyricsState>): LyricsState {
  return { trackId: 'a', status: 'found', lyrics: null, offsetSec: 0, romaji: null, ...change }
}

describe('lyricsLayout', () => {
  const synced = { kind: 'synced', lines: LINES, source: 'lrclib' } as const

  it('shows lyrics for the song on screen', () => {
    expect(lyricsLayout(true, track, state({ lyrics: synced }))).toEqual({
      kind: 'lyrics',
      lyrics: synced,
      romaji: null
    })
  })

  it('passes romaji along only when it has one entry per line', () => {
    const romaji = ['ichi', 'ni', '', 'san']
    expect(lyricsLayout(true, track, state({ lyrics: synced, romaji }))).toMatchObject({ romaji })
    expect(lyricsLayout(true, track, state({ lyrics: synced, romaji: ['ichi'] }))).toMatchObject({
      romaji: null
    })
  })

  it('passes the singer colors along only when they line up with the lines', () => {
    const colors = {
      lines: [[['miku']], null, null, [['ichika']]],
      voices: [],
      romajiSplits: [null, null, null, null],
      extra: []
    }
    expect(lyricsLayout(true, track, state({ lyrics: synced, colors }))).toEqual({
      kind: 'lyrics',
      lyrics: synced,
      romaji: null,
      colors
    })
    const short = { ...colors, lines: [[['miku']]] }
    expect(lyricsLayout(true, track, state({ lyrics: synced, colors: short }))).toEqual({
      kind: 'lyrics',
      lyrics: synced,
      romaji: null
    })
  })

  it('keeps the panel up while looking, including before the lookup reaches the screen', () => {
    expect(lyricsLayout(true, track, state({ status: 'loading' }))).toEqual({
      kind: 'lyrics',
      lyrics: null,
      romaji: null
    })
    expect(lyricsLayout(true, track, state({ trackId: 'old', lyrics: synced }))).toEqual({
      kind: 'lyrics',
      lyrics: null,
      romaji: null
    })
  })

  it('shows the big record, with a reason, when there are no lyrics to show', () => {
    expect(lyricsLayout(true, track, state({ status: 'notFound' }))).toEqual({
      kind: 'art',
      note: 'No lyrics found'
    })
    expect(
      lyricsLayout(true, track, state({ lyrics: { kind: 'instrumental', source: 'lrclib' } }))
    ).toEqual({ kind: 'art', note: 'Instrumental' })
    expect(lyricsLayout(true, track, state({ status: 'unavailable' }))).toMatchObject({
      kind: 'art'
    })
  })

  it('points to YouTube Music’s Lyrics tab when it’s the player and nobody has the song', () => {
    expect(
      lyricsLayout(
        true,
        { ...track, id: 'ytm:STmgdRrgpjk' },
        state({ trackId: 'ytm:STmgdRrgpjk', status: 'notFound' })
      )
    ).toEqual({
      kind: 'art',
      note: 'No lyrics found · open YouTube Music’s Lyrics tab to use its lyrics'
    })
  })

  it('shows the big record without a note when lyrics are off, for ads, and with no song', () => {
    const art = { kind: 'art', note: null }
    expect(lyricsLayout(false, track, state({ lyrics: synced }))).toEqual(art)
    expect(lyricsLayout(true, null, null)).toEqual(art)
    expect(lyricsLayout(true, { ...track, id: AD_TRACK_ID }, null)).toEqual(art)
    expect(lyricsLayout(true, track, state({ trackId: null, status: 'idle' }))).toEqual(art)
  })
})

describe('lineChanges', () => {
  it('moves the changes earlier when lyrics should show sooner', () => {
    expect(lineChanges(LINES, 0.5)).toEqual([9.5, 14.5, 19.5, 29.5])
  })

  it('wakes when a second voice starts and ends too, in order', () => {
    const voices = [{ under: 1, words: [{ text: 'echo', start: 17, end: 21 }], singers: [null] }]
    expect(lineChanges(LINES, 0.5, voices)).toEqual([9.5, 14.5, 16.5, 19.5, 20.5, 29.5])
  })
})

describe('captions', () => {
  it('formats offsets', () => {
    expect(formatOffset(0)).toBeNull()
    expect(formatOffset(0.5)).toBe('0.5 s earlier')
    expect(formatOffset(-1)).toBe('1 s later')
  })

  it('names the source and timing', () => {
    expect(lyricsCaption({ kind: 'synced', lines: LINES, source: 'lrclib' }, 0)).toBe(
      'Synced lyrics · LRCLIB'
    )
    expect(lyricsCaption({ kind: 'synced', lines: LINES, source: 'lrclib' }, -1.5)).toBe(
      'Synced lyrics · LRCLIB · 1.5 s later'
    )
    expect(lyricsCaption({ kind: 'plain', lines: ['a'], source: 'demo' }, 1)).toBe(
      'Lyrics · Demo · not synced'
    )
    expect(lyricsCaption(null, 0)).toBe('Looking up lyrics')
    expect(lyricsCaption({ kind: 'synced', lines: LINES, source: 'autosync' }, 0)).toBe(
      'Synced lyrics · Auto-synced (estimate)'
    )
  })

  it('credits YouTube Music and whoever it names, also once timed', () => {
    expect(
      lyricsCaption({ kind: 'plain', lines: ['a'], source: 'ytmusic', credit: 'Musixmatch' }, 0)
    ).toBe('Lyrics · YouTube Music · Musixmatch · not synced')
    expect(
      lyricsCaption(
        {
          kind: 'synced',
          lines: LINES,
          source: 'autosync',
          wordsFrom: 'ytmusic',
          credit: 'LyricFind'
        },
        0
      )
    ).toBe('Synced lyrics · YouTube Music · LyricFind · Auto-synced (estimate)')
  })

  it('credits VocaDB for romaji, once', () => {
    const synced = { kind: 'synced', lines: LINES, source: 'lrclib' } as const
    expect(lyricsCaption(synced, 0, null, 'vocadb')).toBe(
      'Synced lyrics · LRCLIB · romaji · VocaDB'
    )
    expect(
      lyricsCaption({ kind: 'plain', lines: ['a'], source: 'vocadb' }, 0, null, 'vocadb')
    ).toBe('Lyrics · VocaDB · with romaji · not synced')
  })

  it('says when romaji was made on this computer, all of it or where VocaDB had none', () => {
    const synced = { kind: 'synced', lines: LINES, source: 'lrclib' } as const
    expect(lyricsCaption(synced, 0, null, 'dictionary')).toBe(
      'Synced lyrics · LRCLIB · romaji made on this computer'
    )
    expect(lyricsCaption(synced, 0, null, 'both')).toBe(
      'Synced lyrics · LRCLIB · romaji · VocaDB, some made on this computer'
    )
    expect(lyricsCaption({ kind: 'plain', lines: ['a'], source: 'vocadb' }, 0, null, 'both')).toBe(
      'Lyrics · VocaDB · with romaji, some made on this computer · not synced'
    )
  })

  it('the caption says colors by you', () => {
    const synced = { kind: 'synced', lines: LINES, source: 'lrclib' } as const
    expect(lyricsCaption(synced, 0, null, null, true)).toBe(
      'Synced lyrics · LRCLIB · colors by you'
    )
    expect(lyricsCaption(synced, 0, null, 'vocadb', true)).toBe(
      'Synced lyrics · LRCLIB · romaji · VocaDB · colors by you'
    )
    // Plain VocaDB words the user timed while coloring keep VocaDB's credit.
    const timedByYou = { kind: 'synced', lines: LINES, source: 'vocadb' } as const
    expect(lyricsCaption(timedByYou, 0, null, 'vocadb', true)).toBe(
      'Synced lyrics · VocaDB · with romaji · colors by you'
    )
    expect(
      lyricsCaption({ kind: 'plain', lines: ['a'], source: 'vocadb' }, 0, null, null, true)
    ).toBe('Lyrics · VocaDB · colors by you · not synced')
    expect(lyricsCaption(synced, 0, null, null, false)).toBe('Synced lyrics · LRCLIB')
  })

  it('says colors by you only when some line or voice is colored', () => {
    const none = { lines: [null, null], voices: [], romajiSplits: [null, null], extra: [] }
    expect(colorsShown(null)).toBe(false)
    expect(colorsShown(undefined)).toBe(false)
    expect(colorsShown(none)).toBe(false)
    expect(colorsShown({ ...none, lines: [null, [['miku']]] })).toBe(true)
    const voice = { under: 0, words: [{ text: 'echo', start: 1, end: 2 }], singers: [['miku']] }
    expect(colorsShown({ ...none, voices: [voice] })).toBe(true)
  })

  it('doesn’t say colors by you for lines and voices nobody was given yet', () => {
    // A song just begun in the editor: every line is coded, none has a singer.
    const begun = {
      lines: [[null, null], null, []],
      voices: [{ under: 0, words: [{ text: 'echo', start: 1, end: 2 }], singers: [null] }],
      romajiSplits: [null, null, null],
      extra: []
    }
    expect(colorsShown(begun)).toBe(false)
    expect(colorsShown({ ...begun, lines: [[null, ['miku']], null, []] })).toBe(true)
  })

  it('doesn’t credit VocaDB for the demo’s own romaji', () => {
    const demo = { kind: 'synced', lines: LINES, source: 'demo' } as const
    expect(lyricsCaption(demo, 0, null, 'vocadb')).toBe('Synced lyrics · Demo · with romaji')
  })

  it('credits VocaDB for its words, also once they are timed', () => {
    expect(lyricsCaption({ kind: 'plain', lines: ['a'], source: 'vocadb' }, 0)).toBe(
      'Lyrics · VocaDB · not synced'
    )
    const timed: ShownLyrics = {
      kind: 'synced',
      lines: LINES,
      source: 'autosync',
      wordsFrom: 'vocadb'
    }
    expect(lyricsCaption(timed, 0.5)).toBe(
      'Synced lyrics · VocaDB · Auto-synced (estimate) · 0.5 s earlier'
    )
  })

  it('says how far auto-sync has got with plain lyrics', () => {
    const plain: ShownLyrics = { kind: 'plain', lines: ['a'], source: 'lrclib' }
    expect(lyricsCaption(plain, 0, { stage: 'listening', heard: 0.47 })).toBe(
      'Lyrics · LRCLIB · auto-syncing · 40% heard'
    )
    expect(lyricsCaption(plain, 0, { stage: 'aligning', heard: 1 })).toBe(
      'Lyrics · LRCLIB · timing the lines…'
    )
    expect(lyricsCaption(plain, 0, { stage: 'listening', heard: 0.52, live: true })).toBe(
      'Lyrics · LRCLIB · following live · 50% heard'
    )
  })
})
