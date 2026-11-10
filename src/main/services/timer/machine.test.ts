import { describe, expect, it } from 'vitest'
import {
  advance,
  applyCommand,
  applyConfig,
  initialTimerState,
  MAX_DURATION_SEC,
  remainingAt,
  timerConfig,
  type TimerConfig
} from './machine'
import { elapsedAt, type TimerCommand, type TimerState } from './types'
import { defaultTimerSettings } from '../settings/schema'

const config: TimerConfig = timerConfig(defaultTimerSettings()) // 25 / 5 / 10 min
const T0 = 1_800_000_000 // an arbitrary epoch second

function run(state: TimerState, command: TimerCommand, now = T0, cfg = config): TimerState {
  return applyCommand(state, command, cfg, now)
}

const start = { kind: 'start' } as const
const pause = { kind: 'pause' } as const
const reset = { kind: 'reset' } as const
const addFive = { kind: 'addFiveMinutes' } as const

describe('initial state', () => {
  it('starts each mode idle at its configured length', () => {
    expect(initialTimerState('pomodoro', config)).toMatchObject({
      phase: 'focus',
      session: 1,
      durationSec: 1500,
      elapsedSec: 0,
      status: 'idle',
      runningSince: null
    })
    expect(initialTimerState('countdown', config).durationSec).toBe(600)
    expect(initialTimerState('stopwatch', config).durationSec).toBe(0)
  })

  it('takes the lengths from settings, to the second', () => {
    const cfg = timerConfig({ ...defaultTimerSettings(), focusSec: 3005, breakSec: 90 })
    expect(cfg.focusSec).toBe(3005)
    expect(cfg.breakSec).toBe(90)
  })
})

describe('start and pause', () => {
  it('counts from the start anchor', () => {
    const running = run(initialTimerState('countdown', config), start)
    expect(running).toMatchObject({ status: 'running', runningSince: T0 })
    expect(elapsedAt(running, T0 + 90)).toBe(90)
    expect(remainingAt(running, T0 + 90)).toBe(510)
  })

  it('banks elapsed time on pause and resumes from it', () => {
    let state = run(initialTimerState('countdown', config), start)
    state = run(state, pause, T0 + 100.5)
    expect(state).toMatchObject({ status: 'paused', elapsedSec: 100.5, runningSince: null })
    // Time passing while paused doesn't count.
    expect(elapsedAt(state, T0 + 5000)).toBe(100.5)

    state = run(state, start, T0 + 5000)
    expect(elapsedAt(state, T0 + 5010)).toBe(110.5)
  })

  it('ignores start while running and pause while not running', () => {
    const running = run(initialTimerState('pomodoro', config), start)
    expect(run(running, start, T0 + 50)).toBe(running)
    const idle = initialTimerState('pomodoro', config)
    expect(run(idle, pause)).toBe(idle)
  })

  it('never reports time before the anchor or past the end', () => {
    const running = run(initialTimerState('countdown', config), start)
    expect(elapsedAt(running, T0 - 30)).toBe(0)
    expect(elapsedAt(running, T0 + 10_000)).toBe(600)
    expect(remainingAt(running, T0 + 10_000)).toBe(0)
  })

  it('lets the stopwatch run without an end', () => {
    const running = run(initialTimerState('stopwatch', config), start)
    expect(elapsedAt(running, T0 + 100_000)).toBe(100_000)
    expect(advance(running, config, T0 + 100_000).completed).toEqual([])
  })
})

describe('countdown', () => {
  it('finishes at its end and reports when', () => {
    const running = run(initialTimerState('countdown', config), start)
    expect(advance(running, config, T0 + 599.9).completed).toEqual([])

    const { state, completed } = advance(running, config, T0 + 700)
    expect(state).toMatchObject({ status: 'finished', elapsedSec: 600, runningSince: null })
    expect(completed).toEqual([{ mode: 'countdown', phase: 'focus', at: T0 + 600 }])
  })

  it('restarts from the top when started after finishing', () => {
    const finished = advance(run(initialTimerState('countdown', config), start), config, T0 + 600)
    const restarted = run(finished.state, start, T0 + 1000)
    expect(restarted).toMatchObject({ status: 'running', elapsedSec: 0, runningSince: T0 + 1000 })
  })
})

