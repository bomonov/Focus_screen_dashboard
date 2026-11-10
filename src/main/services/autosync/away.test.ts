import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaybackState } from '../music/types'
import { createAwayPreparer, type AwayPreparer } from './away'
import type { PrepareStart } from './prepare'
import type { PrepareEnd, PrepareState } from './types'

const CHECK_MS = 5000

function playback(change: Partial<PlaybackState> = {}): PlaybackState {
  return {
    player: { id: 'ytmSafari', name: 'YouTube Music' },
    track: { id: 'ytm:a', title: 'A', artist: 'X', album: '', durationSec: 200, artwork: null },
    playing: false,
    positionSec: 40,
    positionAt: 0,
    shuffle: false,
    repeat: 'off',
    repeatModes: ['off'],
    problem: null,
    supportedPlayers: [],
    playlistId: 'PL1',
    ...change
  }
}

describe('createAwayPreparer', () => {
  let music: PlaybackState
  let idle: number
  let armed: boolean
  let quiet: boolean
  let canMute: boolean
  let state: PrepareState
  let starts: PrepareStart[]
  let stops: PrepareEnd[]
  let away: AwayPreparer
  const listeners = new Set<(state: PrepareState) => void>()

  const publish = (change: Partial<PrepareState>): void => {
    state = { ...state, ...change }
    for (const listener of listeners) listener(state)
  }

  /** Lets the check run, including its level check and the start it may make. */
  async function tick(times = 1): Promise<void> {
    for (let i = 0; i < times; i++) await vi.advanceTimersByTimeAsync(CHECK_MS)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    music = playback()
    idle = 600
    armed = true
    quiet = true
    canMute = true
    starts = []
    stops = []
    listeners.clear()
    state = {
      running: false,
      trigger: null,
      blocker: null,
      ended: null,
      timed: 0,
      failed: 0,
      pending: 0,
      skipped: 0
    }
    away = createAwayPreparer({
      prepare: {
        get: () => state,
        subscribe: (listener) => (listeners.add(listener), () => void listeners.delete(listener)),
        start(how = { trigger: 'manual' }) {
          starts.push(how)
          if (!canMute) {
            publish({ trigger: how.trigger, ended: 'muteFailed' })
            return Promise.resolve(false)
          }
          publish({ running: true, trigger: how.trigger, ended: null })
          return Promise.resolve(true)
        },
        stop(reason = 'stopped') {
          stops.push(reason)
          publish({ running: false, ended: reason })
        }
      },
      music: { get: () => music },
      armed: () => armed,
      idleSeconds: () => idle,
      isQuiet: () => Promise.resolve(quiet),
      checkMs: CHECK_MS
    })
  })

  afterEach(() => {
    away.dispose()
    vi.useRealTimers()
  })

  it('starts the paused playlist once nobody has used the Mac for a while', async () => {
    idle = 200
    await tick()
    expect(starts).toEqual([])
    idle = 300
    await tick()
    expect(starts).toEqual([{ trigger: 'away', resumeTrack: null }])
  })

  it('takes over a playlist that is playing too, without asking whether the browser is quiet', async () => {
    music = playback({ playing: true })
    quiet = false
    await tick()
    expect(starts).toEqual([{ trigger: 'away', resumeTrack: null }])
  })

  it('leaves alone a paused player in a browser making sound, or a switch that is off', async () => {
    quiet = false
    await tick()
    quiet = true
    armed = false
    await tick()
    state = { ...state, blocker: 'noPlaylist' }
    armed = true
    await tick()
    expect(starts).toEqual([])
  })

  it('stops the moment someone is back, and carries on from that song next time', async () => {
    await tick()
    expect(state.running).toBe(true)
    music = playback({ playing: true, track: { ...playback().track!, id: 'ytm:b' } })
    idle = 1
    await tick()
    expect(stops).toEqual(['cameBack'])
    music = playback({ track: { ...playback().track!, id: 'ytm:b' } })
    idle = 900
    await tick()
    expect(starts.at(-1)).toEqual({ trigger: 'away', resumeTrack: 'ytm:b' })
  })

  it('doesn’t start a playlist again that finished or was given up on', async () => {
    await tick()
    publish({ running: false, ended: 'done' })
    await tick(3)
    expect(starts).toHaveLength(1)
    // Another playlist left paused is prepared next.
    music = playback({ playlistId: 'PL2' })
    await tick()
    expect(starts).toHaveLength(2)
  })

  it('gives up on a browser it can’t mute', async () => {
    canMute = false
    await tick(3)
    expect(starts).toHaveLength(1)
  })

  it('leaves a run started from Customize to the person who started it', async () => {
    state = { ...state, running: true, trigger: 'manual' }
    idle = 1
    await tick()
    expect(stops).toEqual([])
    expect(starts).toEqual([])
  })
})
