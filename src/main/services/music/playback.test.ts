import { describe, expect, it } from 'vitest'
import type { PlayerInfo, PlayerReport, PlayerSnapshot } from './adapter'
import {
  applyExpectation,
  choosePlayer,
  EXPECTATION_SEC,
  expectationFor,
  playbackChanged,
  previousCommand,
  toPlaybackState,
  type PlayerChoice
} from './playback'
import type { PlaybackState, PlayerId } from './types'

const T0 = 1_800_000_000

const song: PlayerSnapshot = {
  status: 'playing',
  track: {
    id: 'spotify:track:1',
    title: 'Low Sun Hours',
    artist: 'The Saguaro Set',
    album: 'Night Shift Sessions',
    durationSec: 213,
    artworkRef: 'https://i.scdn.co/image/abc'
  },
  positionSec: 84,
  shuffle: false,
  repeat: 'off'
}

function open(player: PlayerId, snapshot: Partial<PlayerSnapshot> = {}): PlayerReport {
  return { player, at: T0, kind: 'open', snapshot: { ...song, ...snapshot } }
}

const closed = (player: PlayerId): PlayerReport => ({ player, at: T0, kind: 'closed' })
const denied = (player: PlayerId): PlayerReport => ({ player, at: T0, kind: 'denied' })

const INFOS: Record<PlayerId, PlayerInfo> = {
  spotify: { id: 'spotify', name: 'Spotify', repeatModes: ['off', 'all'] },
  appleMusic: { id: 'appleMusic', name: 'Apple Music', repeatModes: ['off', 'all', 'one'] },
  ytmChrome: { id: 'ytmChrome', name: 'YouTube Music', repeatModes: ['off', 'all', 'one'] },
  ytmSafari: { id: 'ytmSafari', name: 'YouTube Music', repeatModes: ['off', 'all', 'one'] },
  demo: { id: 'demo', name: 'Demo', repeatModes: ['off', 'all', 'one'] }
}

function stateFor(choice: PlayerChoice, artwork: string | null = null): PlaybackState {
  return toPlaybackState({
    choice,
    info: (player) => INFOS[player],
    artwork,
    supportedPlayers: ['Spotify', 'Apple Music'],
    now: T0
  })
}

function chosen(choice: PlayerChoice): PlayerId | 'denied' | 'none' {
  return choice.kind === 'player' ? choice.player : choice.kind
}

describe('choosePlayer', () => {
  it('shows nothing when no player is open', () => {
    expect(choosePlayer([closed('spotify'), closed('appleMusic')], null, null)).toEqual({
      kind: 'none'
    })
  })

  it('prefers the player that is playing over a paused one', () => {
    const reports = [open('spotify', { status: 'paused' }), open('appleMusic')]
    expect(chosen(choosePlayer(reports, null, 'spotify'))).toBe('appleMusic')
  })

  it('keeps the player shown last when both are equal', () => {
    const reports = [open('spotify'), open('appleMusic')]
    expect(chosen(choosePlayer(reports, null, 'appleMusic'))).toBe('appleMusic')
    expect(chosen(choosePlayer(reports, null, 'spotify'))).toBe('spotify')
    // With no history, priority order decides.
    expect(chosen(choosePlayer(reports, null, null))).toBe('spotify')
  })

  it('keeps a paused song over a player that is open but stopped', () => {
    const reports = [
      open('spotify', { status: 'stopped', track: null }),
      open('appleMusic', { status: 'paused' })
    ]
    expect(chosen(choosePlayer(reports, null, null))).toBe('appleMusic')
  })

  it('gives the card to the paused player you listened to last', () => {
    const reports = [
      open('appleMusic', { status: 'paused' }),
      open('ytmSafari', { status: 'paused' })
    ]
    const played = new Map<PlayerId, number>([['ytmSafari', T0 - 5]])
    expect(chosen(choosePlayer(reports, null, 'appleMusic', played))).toBe('ytmSafari')
    // With no listening history this run, the one shown last stays.
    expect(chosen(choosePlayer(reports, null, 'appleMusic'))).toBe('appleMusic')
  })

  it('reports a denied player unless another one has a song', () => {
    expect(chosen(choosePlayer([denied('spotify'), closed('appleMusic')], null, null))).toBe(
      'denied'
    )
    expect(
      chosen(
        choosePlayer([denied('spotify'), open('appleMusic', { status: 'stopped' })], null, null)
      )
    ).toBe('denied')
    expect(chosen(choosePlayer([denied('spotify'), open('appleMusic')], null, null))).toBe(
      'appleMusic'
    )
  })

  it('uses the demo only when no real player is open', () => {
    const demo = open('demo')
    expect(chosen(choosePlayer([closed('spotify'), closed('appleMusic')], demo, null))).toBe('demo')
    expect(
      chosen(
        choosePlayer([closed('spotify'), open('appleMusic', { status: 'stopped' })], demo, null)
      )
    ).toBe('appleMusic')
    expect(chosen(choosePlayer([denied('spotify'), closed('appleMusic')], demo, null))).toBe(
      'denied'
    )
  })
})

