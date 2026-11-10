import { describe, expect, it } from 'vitest'
import type { LyricsPickerState, PickerRow } from '../../../main/services/lyrics/pickerTypes'
import {
  footActions,
  formatLength,
  LISTEN_HINT,
  lengthNote,
  pickerHeading,
  rowDetail,
  sameLength,
  searchText,
  statusLine
} from './pickerRows'

const nightcord: PickerRow = {
  id: 10604292,
  title: 'アイロニ',
  artist: '25時、ナイトコードで。',
  album: '25時、ナイトコードで。 SEKAI ALBUM vol.2',
  durationSec: 251,
  kind: 'synced',
  tags: ['same singers']
}

const listed: LyricsPickerState = {
  open: true,
  busy: null,
  song: { title: 'irony', artist: 'Nightcord at 25:00', durationSec: 251 },
  rows: [nightcord],
  picked: 'automatic',
  listen: 'ready',
  message: null
}

describe('formatLength', () => {
  it('reads like a player: minutes and seconds', () => {
    expect(formatLength(251)).toBe('4:11')
    expect(formatLength(65)).toBe('1:05')
  })

  it('rounds LRCLIB’s fractional lengths to the nearest second', () => {
    expect(formatLength(250.6)).toBe('4:11')
    expect(formatLength(250.4)).toBe('4:10')
  })

  it('counts hours past an hour', () => {
    expect(formatLength(3723)).toBe('1:02:03')
  })

  it('says nothing for a length it doesn’t know', () => {
    expect(formatLength(0)).toBe('')
    expect(formatLength(-3)).toBe('')
    expect(formatLength(Number.NaN)).toBe('')
  })
})

describe('lengthNote', () => {
  it('names the playing song’s length', () => {
    expect(lengthNote(251)).toBe('your song is 4:11')
  })

  it('is empty for a stream without a length', () => {
    expect(lengthNote(0)).toBe('')
  })
})

describe('pickerHeading', () => {
  it('names the song and its length', () => {
    expect(pickerHeading(listed.song)).toBe('Lyrics for irony · your song is 4:11')
  })

  it('leaves the length out when the player doesn’t know it', () => {
    expect(pickerHeading({ title: 'irony', artist: 'x', durationSec: 0 })).toBe('Lyrics for irony')
  })

  it('still has a heading with no song', () => {
    expect(pickerHeading(null)).toBe('Other lyrics')
  })
})

describe('rowDetail', () => {
  it('gives the title and album, and whether it’s timed on its own, so a long album can’t hide it', () => {
    expect(rowDetail(nightcord)).toEqual({
      names: 'アイロニ · 25時、ナイトコードで。 SEKAI ALBUM vol.2',
      kind: 'synced'
    })
  })

  it('skips what LRCLIB left empty', () => {
    expect(rowDetail({ ...nightcord, album: '', kind: 'plain' })).toEqual({
      names: 'アイロニ',
      kind: 'plain'
    })
    expect(rowDetail({ ...nightcord, title: ' ', album: '', kind: 'instrumental' })).toEqual({
      names: '',
      kind: 'instrumental'
    })
  })
})

describe('sameLength', () => {
  it('is the same when both read the same on screen', () => {
    expect(sameLength(251, 251)).toBe(true)
    expect(sameLength(250.7, 251)).toBe(true)
    expect(sameLength(250, 251)).toBe(false)
  })

  it('is never the same when either length is unknown', () => {
    expect(sameLength(0, 0)).toBe(false)
    expect(sameLength(251, 0)).toBe(false)
  })
})

describe('footActions', () => {
  const kinds = (
    picked: LyricsPickerState['picked'],
    listen: LyricsPickerState['listen']
  ): string[] => footActions(picked, listen).map((action) => action.kind)

  it('offers back to automatic only after a pick', () => {
    expect(kinds('automatic', 'ready')).toEqual(['listen', 'search', 'none'])
    expect(kinds('version', 'ready')).toEqual(['automatic', 'listen', 'search', 'none'])
  })

  it('hides timing by listening where auto-sync can’t run', () => {
    expect(kinds('automatic', 'unsupported')).toEqual(['search', 'none'])
  })

  it('says how to turn auto-sync on when it’s off', () => {
    const listen = footActions('automatic', 'off').find((action) => action.kind === 'listen')
    expect(listen?.disabled).toBe(true)
    expect(listen?.hint).toBe(LISTEN_HINT)
    expect(LISTEN_HINT).toBe('Turn on Auto-sync plain lyrics in Customize › Music')
  })

  it('marks the choice that’s in force', () => {
    const current = (picked: LyricsPickerState['picked']): string[] =>
      footActions(picked, 'ready')
        .filter((action) => action.current)
        .map((action) => action.kind)
    expect(current('listen')).toEqual(['listen'])
    expect(current('none')).toEqual(['none'])
    expect(current('automatic')).toEqual([])
    expect(current('version')).toEqual([])
  })

  it('uses the plan’s words', () => {
    expect(footActions('version', 'ready').map((action) => action.label)).toEqual([
      'Back to automatic',
      'Time them by listening',
      'Search with other words…',
      'No lyrics for this song'
    ])
  })
})

describe('statusLine', () => {
  it('says it’s looking while busy, over an older message', () => {
    expect(statusLine({ ...listed, busy: 'loading', rows: [] })).toBe('Looking…')
    expect(statusLine({ ...listed, busy: 'searching', message: 'old news' })).toBe('Looking…')
  })

  it('shows main’s message', () => {
    expect(statusLine({ ...listed, rows: [], message: "Can't reach LRCLIB right now" })).toBe(
      "Can't reach LRCLIB right now"
    )
  })

  it('says so when LRCLIB has nothing to list', () => {
    expect(statusLine({ ...listed, rows: [] })).toBe('LRCLIB has no versions to list')
  })

  it('is quiet when there are rows and nothing to say', () => {
    expect(statusLine(listed)).toBeNull()
  })
})

describe('searchText', () => {
  it('trims what was typed', () => {
    expect(searchText('  アイロニ nightcord  ')).toBe('アイロニ nightcord')
  })

  it('refuses empty or blank text', () => {
    expect(searchText('')).toBeNull()
    expect(searchText('   \n ')).toBeNull()
  })

  it('caps it at 200 characters', () => {
    expect(searchText('a'.repeat(250))).toHaveLength(200)
  })
})
