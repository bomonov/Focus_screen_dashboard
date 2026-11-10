import { MAX_LENGTH_SEC } from './lengths'
import { freshRun, initialTimerState, MAX_DURATION_SEC, type TimerConfig } from './machine'
import {
  POMODORO_SESSIONS,
  type PomodoroPhase,
  type TimerCommand,
  type TimerMode,
  type TimerState,
  type TimerStatus
} from './types'

const MODES: readonly TimerMode[] = ['pomodoro', 'countdown', 'stopwatch']
const STATUSES: readonly TimerStatus[] = ['idle', 'running', 'paused', 'finished']
const PHASES: readonly PomodoroPhase[] = ['focus', 'break']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function parseMode(value: unknown): TimerMode | undefined {
  return MODES.find((mode) => mode === value)
}

/** Commands come from the renderer, so they're untrusted: only the exact known shapes pass. */
export function parseTimerCommand(raw: unknown): TimerCommand | null {
  if (!isRecord(raw)) return null
  switch (raw.kind) {
    case 'start':
    case 'pause':
    case 'reset':
    case 'addFiveMinutes':
      return { kind: raw.kind }
    case 'selectMode': {
      const mode = parseMode(raw.mode)
      return mode ? { kind: 'selectMode', mode } : null
    }
    case 'useLength': {
      const phase = PHASES.find((p) => p === raw.phase)
      const { durationSec, start } = raw
      const lengthOk =
        typeof durationSec === 'number' &&
        Number.isInteger(durationSec) &&
        durationSec >= 1 &&
        durationSec <= MAX_LENGTH_SEC
      return phase && lengthOk && typeof start === 'boolean'
        ? { kind: 'useLength', phase, durationSec, start }
        : null
    }
    default:
      return null
  }
}

/**
 * Turns timer.json back into a TimerState. Anything inconsistent falls back to the start of
 * the saved phase (or a fresh Pomodoro), never to a half-valid state.
 */
export function parseTimerState(raw: unknown, config: TimerConfig, now: number): TimerState {
  if (!isRecord(raw)) return initialTimerState('pomodoro', config)
  const mode = parseMode(raw.mode)
  if (!mode) return initialTimerState('pomodoro', config)

  const phase: PomodoroPhase = mode === 'pomodoro' && raw.phase === 'break' ? 'break' : 'focus'
  const session =
    mode === 'pomodoro' &&
    typeof raw.session === 'number' &&
    Number.isInteger(raw.session) &&
    raw.session >= 1 &&
    raw.session <= POMODORO_SESSIONS
      ? raw.session
      : 1
  const phaseStart = freshRun(mode, phase, session, config)

  const status = STATUSES.find((s) => s === raw.status)
  const { durationSec, elapsedSec, runningSince } = raw
  const durationOk =
    mode === 'stopwatch'
      ? durationSec === 0
      : isSeconds(durationSec) && durationSec > 0 && durationSec <= MAX_DURATION_SEC
  if (!status || !durationOk || !isSeconds(durationSec) || !isSeconds(elapsedSec)) {
    return phaseStart
  }

  const base = { mode, phase, session, durationSec }
  const banked = mode === 'stopwatch' ? elapsedSec : Math.min(elapsedSec, durationSec)
  switch (status) {
    case 'idle':
      return { ...base, elapsedSec: 0, runningSince: null, status }
    case 'paused':
      return { ...base, elapsedSec: banked, runningSince: null, status }
    case 'finished':
      // Only a countdown stops at its end; Pomodoro moves on and the stopwatch never ends.
      return mode === 'countdown'
        ? { ...base, elapsedSec: durationSec, runningSince: null, status }
        : phaseStart
    case 'running':
      if (typeof runningSince !== 'number' || !Number.isFinite(runningSince)) return phaseStart
      // A start time in the future means the clock was set back; count from now instead.
      return { ...base, elapsedSec: banked, runningSince: Math.min(runningSince, now), status }
  }
}
