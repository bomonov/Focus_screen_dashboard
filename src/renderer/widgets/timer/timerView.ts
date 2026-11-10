import type { TimerCommand, TimerDirection, TimerState } from '../../../main/ipc'
import { elapsedAt, POMODORO_SESSIONS } from '../../../main/services/timer/types'

/** Which color the ring and bar are: a Pomodoro break has its own, calmer one. */
export type TimerTone = 'focus' | 'break'

export interface TimerView {
  /** "18:00", or "1:05:12" past an hour. */
  text: string
  /** "Focus · session 2 of 4", "Paused", "Time's up"… */
  caption: string
  /** How full the ring or bar is, 0–1. */
  progress: number
  /** "18:00 remaining", for screen readers. */
  ariaLabel: string
  primary: { label: 'Start' | 'Pause' | 'Resume' | 'Restart'; command: TimerCommand }
  canAddTime: boolean
  tone: TimerTone
}

export function formatClock(totalSec: number): string {
  const whole = Math.max(0, Math.floor(totalSec))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const seconds = String(whole % 60).padStart(2, '0')
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${String(minutes).padStart(2, '0')}:${seconds}`
}

function captionFor(state: TimerState): string {
  if (state.status === 'paused') return 'Paused'
  if (state.status === 'finished') return "Time's up"
  switch (state.mode) {
    case 'pomodoro':
      return state.phase === 'focus'
        ? `Focus · session ${state.session} of ${POMODORO_SESSIONS}`
        : `Break · ${state.session} of ${POMODORO_SESSIONS} done`
    case 'countdown':
      return 'Countdown'
    case 'stopwatch':
      return 'Stopwatch'
  }
}

function primaryFor(state: TimerState): TimerView['primary'] {
  switch (state.status) {
    case 'idle':
      return { label: 'Start', command: { kind: 'start' } }
    case 'running':
      return { label: 'Pause', command: { kind: 'pause' } }
    case 'paused':
      return { label: 'Resume', command: { kind: 'start' } }
    case 'finished':
      return { label: 'Restart', command: { kind: 'start' } }
  }
}

export function timerView(state: TimerState, direction: TimerDirection, now: number): TimerView {
  const elapsed = elapsedAt(state, now)
  const isStopwatch = state.durationSec === 0
  const countUp = isStopwatch || direction === 'up'
  const remaining = state.durationSec - elapsed

  // Remaining rounds up so a run shows its full length at the start and 00:00 only at the end.
  const text = formatClock(countUp ? elapsed : Math.ceil(remaining))
  let progress: number
  if (isStopwatch) {
    // No end to measure against, so the ring sweeps once a minute like a second hand.
    progress = (elapsed % 60) / 60
  } else {
    progress = countUp ? elapsed / state.durationSec : remaining / state.durationSec
  }

  return {
    text,
    caption: captionFor(state),
    progress: Math.min(1, Math.max(0, progress)),
    ariaLabel: `${text} ${countUp ? 'elapsed' : 'remaining'}`,
    primary: primaryFor(state),
    canAddTime: !isStopwatch,
    tone: state.mode === 'pomodoro' && state.phase === 'break' ? 'break' : 'focus'
  }
}
