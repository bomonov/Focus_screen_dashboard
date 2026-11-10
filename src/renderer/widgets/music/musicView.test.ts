import { describe, expect, it } from 'vitest'
import type { PlaybackState, Track } from '../../../main/ipc'
import { placeholderCover } from './cover'
import {
  byline,
  formatSongTime,
  joinOr,
  musicView,
  nextRepeatMode,
  UP_NEXT_LEAD_SEC,
  upNextShown
} from './musicView'

const T0 = 1_800_000_000

const track: Track = {
  id: 't1',
  title: 'Monsoon Drive',
  artist: 'Mesa Lights',
  album: 'Late Summer',
  durationSec: 241,
  artwork: null
}

const state: PlaybackState = {
  player: { id: 'spotify', name: 'Spotify' },
  track,
  playing: true,
  positionSec: 60,
  positionAt: T0,
  shuffle: false,
  repeat: 'off',
  repeatModes: ['off', 'all'],
  problem: null,
  supportedPlayers: ['Spotify', 'Apple Music']
}

describe('formatSongTime', () => {
  it('shows minutes without padding, like the players do', () => {
    expect(formatSongTime(0)).toBe('0:00')
    expect(formatSongTime(7.9)).toBe('0:07')
    expect(formatSongTime(213)).toBe('3:33')
    expect(formatSongTime(3729)).toBe('1:02:09')
    expect(formatSongTime(-1)).toBe('0:00')
  })
})

describe('nextRepeatMode', () => {
  it('cycles through what the player supports', () => {
    expect(nextRepeatMode('off', ['off', 'all', 'one'])).toBe('all')
    expect(nextRepeatMode('all', ['off', 'all', 'one'])).toBe('one')
    expect(nextRepeatMode('one', ['off', 'all', 'one'])).toBe('off')
    expect(nextRepeatMode('all', ['off', 'all'])).toBe('off')
  })
})

describe('byline and joinOr', () => {
  it('skips empty parts', () => {
    expect(byline({ artist: 'Marino', album: '' })).toBe('Marino')
    expect(byline({ artist: '', album: '' })).toBe('')
    expect(byline({ artist: 'A', album: 'B' })).toBe('A · B')
  })

  it('lists players', () => {
    expect(joinOr(['Spotify'])).toBe('Spotify')
    expect(joinOr(['Spotify', 'Apple Music'])).toBe('Spotify or Apple Music')
    expect(joinOr(['A', 'B', 'C'])).toBe('A, B or C')
  })
})

describe('musicView', () => {
  it('counts on from the anchor while playing', () => {
    const view = musicView(state, track, T0 + 24.5)
    expect(view.elapsed).toBe('1:24')
    expect(view.total).toBe('4:01')
    expect(view.progress).toBeCloseTo(84.5 / 241)
    expect(view.eyebrow).toBe('Now playing · Spotify')
    expect(view.nextRepeat).toBe('all')
  })

  it('holds still while paused and stops at the end', () => {
    expect(musicView({ ...state, playing: false }, track, T0 + 100).elapsed).toBe('1:00')
    expect(musicView({ ...state, playing: false }, track, T0).eyebrow).toBe('Paused · Spotify')
    expect(musicView(state, track, T0, false).eyebrow).toBe('Now playing')
    expect(musicView(state, track, T0 + 1000).progress).toBe(1)
  })

  it('has no total or progress when the length is unknown', () => {
    const live = { ...track, durationSec: 0 }
    const view = musicView({ ...state, track: live }, live, T0 + 5)
    expect(view.total).toBeNull()
    expect(view.progress).toBe(0)
    expect(view.elapsed).toBe('1:05')
  })
})

describe('placeholderCover', () => {
  it('gives one album the same colors on every song', () => {
    expect(placeholderCover('Mesa Lights', 'Late Summer', 'Monsoon Drive')).toEqual(
      placeholderCover('Mesa Lights', 'Late Summer', 'Another Song')
    )
  })

  it('uses the title when there is no album', () => {
    const a = placeholderCover('Marino', '', 'Devil In Disguise')
    expect(a.base).toMatch(/^#[0-9A-F]{6}$/)
  })
})

describe('upNextShown', () => {
  const song = { id: 'a', title: 'A', artist: '', album: '', durationSec: 200, artwork: null }
  const upNext = { title: 'B', artist: 'C', durationSec: 180, artwork: null }
  const at = (positionSec: number, next = upNext as typeof upNext | null): boolean =>
    upNextShown(
      {
        player: { id: 'demo', name: 'Demo' },
        track: song,
        playing: false,
        positionSec,
        positionAt: 0,
        shuffle: false,
        repeat: 'off',
        repeatModes: ['off'],
        problem: null,
        supportedPlayers: [],
        next
      },
      song,
      0
    )

  it('shows for the last moments of a song, when the player names the next one', () => {
    expect(at(200 - UP_NEXT_LEAD_SEC - 1)).toBe(false)
    expect(at(200 - UP_NEXT_LEAD_SEC)).toBe(true)
    expect(at(199)).toBe(true)
    expect(at(199, null)).toBe(false)
  })
})
