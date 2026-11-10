import { describe, expect, it } from 'vitest'
import type { PageState } from '../../src/main/services/music/extension-ws/protocol'
import {
  bestArtwork,
  chooseTab,
  clicksToRepeat,
  lineRetryMs,
  lyricsCredit,
  NEW_LYRICS_WATCH,
  parseAppMessage,
  parseQueueDuration,
  parseRepeatTitle,
  queueCover,
  splitByline,
  stateChanged,
  toBase64,
  type TabEntry,
  upNextIndex,
  watchLyrics
} from './page'

// Values as read from music.youtube.com on 2026-10-13.
const song: PageState = {
  videoId: 'xukbqwRuN5w',
  playlistId: 'PLx7Gk2mQ9vR4tYb_Lw-8sNc3dHfJ0aZpE',
  title: "Choosin' Texas",
  artist: 'Ella Langley',
  album: 'Dandelion',
  durationSec: 232,
  positionSec: 8,
  playing: true,
  shuffle: null,
  repeat: 'off',
  artworkUrl: 'https://yt3.googleusercontent.com/pXFQ=w544-h544',
  ad: false
}

describe('repeat button', () => {
  it('reads the button title', () => {
    expect(parseRepeatTitle('Repeat off')).toBe('off')
    expect(parseRepeatTitle('Repeat all')).toBe('all')
    expect(parseRepeatTitle('Repeat one')).toBe('one')
    expect(parseRepeatTitle(null)).toBe('off')
  })

  it('counts clicks around off → all → one', () => {
    expect(clicksToRepeat('off', 'one')).toBe(2)
    expect(clicksToRepeat('one', 'off')).toBe(1)
    expect(clicksToRepeat('all', 'off')).toBe(2)
    expect(clicksToRepeat('all', 'all')).toBe(0)
  })
})

describe('splitByline', () => {
  it('takes artist and album, dropping a bare year', () => {
    expect(splitByline('Ella Langley • Dandelion • 2026')).toEqual({
      artist: 'Ella Langley',
      album: 'Dandelion'
    })
    expect(splitByline('Lofi Desk Club • 2021')).toEqual({ artist: 'Lofi Desk Club', album: '' })
    expect(splitByline('')).toEqual({ artist: '', album: '' })
  })
})

describe('bestArtwork', () => {
  it('picks the biggest cover up to 600 px', () => {
    const art = [
      { src: 'a', sizes: '60x60' },
      { src: 'b', sizes: '544x544' },
      { src: 'c', sizes: '1200x1200' }
    ]
    expect(bestArtwork(art)).toBe('b')
    expect(bestArtwork([{ src: 'big', sizes: '1200x1200' }])).toBe('big')
    expect(bestArtwork([{ src: 'nosize' }])).toBe('nosize')
    expect(bestArtwork([])).toBeNull()
  })
})

describe('stateChanged', () => {
  it('sends the first reading and any change other than position', () => {
    expect(stateChanged(undefined, song, 0)).toBe(true)
    expect(stateChanged(song, { ...song, playing: false }, 0)).toBe(true)
    expect(stateChanged(song, { ...song, repeat: 'one' }, 0)).toBe(true)
    // Autoplay carrying on past the end of a playlist keeps the song but swaps the list.
    expect(stateChanged(song, { ...song, playlistId: 'RDAMVMxukbqwRuN5w' }, 0)).toBe(true)
    expect(stateChanged(song, { ...song, playlistId: null }, 0)).toBe(true)
    expect(stateChanged(song, null, 0)).toBe(true)
    expect(stateChanged(null, null, 0)).toBe(false)
  })

  it('treats a playing song moving on time as no news, and a jump as a seek', () => {
    expect(stateChanged(song, { ...song, positionSec: 11 }, 3)).toBe(false)
    expect(stateChanged(song, { ...song, positionSec: 60 }, 3)).toBe(true)
    const paused = { ...song, playing: false }
    expect(stateChanged(paused, paused, 30)).toBe(false)
  })
})