describe('toPlaybackState', () => {
  it('builds the screen state from the chosen reading', () => {
    const state = stateFor(
      { kind: 'player', player: 'spotify', snapshot: { ...song, repeat: 'all' }, at: T0 - 0.5 },
      'data:image/jpeg;base64,AAAA'
    )
    expect(state).toEqual({
      player: { id: 'spotify', name: 'Spotify' },
      track: {
        id: 'spotify:track:1',
        title: 'Low Sun Hours',
        artist: 'The Saguaro Set',
        album: 'Night Shift Sessions',
        durationSec: 213,
        artwork: 'data:image/jpeg;base64,AAAA'
      },
      playing: true,
      positionSec: 84,
      positionAt: T0 - 0.5,
      shuffle: false,
      repeat: 'all',
      repeatModes: ['off', 'all'],
      problem: null,
      supportedPlayers: ['Spotify', 'Apple Music'],
      next: null
    })
  })

  it('says what’s up next, with its cover once loaded', () => {
    const next = { title: 'Quiet Library', artist: 'Lofi Desk Club', durationSec: 187 }
    const choice = {
      kind: 'player' as const,
      player: 'spotify' as const,
      snapshot: { ...song, next: { ...next, artworkRef: 'ref' } },
      at: T0
    }
    const loading = stateFor(choice, null)
    expect(loading.next).toEqual({ ...next, artwork: null })
    const loaded = toPlaybackState({
      choice,
      info: (id) => ({ id, name: id, repeatModes: ['off'] }),
      artwork: null,
      nextArtwork: 'data:image/jpeg;base64,BBBB',
      supportedPlayers: [],
      now: T0
    })
    expect(loaded.next?.artwork).toBe('data:image/jpeg;base64,BBBB')
    expect(playbackChanged(loading, loaded)).toBe(true)
  })

  it('never reports a repeat mode the player cannot be set to', () => {
    const state = stateFor({
      kind: 'player',
      player: 'spotify',
      snapshot: { ...song, repeat: 'one' },
      at: T0
    })
    expect(state.repeat).toBe('off')
  })

  it('treats a stopped player as open with no song', () => {
    const state = stateFor({
      kind: 'player',
      player: 'appleMusic',
      snapshot: { ...song, status: 'stopped' },
      at: T0
    })
    expect(state.player?.name).toBe('Apple Music')
    expect(state.track).toBeNull()
    expect(state.playing).toBe(false)
  })

  it('passes on the playlist only from players that know it', () => {
    const youtube = stateFor({
      kind: 'player',
      player: 'ytmChrome',
      snapshot: { ...song, playlistId: 'PLx7Gk2mQ9vR4tYb_Lw-8sNc3dHfJ0aZpE' },
      at: T0
    })
    expect(youtube.playlistId).toBe('PLx7Gk2mQ9vR4tYb_Lw-8sNc3dHfJ0aZpE')
    const single = stateFor({
      kind: 'player',
      player: 'ytmChrome',
      snapshot: { ...song, playlistId: null },
      at: T0
    })
    expect(single.playlistId).toBeNull()
    const spotify = stateFor({ kind: 'player', player: 'spotify', snapshot: song, at: T0 })
    expect(spotify.playlistId).toBeUndefined()
  })

  it('explains a denied player', () => {
    const state = stateFor({ kind: 'denied', player: 'spotify' })
    expect(state.problem).toEqual({ kind: 'automationDenied', playerName: 'Spotify' })
    expect(state.track).toBeNull()
  })
})

describe('playbackChanged', () => {
  const base = stateFor({ kind: 'player', player: 'spotify', snapshot: song, at: T0 })

  it('ignores readings that agree with the running anchor', () => {
    const later = stateFor({
      kind: 'player',
      player: 'spotify',
      snapshot: { ...song, positionSec: 89.3 },
      at: T0 + 5
    })
    expect(playbackChanged(base, later)).toBe(false)
  })

  it('pushes a seek', () => {
    const seeked = stateFor({
      kind: 'player',
      player: 'spotify',
      snapshot: { ...song, positionSec: 30 },
      at: T0 + 5
    })
    expect(playbackChanged(base, seeked)).toBe(true)
  })

  it('pushes play/pause, song, shuffle, playlist and artwork changes', () => {
    const variants: PlayerSnapshot[] = [
      { ...song, status: 'paused' },
      { ...song, shuffle: true },
      { ...song, playlistId: 'RDAMVMxukbqwRuN5w' },
      { ...song, track: song.track && { ...song.track, id: 'spotify:track:2' } }
    ]
    for (const snapshot of variants) {
      const next = stateFor({ kind: 'player', player: 'spotify', snapshot, at: T0 })
      expect(playbackChanged(base, next)).toBe(true)
    }
    const withCover = stateFor({ kind: 'player', player: 'spotify', snapshot: song, at: T0 }, 'x')
    expect(playbackChanged(base, withCover)).toBe(true)
  })

  it('pushes a playlist change even when the song stays the same', () => {
    const inList = { ...song, playlistId: 'PLx7Gk2mQ9vR4tYb_Lw-8sNc3dHfJ0aZpE' }
    const prev = stateFor({ kind: 'player', player: 'ytmChrome', snapshot: inList, at: T0 })
    const same = stateFor({ kind: 'player', player: 'ytmChrome', snapshot: inList, at: T0 })
    expect(playbackChanged(prev, same)).toBe(false)
    const radio = stateFor({
      kind: 'player',
      player: 'ytmChrome',
      snapshot: { ...inList, playlistId: 'RDAMVMxukbqwRuN5w' },
      at: T0
    })
    expect(playbackChanged(prev, radio)).toBe(true)
  })

  it('does not count paused readings as drift', () => {
    const paused = stateFor({
      kind: 'player',
      player: 'spotify',
      snapshot: { ...song, status: 'paused' },
      at: T0
    })
    const stillPaused = stateFor({
      kind: 'player',
      player: 'spotify',
      snapshot: { ...song, status: 'paused' },
      at: T0 + 60
    })
    expect(playbackChanged(paused, stillPaused)).toBe(false)
  })
})

