import type { TimerSettings } from '../settings/schema'
import {
  elapsedAt,
  POMODORO_SESSIONS,
  type PomodoroPhase,
  type TimerCommand,
  type TimerCompletion,
  type TimerMode,
  type TimerState
} from './types'

const FIVE_MINUTES_SEC = 5 * 60
/** Keeps repeated +5 min presses from growing a run without bound. */
export const MAX_DURATION_SEC = 24 * 60 * 60

/** The timer settings the machine needs, in seconds. */
export interface TimerConfig {
  focusSec: number
  breakSec: number
  countdownSec: number
  autoStartBreaks: boolean
}

export interface CompletedRun extends TimerCompletion {
  /** When the run ended, which can be well before we noticed (app closed, Mac asleep). */
  at: number
}

export function timerConfig(settings: TimerSettings): TimerConfig {
  return {
    focusSec: settings.focusSec,
    breakSec: settings.breakSec,
    countdownSec: settings.countdownSec,
    autoStartBreaks: settings.autoStartBreaks
  }
}

export function lengthOf(mode: TimerMode, phase: PomodoroPhase, config: TimerConfig): number {
  switch (mode) {
    case 'pomodoro':
      return phase === 'focus' ? config.focusSec : config.breakSec
    case 'countdown':
      return config.countdownSec
    case 'stopwatch':
      return 0
  }
}

export function freshRun(
  mode: TimerMode,
  phase: PomodoroPhase,
  session: number,
  config: TimerConfig
): TimerState {
  return {
    mode,
    phase,
    session,
    durationSec: lengthOf(mode, phase, config),
    elapsedSec: 0,
    runningSince: null,
    status: 'idle'
  }
}

export function initialTimerState(mode: TimerMode, config: TimerConfig): TimerState {
  return freshRun(mode, 'focus', 1, config)
}

export function remainingAt(state: TimerState, now: number): number {
  return Math.max(0, state.durationSec - elapsedAt(state, now))
}

function start(state: TimerState, now: number): TimerState {
  switch (state.status) {
    case 'running':
      return state
    case 'finished':
      return { ...state, elapsedSec: 0, runningSince: now, status: 'running' }
    default:
      return { ...state, runningSince: now, status: 'running' }
  }
}

function pause(state: TimerState, now: number): TimerState {
  if (state.status !== 'running') return state
  return { ...state, elapsedSec: elapsedAt(state, now), runningSince: null, status: 'paused' }
}

/**
 * Back to the start of the current phase. Resetting a phase that is already at its start goes
 * back to the first Pomodoro session, so pressing Reset twice always gives a clean slate.
 */
function reset(state: TimerState, config: TimerConfig): TimerState {
  const phaseStart = freshRun(state.mode, state.phase, state.session, config)
  const atPhaseStart = state.status === 'idle' && state.durationSec === phaseStart.durationSec
  if (state.mode === 'pomodoro' && atPhaseStart) return initialTimerState('pomodoro', config)
  return phaseStart
}

function addFiveMinutes(state: TimerState): TimerState {
  if (state.mode === 'stopwatch') return state
  const durationSec = Math.min(state.durationSec + FIVE_MINUTES_SEC, MAX_DURATION_SEC)
  if (durationSec === state.durationSec) return state
  // On a countdown that ran out, +5 min is a snooze: five more minutes, ready to resume.
  if (state.status === 'finished') return { ...state, durationSec, status: 'paused' }
  return { ...state, durationSec }
}

/**
 * A length set on the card, before a run starts or once it's over (never mid-run, so a stray
 * click can't change a session that's going). Its switch can also pick the other Pomodoro phase:
 * skipping a break moves on to the next session, as a finished break does.
 */
function runAtLength(
  state: TimerState,
  command: Extract<TimerCommand, { kind: 'useLength' }>,
  now: number
): TimerState {
  if (state.mode === 'stopwatch') return state
  if (state.status === 'running' || state.status === 'paused') return state
  const phase = state.mode === 'pomodoro' ? command.phase : 'focus'
  const skippedBreak = state.phase === 'break' && phase === 'focus'
  return {
    mode: state.mode,
    phase,
    session: skippedBreak ? (state.session % POMODORO_SESSIONS) + 1 : state.session,
    durationSec: command.durationSec,
    elapsedSec: 0,
    runningSince: command.start ? now : null,
    status: command.start ? 'running' : 'idle'
  }
}

function selectMode(state: TimerState, mode: TimerMode, config: TimerConfig): TimerState {
  // Tapping the mode that's already on shouldn't throw away a run in progress.
  return state.mode === mode ? state : initialTimerState(mode, config)
}

export function applyCommand(
  state: TimerState,
  command: TimerCommand,
  config: TimerConfig,
  now: number
): TimerState {
  switch (command.kind) {
    case 'start':
      return start(state, now)
    case 'pause':
      return pause(state, now)
    case 'reset':
      return reset(state, config)
    case 'addFiveMinutes':
      return addFiveMinutes(state)
    case 'selectMode':
      return selectMode(state, command.mode, config)
    case 'useLength':
      return runAtLength(state, command, now)
  }
}

/** New settings: a run that hasn't started takes the new length; one in progress keeps its own. */
export function applyConfig(state: TimerState, config: TimerConfig): TimerState {
  if (state.status !== 'idle') return state
  const durationSec = lengthOf(state.mode, state.phase, config)
  return durationSec === state.durationSec ? state : { ...state, durationSec }
}

function complete(state: TimerState, config: TimerConfig, at: number): TimerState {
  if (state.mode !== 'pomodoro') {
    return { ...state, elapsedSec: state.durationSec, runningSince: null, status: 'finished' }
  }
  if (state.phase === 'focus') {
    const breakRun = freshRun('pomodoro', 'break', state.session, config)
    return config.autoStartBreaks ? { ...breakRun, runningSince: at, status: 'running' } : breakRun
  }
  // Only breaks start on their own; the next focus session waits for the user.
  return freshRun('pomodoro', 'focus', (state.session % POMODORO_SESSIONS) + 1, config)
}

/**
 * Applies every run that has ended by `now`, each at the moment it ended. After a long gap
 * (app closed, Mac asleep) a focus session can roll into an auto-started break and on into
 * the next focus session, which always waits for the user, so this stops there.
 */
export function advance(
  state: TimerState,
  config: TimerConfig,
  now: number
): { state: TimerState; completed: CompletedRun[] } {
  const completed: CompletedRun[] = []
  let current = state
  while (current.status === 'running' && current.durationSec > 0) {
    const runningSince = current.runningSince ?? now
    const endsAt = runningSince + current.durationSec - current.elapsedSec
    if (now < endsAt) break
    completed.push({ mode: current.mode, phase: current.phase, at: endsAt })
    current = complete(current, config, endsAt)
  }
  return { state: current, completed }
}