describe('chooseTab', () => {
  const entry = (state: PageState | null, at: number): TabEntry => ({ state, at })

  it('prefers a playing tab, keeping the current one when it plays', () => {
    const tabs = new Map([
      [1, entry({ ...song, playing: false }, 5)],
      [2, entry(song, 1)],
      [3, entry(song, 2)]
    ])
    expect(chooseTab(tabs, 1)).toBe(2)
    expect(chooseTab(tabs, 3)).toBe(3)
  })

  it('keeps the current paused tab, else the latest one with a song', () => {
    const paused = { ...song, playing: false }
    const tabs = new Map([
      [1, entry(paused, 1)],
      [2, entry(paused, 9)],
      [3, entry(null, 20)]
    ])
    expect(chooseTab(tabs, 1)).toBe(1)
    expect(chooseTab(tabs, null)).toBe(2)
    expect(chooseTab(new Map([[3, entry(null, 1)]]), 3)).toBeNull()
  })
})

describe('parseAppMessage', () => {
  it('passes the app’s messages', () => {
    expect(parseAppMessage({ type: 'welcome' })).toEqual({ type: 'welcome' })
    expect(
      parseAppMessage({ type: 'command', command: { kind: 'setRepeat', mode: 'one' } })
    ).toEqual({
      type: 'command',
      command: { kind: 'setRepeat', mode: 'one' }
    })
    expect(parseAppMessage({ type: 'artworkRequest', requestId: 2, url: 'https://x' })).toEqual({
      type: 'artworkRequest',
      requestId: 2,
      url: 'https://x'
    })
  })

  it('drops anything else, whoever sent it', () => {
    expect(parseAppMessage({ type: 'command', command: { kind: 'deleteLibrary' } })).toBeNull()
    expect(parseAppMessage({ type: 'paired', token: '' })).toBeNull()
    expect(parseAppMessage({ type: 'rejected', reason: 'because' })).toBeNull()
    expect(parseAppMessage('welcome')).toBeNull()
  })
})

describe('toBase64', () => {
  it('round-trips, also for covers bigger than one chunk', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 7) % 256)
    const decoded = Uint8Array.from(atob(toBase64(bytes)), (char) => char.charCodeAt(0))
    expect(decoded).toEqual(bytes)
    expect(toBase64(Uint8Array.from([1, 2, 3]))).toBe('AQID')
  })
})

describe('lineRetryMs', () => {
  it('reopens a line that held at once, without a timer', () => {
    expect(lineRetryMs(30_000, 0)).toBe(0)
    expect(lineRetryMs(5000, 8000)).toBe(0)
  })

  it('backs off while the line keeps closing straight away, up to 30 s', () => {
    let wait = 0
    const waits = Array.from({ length: 7 }, () => (wait = lineRetryMs(10, wait)))
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000])
  })
})

describe('watchLyrics', () => {
  /** Looks at the panel once per call, a second apart; returns what was sent along the way. */
  function run(looks: { song: string; panel: string | null; shown: boolean }[]): (string | null)[] {
    let watch = NEW_LYRICS_WATCH
    return looks.map((look, index) => {
      const result = watchLyrics(watch, look.song, look.panel, look.shown, index * 1000)
      watch = result.watch
      return result.send
    })
  }

  it('sends a song’s words once they hold still, and only once', () => {
    const look = { song: 'a', panel: 'A words', shown: true }
    expect(run([look, look, look, look])).toEqual([null, 'A words', null, null])
  })

  it('never sends the last song’s words, still on screen after a change, for the next', () => {
    expect(
      run([
        { song: 'a', panel: 'A words', shown: true },
        { song: 'a', panel: 'A words', shown: true },
        { song: 'b', panel: 'A words', shown: true },
        { song: 'b', panel: 'A words', shown: true },
        { song: 'b', panel: 'B words', shown: true },
        { song: 'b', panel: 'B words', shown: true }
      ])
    ).toEqual([null, 'A words', null, null, null, 'B words'])
  })

  it('ignores the hidden panel the collapsed player keeps, even once it shows again', () => {
    expect(
      run([
        { song: 'a', panel: 'A words', shown: false },
        { song: 'b', panel: 'A words', shown: false },
        { song: 'b', panel: 'A words', shown: true },
        { song: 'b', panel: 'A words', shown: true }
      ])
    ).toEqual([null, null, null, null])
  })

  it('takes words the panel shows for the song the page opened on', () => {
    expect(
      run([
        { song: 'a', panel: null, shown: false },
        { song: 'a', panel: 'A words', shown: true },
        { song: 'a', panel: 'A words', shown: true }
      ])
    ).toEqual([null, null, 'A words'])
  })
})