describe('pomodoro', () => {
  it('rolls focus into a break that waits for Start', () => {
    const focus = run(initialTimerState('pomodoro', config), start)
    const { state, completed } = advance(focus, config, T0 + 1500)
    expect(completed).toEqual([{ mode: 'pomodoro', phase: 'focus', at: T0 + 1500 }])
    expect(state).toMatchObject({
      phase: 'break',
      session: 1,
      durationSec: 300,
      status: 'idle',
      runningSince: null
    })
  })

  it('auto-starts the break from the moment focus ended', () => {
    const auto = { ...config, autoStartBreaks: true }
    const focus = run(initialTimerState('pomodoro', auto), start, T0, auto)
    const { state } = advance(focus, auto, T0 + 1510)
    expect(state).toMatchObject({ phase: 'break', status: 'running', runningSince: T0 + 1500 })
    expect(elapsedAt(state, T0 + 1510)).toBe(10)
  })

  it('moves to the next session after a break, waiting for the user', () => {
    let state = run(initialTimerState('pomodoro', config), start)
    state = advance(state, config, T0 + 1500).state
    state = run(state, start, T0 + 1600)
    state = advance(state, config, T0 + 1900).state
    expect(state).toMatchObject({ phase: 'focus', session: 2, status: 'idle', durationSec: 1500 })
  })

  it('wraps back to session 1 after the fourth break', () => {
    const lastBreak: TimerState = {
      mode: 'pomodoro',
      phase: 'break',
      session: 4,
      durationSec: 300,
      elapsedSec: 0,
      runningSince: T0,
      status: 'running'
    }
    expect(advance(lastBreak, config, T0 + 300).state).toMatchObject({ phase: 'focus', session: 1 })
  })

  it('catches up through several phases after a long gap', () => {
    const auto = { ...config, autoStartBreaks: true }
    const focus = run(initialTimerState('pomodoro', auto), start, T0, auto)
    const { state, completed } = advance(focus, auto, T0 + 3 * 3600)
    expect(completed).toEqual([
      { mode: 'pomodoro', phase: 'focus', at: T0 + 1500 },
      { mode: 'pomodoro', phase: 'break', at: T0 + 1800 }
    ])
    // The next focus session never starts by itself, so the chain stops here.
    expect(state).toMatchObject({ phase: 'focus', session: 2, status: 'idle' })
  })
})

describe('reset', () => {
  it('returns to the start of the current phase', () => {
    let state = run(initialTimerState('pomodoro', config), start)
    state = advance(state, config, T0 + 1500).state
    state = run(state, start, T0 + 1600)
    state = run(state, reset, T0 + 1650)
    expect(state).toMatchObject({ phase: 'break', session: 1, status: 'idle', elapsedSec: 0 })
  })

  it('goes back to session 1 when the phase is already at its start', () => {
    const breakIdle: TimerState = {
      ...initialTimerState('pomodoro', config),
      phase: 'break',
      session: 3,
      durationSec: 300
    }
    expect(run(breakIdle, reset)).toEqual(initialTimerState('pomodoro', config))
  })

  it('undoes +5 min on an idle phase before resetting the session', () => {
    const extended = run(initialTimerState('pomodoro', config), addFive)
    const once = run(extended, reset)
    expect(once).toMatchObject({ durationSec: 1500, session: 1 })
  })

  it('clears the stopwatch', () => {
    let state = run(initialTimerState('stopwatch', config), start)
    state = run(state, pause, T0 + 42)
    expect(run(state, reset)).toEqual(initialTimerState('stopwatch', config))
  })
})

describe('+5 min', () => {
  it('extends a running timer without touching its anchor', () => {
    const running = run(initialTimerState('countdown', config), start)
    const longer = run(running, addFive, T0 + 30)
    expect(longer).toMatchObject({ durationSec: 900, runningSince: T0, status: 'running' })
    expect(remainingAt(longer, T0 + 30)).toBe(870)
  })

  it('turns a finished countdown into five paused minutes', () => {
    const finished = advance(run(initialTimerState('countdown', config), start), config, T0 + 600)
    const snoozed = run(finished.state, addFive)
    expect(snoozed).toMatchObject({ status: 'paused', durationSec: 900, elapsedSec: 600 })
    expect(remainingAt(snoozed, T0 + 9999)).toBe(300)
  })

  it('does nothing for the stopwatch', () => {
    const watch = initialTimerState('stopwatch', config)
    expect(run(watch, addFive)).toBe(watch)
  })

  it('stops at the maximum length', () => {
    const long: TimerState = {
      ...initialTimerState('countdown', config),
      durationSec: MAX_DURATION_SEC - 60
    }
    expect(run(long, addFive).durationSec).toBe(MAX_DURATION_SEC)
    const max = run(long, addFive)
    expect(run(max, addFive)).toBe(max)
  })
})

