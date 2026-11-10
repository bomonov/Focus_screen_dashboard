import { describe, expect, it } from 'vitest'
import type { TimerState } from '../../../main/ipc'
import { formatClock, timerView } from './timerView'

const T0 = 1_800_000_000

const focus: TimerState = {
  mode: 'pomodoro',
  phase: 'focus',
  session: 2,
  durationSec: 1500,
  elapsedSec: 0,
  runningSince: T0,
  status: 'running'
}

describe('formatClock', () => {
  it('pads minutes and seconds', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(65)).toBe('01:05')
    expect(formatClock(1500)).toBe('25:00')
    expect(formatClock(3599)).toBe('59:59')
  })

  it('adds hours past an hour', () => {
    expect(formatClock(3600)).toBe('1:00:00')
    expect(formatClock(3912)).toBe('1:05:12')
  })

  it('drops fractions and never goes negative', () => {
    expect(formatClock(59.99)).toBe('00:59')
    expect(formatClock(-3)).toBe('00:00')
  })
})

describe('timerView', () => {
  it('counts down from the full length', () => {
    expect(timerView(focus, 'down', T0).text).toBe('25:00')
    expect(timerView(focus, 'down', T0 + 0.4).text).toBe('25:00')
    expect(timerView(focus, 'down', T0 + 1).text).toBe('24:59')
    expect(timerView(focus, 'down', T0 + 1499.5).text).toBe('00:01')
    expect(timerView(focus, 'down', T0 + 1500).text).toBe('00:00')
  })

  it('counts up when asked', () => {
    const view = timerView(focus, 'up', T0 + 90.7)
    expect(view.text).toBe('01:30')
    expect(view.ariaLabel).toBe('01:30 elapsed')
  })

  it('drains the ring counting down and fills it counting up', () => {
    expect(timerView(focus, 'down', T0).progress).toBe(1)
    expect(timerView(focus, 'down', T0 + 375).progress).toBe(0.75)
    expect(timerView(focus, 'up', T0 + 375).progress).toBe(0.25)
  })

  it('sweeps the stopwatch ring once a minute and ignores direction', () => {
    const watch: TimerState = { ...focus, mode: 'stopwatch', durationSec: 0, session: 1 }
    const view = timerView(watch, 'down', T0 + 75)
    expect(view.text).toBe('01:15')
    expect(view.progress).toBe(0.25)
    expect(view.caption).toBe('Stopwatch')
    expect(view.canAddTime).toBe(false)
  })

  it('names the Pomodoro phase and session', () => {
    expect(timerView(focus, 'down', T0).caption).toBe('Focus · session 2 of 4')
    const pause = { ...focus, phase: 'break' as const, durationSec: 300 }
    expect(timerView(pause, 'down', T0).caption).toBe('Break · 2 of 4 done')
  })

  it('offers the right main button for each status', () => {
    const idle = { ...focus, runningSince: null, status: 'idle' as const }
    expect(timerView(idle, 'down', T0).primary).toEqual({
      label: 'Start',
      command: { kind: 'start' }
    })
    expect(timerView(focus, 'down', T0).primary).toEqual({
      label: 'Pause',
      command: { kind: 'pause' }
    })

    const paused = { ...focus, runningSince: null, status: 'paused' as const, elapsedSec: 60 }
    const pausedView = timerView(paused, 'down', T0 + 999)
    expect(pausedView.primary.label).toBe('Resume')
    expect(pausedView.caption).toBe('Paused')
    expect(pausedView.text).toBe('24:00')
  })

  it("says time's up when a countdown finishes", () => {
    const done: TimerState = {
      ...focus,
      mode: 'countdown',
      session: 1,
      durationSec: 600,
      elapsedSec: 600,
      runningSince: null,
      status: 'finished'
    }
    const view = timerView(done, 'down', T0)
    expect(view).toMatchObject({ text: '00:00', caption: "Time's up", progress: 0 })
    expect(view.primary.label).toBe('Restart')
  })
})

describe('tone', () => {
  it('gives a Pomodoro break its own color, and everything else the focus one', () => {
    expect(timerView(focus, 'down', T0).tone).toBe('focus')
    expect(timerView({ ...focus, phase: 'break', durationSec: 300 }, 'down', T0).tone).toBe('break')
    expect(timerView({ ...focus, mode: 'countdown' }, 'down', T0).tone).toBe('focus')
  })
})