describe('lyricsCredit', () => {
  it('takes the name after the colon, in any language', () => {
    expect(lyricsCredit('Source: Musixmatch')).toBe('Musixmatch')
    expect(lyricsCredit('提供元：LyricFind')).toBe('LyricFind')
    expect(lyricsCredit('')).toBeNull()
  })
})

describe('the song up next', () => {
  const slot = (selected = false, automix = false): { selected: boolean; automix: boolean } => ({
    selected,
    automix
  })

  it('reads queue lengths, and nothing else', () => {
    expect(parseQueueDuration('3:24')).toBe(204)
    expect(parseQueueDuration(' 1:02:03 ')).toBe(3723)
    expect(parseQueueDuration('')).toBe(0)
    expect(parseQueueDuration('LIVE')).toBe(0)
    expect(parseQueueDuration('3:24:00:01')).toBe(0)
  })

  it('is the next song in the queue', () => {
    expect(upNextIndex([slot(), slot(true), slot()], true, 'off')).toBe(2)
  })

  it('is an autoplay song only while autoplay is on', () => {
    const slots = [slot(true), slot(false, true)]
    expect(upNextIndex(slots, true, 'off')).toBe(1)
    expect(upNextIndex(slots, false, 'off')).toBeNull()
  })

  it('starts the queue again when repeating it, and is none when repeating this song', () => {
    expect(upNextIndex([slot(), slot(), slot(true)], true, 'all')).toBe(0)
    expect(upNextIndex([slot(), slot(true), slot()], true, 'one')).toBeNull()
    // A queue of one song repeating plays that song again: nothing new is up next.
    expect(upNextIndex([slot(true)], true, 'all')).toBeNull()
  })

  it('is none when the queue doesn’t say what’s playing', () => {
    expect(upNextIndex([slot(), slot()], true, 'off')).toBeNull()
  })
})

describe('the cover up next', () => {
  // As read from music.youtube.com on 2026-10-27: a row's picture is this 1 px placeholder until
  // the row has been on screen, while the row's data always has every size.
  const placeholder =
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  const cover = (side: number): string =>
    `https://yt3.googleusercontent.com/qE6c=w${side}-h${side}-l90-rj`
  const sizes = JSON.stringify(
    [60, 120, 180, 226, 302, 544].map((side) => ({ url: cover(side), width: side, height: side }))
  )

  it('is there before the row has been on screen', () => {
    expect(queueCover(sizes, placeholder)).toBe(cover(180))
  })

  it('is the smallest size that fills the row, else the biggest there is', () => {
    expect(queueCover(sizes, cover(120))).toBe(cover(180))
    const small = JSON.stringify([
      { url: cover(60), width: 60 },
      { url: cover(120), width: 120 }
    ])
    expect(queueCover(small, placeholder)).toBe(cover(120))
  })

  it('falls back to the row’s own picture, never the placeholder', () => {
    expect(queueCover(null, cover(120))).toBe(cover(120))
    expect(queueCover(null, placeholder)).toBeNull()
    expect(queueCover(null, '')).toBeNull()
  })

  it('takes only covers from YouTube Music’s hosts, whatever the page wrote', () => {
    const odd = JSON.stringify([
      { url: 'http://yt3.googleusercontent.com/x=w180', width: 180 },
      { url: placeholder, width: 180 },
      { url: 'https://example.com/x.jpg', width: 180 },
      { url: 42, width: 180 },
      'https://yt3.googleusercontent.com/bare'
    ])
    expect(queueCover(odd, placeholder)).toBeNull()
    expect(queueCover('not json', cover(120))).toBe(cover(120))
    expect(queueCover('{"url":"x"}', cover(120))).toBe(cover(120))
    expect(queueCover('null', placeholder)).toBeNull()
  })
})