describe('selectMode', () => {
  it('switches to a fresh run of the new mode', () => {
    const running = run(initialTimerState('pomodoro', config), start)
    expect(run(running, { kind: 'selectMode', mode: 'stopwatch' })).toEqual(
      initialTimerState('stopwatch', config)
    )
  })

  it('keeps a run going when its own mode is picked again', () => {
    const running = run(initialTimerState('pomodoro', config), start)
    expect(run(running, { kind: 'selectMode', mode: 'pomodoro' })).toBe(running)
  })
})

describe('applyConfig', () => {
  const longer = { ...config, focusSec: 45 * 60, countdownSec: 20 * 60 }

  it('gives an idle run the new length', () => {
    expect(applyConfig(initialTimerState('pomodoro', config), longer).durationSec).toBe(2700)
    expect(applyConfig(initialTimerState('countdown', config), longer).durationSec).toBe(1200)
  })

  it('leaves a run in progress alone', () => {
    const running = run(initialTimerState('pomodoro', config), start)
    expect(applyConfig(running, longer)).toBe(running)
    const paused = run(running, pause, T0 + 60)
    expect(applyConfig(paused, longer)).toBe(paused)
  })

  it('returns the same object when nothing changes', () => {
    const idle = initialTimerState('pomodoro', config)
    expect(applyConfig(idle, { ...config, autoStartBreaks: true })).toBe(idle)
  })
})

describe('setting a length on the card', () => {
  const use = (phase: 'focus' | 'break', durationSec: number, begin: boolean): TimerCommand => ({
    kind: 'useLength',
    phase,
    durationSec,
    start: begin
  })
  const idleFocus = (session: number): TimerState => ({
    ...initialTimerState('pomodoro', config),
    session
  })

  it('starts a break of that length from a focus session that hasn’t begun', () => {
    expect(run(idleFocus(2), use('break', 420, true))).toEqual({
      mode: 'pomodoro',
      phase: 'break',
      session: 2,
      durationSec: 420,
      elapsedSec: 0,
      runningSince: T0,
      status: 'running'
    })
  })

  it('moves on to the next session when it skips a break, as a finished break does', () => {
    const breakS2: TimerState = { ...idleFocus(2), phase: 'break', durationSec: 300 }
    expect(run(breakS2, use('focus', 60, true))).toMatchObject({ phase: 'focus', session: 3 })
    const breakS4: TimerState = { ...breakS2, session: 4 }
    expect(run(breakS4, use('focus', 60, true))).toMatchObject({ phase: 'focus', session: 1 })
  })

  it('keeps the session in the same phase', () => {
    expect(run(idleFocus(3), use('focus', 95, true))).toMatchObject({
      phase: 'focus',
      session: 3,
      durationSec: 95
    })
  })

  it('leaves a run ready at that length when it doesn’t start', () => {
    expect(run(idleFocus(1), use('focus', 95, false))).toMatchObject({
      durationSec: 95,
      runningSince: null,
      status: 'idle'
    })
  })

  it('turns a countdown whose time is up into a fresh one', () => {
    const done = run(run(initialTimerState('countdown', config), start), pause, T0 + 1)
    const finished: TimerState = { ...done, elapsedSec: 600, status: 'finished' }
    expect(run(finished, use('focus', 90, false))).toEqual({
      ...initialTimerState('countdown', config),
      durationSec: 90
    })
  })

  it('drops time added before Start', () => {
    const snoozed = run(idleFocus(1), addFive)
    expect(run(snoozed, use('focus', 1500, false)).durationSec).toBe(1500)
  })

  it('never touches a run that is going or paused', () => {
    const running = run(idleFocus(1), start)
    expect(run(running, use('break', 60, true), T0 + 30)).toBe(running)
    const paused = run(running, pause, T0 + 30)
    expect(run(paused, use('focus', 60, false), T0 + 40)).toBe(paused)
  })

  it('does nothing to the stopwatch', () => {
    const stopwatch = initialTimerState('stopwatch', config)
    expect(run(stopwatch, use('focus', 60, true))).toBe(stopwatch)
  })
})