describe('previousCommand', () => {
  it('restarts a song that has been playing a while, otherwise goes back', () => {
    expect(previousCommand(42)).toEqual({ kind: 'restart' })
    expect(previousCommand(3.5)).toEqual({ kind: 'restart' })
    expect(previousCommand(2)).toEqual({ kind: 'previous' })
  })
})

describe('button presses shown before the player confirms', () => {
  const shown = stateFor({ kind: 'player', player: 'ytmSafari', snapshot: song, at: T0 })

  it('only expects what a press can predict', () => {
    expect(expectationFor(shown, { kind: 'playPause' }, T0)).toMatchObject({ playing: false })
    expect(expectationFor(shown, { kind: 'setRepeat', mode: 'one' }, T0)).toMatchObject({
      repeat: 'one'
    })
    expect(expectationFor(shown, { kind: 'setShuffle', on: true }, T0)).toMatchObject({
      shuffle: true
    })
    expect(expectationFor(shown, { kind: 'next' }, T0)).toBeNull()
  })

  it('shows a pause at once, frozen where the song was, until the player agrees', () => {
    const pending = expectationFor(shown, { kind: 'playPause' }, T0 + 2)
    const stale = stateFor({ kind: 'player', player: 'ytmSafari', snapshot: song, at: T0 + 2.1 })
    const early = applyExpectation(stale, shown, pending, T0 + 2.1)
    expect(early.state.playing).toBe(false)
    expect(early.state.positionSec).toBeCloseTo(86.1)
    expect(early.pending).not.toBeNull()

    const confirmed = stateFor({
      kind: 'player',
      player: 'ytmSafari',
      snapshot: { ...song, status: 'paused', positionSec: 86.1 },
      at: T0 + 2.3
    })
    const settled = applyExpectation(confirmed, early.state, early.pending, T0 + 2.3)
    expect(settled.pending).toBeNull()
    expect(settled.state).toBe(confirmed)
  })

  it('shows a jump at once, counting on from there, until the player gets there', () => {
    const pending = expectationFor(shown, { kind: 'seek', positionSec: 150 }, T0 + 1)
    expect(pending).toMatchObject({ position: { sec: 150, at: T0 + 1 } })
    const stale = stateFor({ kind: 'player', player: 'ytmSafari', snapshot: song, at: T0 + 1.5 })
    const early = applyExpectation(stale, shown, pending, T0 + 1.5)
    expect(early.state.positionSec).toBeCloseTo(150.5)
    expect(early.pending).not.toBeNull()

    const there = stateFor({
      kind: 'player',
      player: 'ytmSafari',
      snapshot: { ...song, positionSec: 150.6 },
      at: T0 + 1.6
    })
    const settled = applyExpectation(there, early.state, early.pending, T0 + 1.6)
    expect(settled.pending).toBeNull()
    expect(settled.state).toBe(there)
  })

  it('gives way to the player when it never confirms', () => {
    const pending = expectationFor(shown, { kind: 'setRepeat', mode: 'all' }, T0)
    const late = T0 + EXPECTATION_SEC + 0.1
    const reading = stateFor({ kind: 'player', player: 'ytmSafari', snapshot: song, at: late })
    expect(applyExpectation(reading, shown, pending, late)).toEqual({
      state: reading,
      pending: null
    })
  })

  it('drops the press when another player takes the screen', () => {
    const pending = expectationFor(shown, { kind: 'setShuffle', on: true }, T0)
    const other = stateFor({ kind: 'player', player: 'appleMusic', snapshot: song, at: T0 })
    expect(applyExpectation(other, shown, pending, T0).state.shuffle).toBe(false)
  })
})
