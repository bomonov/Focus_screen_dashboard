import { describe, expect, it } from 'vitest'
import {
  advanceDemo,
  applyDemoCommand,
  demoSnapshot,
  DEMO_TRACKS,
  initialDemoState,
  type DemoState
} from './player'

const T0 = 1_800_000_000
const firstLength = DEMO_TRACKS[0]?.durationSec ?? 0

describe('demo player', () => {
  it('starts part-way into the first song, playing', () => {
    const snapshot = demoSnapshot(initialDemoState(T0), T0 + 10)
    expect(snapshot.status).toBe('playing')
    expect(snapshot.track?.title).toBe('Low Sun Hours')
    expect(snapshot.positionSec).toBe(94)
  })

  it('moves to the next song when one ends, at the right position', () => {
    const start = initialDemoState(T0)
    const intoNext = T0 + (firstLength - 84) + 5
    const state = advanceDemo(start, intoNext)
    expect(state.index).toBe(1)
    expect(demoSnapshot(state, intoNext).positionSec).toBeCloseTo(5)
  })

  it('plays through several songs after a long sleep and wraps around', () => {
    const total = DEMO_TRACKS.reduce((sum, track) => sum + track.durationSec, 0)
    const state = advanceDemo({ ...initialDemoState(T0), positionSec: 0 }, T0 + total + 1)
    expect(state.index).toBe(0)
  })

  it('repeats one song when asked', () => {
    const one: DemoState = { ...initialDemoState(T0), repeat: 'one' }
    expect(advanceDemo(one, T0 + firstLength).index).toBe(0)
  })

  it('never shuffles onto the song that just played', () => {
    const shuffled: DemoState = { ...initialDemoState(T0), shuffle: true }
    for (const random of [0, 0.4, 0.99]) {
      const next = applyDemoCommand(shuffled, { kind: 'next' }, T0, () => random)
      expect(next.index).not.toBe(0)
    }
  })

  it('pauses and resumes where it left off', () => {
    const paused = applyDemoCommand(initialDemoState(T0), { kind: 'playPause' }, T0 + 6)
    expect(demoSnapshot(paused, T0 + 100)).toMatchObject({ status: 'paused', positionSec: 90 })
    const resumed = applyDemoCommand(paused, { kind: 'playPause' }, T0 + 100)
    expect(demoSnapshot(resumed, T0 + 102).positionSec).toBe(92)
  })

  it('handles previous, restart, shuffle and repeat', () => {
    const start = initialDemoState(T0)
    expect(applyDemoCommand(start, { kind: 'previous' }, T0).index).toBe(DEMO_TRACKS.length - 1)
    expect(demoSnapshot(applyDemoCommand(start, { kind: 'restart' }, T0), T0).positionSec).toBe(0)
    expect(applyDemoCommand(start, { kind: 'setShuffle', on: true }, T0).shuffle).toBe(true)
    expect(applyDemoCommand(start, { kind: 'setRepeat', mode: 'all' }, T0).repeat).toBe('all')
  })

  it('keeps a paused player paused when skipping', () => {
    const paused = applyDemoCommand(initialDemoState(T0), { kind: 'playPause' }, T0)
    expect(applyDemoCommand(paused, { kind: 'next' }, T0).since).toBeNull()
  })
})
