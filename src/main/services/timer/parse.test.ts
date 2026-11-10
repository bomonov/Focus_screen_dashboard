import { describe, expect, it } from 'vitest'
import { defaultTimerSettings } from '../settings/schema'
import { freshRun, initialTimerState, timerConfig } from './machine'
import { parseTimerCommand, parseTimerState } from './parse'
import type { TimerState } from './types'

const config = timerConfig(defaultTimerSettings())
const NOW = 1_800_000_000

const runningFocus: TimerState = {
  mode: 'pomodoro',
  phase: 'focus',
  session: 3,
  durationSec: 1800,
  elapsedSec: 120,
  runningSince: NOW - 60,
  status: 'running'
}

describe('parseTimerState', () => {
  it('starts a fresh Pomodoro when there is nothing usable', () => {
    for (const raw of [undefined, null, 'x', [], {}, { mode: 'egg' }]) {
      expect(parseTimerState(raw, config, NOW)).toEqual(initialTimerState('pomodoro', config))
    }
  })

  it('restores each status as saved', () => {
    expect(parseTimerState(runningFocus, config, NOW)).toEqual(runningFocus)

    const paused = { ...runningFocus, runningSince: null, status: 'paused' }
    expect(parseTimerState(paused, config, NOW)).toEqual(paused)

    const finished: TimerState = {
      mode: 'countdown',
      phase: 'focus',
      session: 1,
      durationSec: 900,
      elapsedSec: 900,
      runningSince: null,
      status: 'finished'
    }
    expect(parseTimerState(finished, config, NOW)).toEqual(finished)
  })

  it('keeps a custom idle length (e.g. after +5 min)', () => {
    const idle = { ...freshRun('countdown', 'focus', 1, config), durationSec: 900 }
    expect(parseTimerState(idle, config, NOW)).toEqual(idle)
  })

  it('counts a start time in the future from now', () => {
    const future = { ...runningFocus, runningSince: NOW + 3600 }
    expect(parseTimerState(future, config, NOW).runningSince).toBe(NOW)
  })

  it('falls back to the start of the saved phase when fields are broken', () => {
    const phaseStart = freshRun('pomodoro', 'focus', 3, config)
    expect(parseTimerState({ ...runningFocus, runningSince: 'soon' }, config, NOW)).toEqual(
      phaseStart
    )
    expect(parseTimerState({ ...runningFocus, durationSec: -5 }, config, NOW)).toEqual(phaseStart)
    expect(parseTimerState({ ...runningFocus, elapsedSec: Number.NaN }, config, NOW)).toEqual(
      phaseStart
    )
    expect(parseTimerState({ ...runningFocus, status: 'zooming' }, config, NOW)).toEqual(phaseStart)
  })

  it('repairs out-of-range sessions and phases outside Pomodoro', () => {
    expect(parseTimerState({ ...runningFocus, session: 9 }, config, NOW).session).toBe(1)
    const countdown = parseTimerState(
      { ...runningFocus, mode: 'countdown', phase: 'break', session: 3 },
      config,
      NOW
    )
    expect(countdown).toMatchObject({ phase: 'focus', session: 1 })
  })

  it('only lets a countdown be finished', () => {
    const finishedPomodoro = { ...runningFocus, runningSince: null, status: 'finished' }
    expect(parseTimerState(finishedPomodoro, config, NOW)).toEqual(
      freshRun('pomodoro', 'focus', 3, config)
    )
  })

  it('requires the stopwatch to have no length', () => {
    const watch = {
      mode: 'stopwatch',
      phase: 'focus',
      session: 1,
      durationSec: 0,
      elapsedSec: 5000,
      runningSince: null,
      status: 'paused'
    }
    expect(parseTimerState(watch, config, NOW)).toEqual(watch)
    expect(parseTimerState({ ...watch, durationSec: 60 }, config, NOW)).toEqual(
      initialTimerState('stopwatch', config)
    )
  })

  it('caps banked time at the run length', () => {
    const over = { ...runningFocus, runningSince: null, status: 'paused', elapsedSec: 99_999 }
    expect(parseTimerState(over, config, NOW).elapsedSec).toBe(1800)
  })
})

describe('parseTimerCommand', () => {
  it('accepts the known commands', () => {
    expect(parseTimerCommand({ kind: 'start' })).toEqual({ kind: 'start' })
    expect(parseTimerCommand({ kind: 'pause' })).toEqual({ kind: 'pause' })
    expect(parseTimerCommand({ kind: 'reset' })).toEqual({ kind: 'reset' })
    expect(parseTimerCommand({ kind: 'addFiveMinutes' })).toEqual({ kind: 'addFiveMinutes' })
    expect(parseTimerCommand({ kind: 'selectMode', mode: 'countdown' })).toEqual({
      kind: 'selectMode',
      mode: 'countdown'
    })
  })

  it('accepts a length to the second, and nothing past 23:59:59', () => {
    const ok = { kind: 'useLength', phase: 'break', durationSec: 420, start: true }
    expect(parseTimerCommand(ok)).toEqual(ok)
    expect(parseTimerCommand({ ...ok, durationSec: 86399, start: false })).toEqual({
      ...ok,
      durationSec: 86399,
      start: false
    })
    for (const bad of [
      { ...ok, durationSec: 0 },
      { ...ok, durationSec: 86400 },
      { ...ok, durationSec: 1.5 },
      { ...ok, durationSec: '60' },
      { ...ok, phase: 'nap' },
      { ...ok, start: 'yes' },
      { kind: 'useLength', durationSec: 60, start: true }
    ]) {
      expect(parseTimerCommand(bad)).toBeNull()
    }
  })

  it('drops extra fields', () => {
    expect(parseTimerCommand({ kind: 'start', durationSec: 1 })).toEqual({ kind: 'start' })
  })

  it('rejects anything else', () => {
    for (const raw of [
      undefined,
      'start',
      { kind: 'explode' },
      { kind: 'selectMode' },
      { kind: 'selectMode', mode: 'egg' },
      { kind: 'addTime', seconds: 1e9 }
    ]) {
      expect(parseTimerCommand(raw)).toBeNull()
    }
  })
})
