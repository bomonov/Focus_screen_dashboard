// Timer types shared with the renderer, plus the one calculation both sides need.
// Keep this file free of imports: the renderer compiles it too.

export type TimerMode = 'pomodoro' | 'countdown' | 'stopwatch'
export type PomodoroPhase = 'focus' | 'break'
/** The three lengths that can be set: Pomodoro's two phases and the countdown. */
export type TimerLength = 'focus' | 'break' | 'countdown'
/**
 * idle: at full length, never started. paused: started, then stopped part-way.
 * finished: a countdown that ran out (Pomodoro phases roll over into the next phase instead).
 */
export type TimerStatus = 'idle' | 'running' | 'paused' | 'finished'

/** Focus sessions per Pomodoro cycle ("session 2 of 4"). */
export const POMODORO_SESSIONS = 4

/** All times are seconds. Timestamps are Unix epoch seconds (Date.now() / 1000). */
export interface TimerState {
  mode: TimerMode
  /** Only meaningful in Pomodoro; always 'focus' in the other modes. */
  phase: PomodoroPhase
  /** 1..POMODORO_SESSIONS. */
  session: number
  /** Length of the current run. 0 for the stopwatch, which has no end. */
  durationSec: number
  /** Time banked before the current run started. */
  elapsedSec: number
  /**
   * When the current run started, or null when not running. Storing an anchor instead of
   * ticking a counter keeps the timer right across restarts and system sleep.
   */
  runningSince: number | null
  status: TimerStatus
}

/** What the renderer may ask for. Anything else is dropped by the main process. */
export type TimerCommand =
  | { kind: 'start' }
  | { kind: 'pause' }
  | { kind: 'reset' }
  | { kind: 'addFiveMinutes' }
  | { kind: 'selectMode'; mode: TimerMode }
  /**
   * A length set on the card: a fresh run of `durationSec` in `phase` (Pomodoro only; the other
   * modes keep 'focus'), started now or left ready. Only before a run starts or once it's over.
   */
  | { kind: 'useLength'; phase: PomodoroPhase; durationSec: number; start: boolean }

/** A run that reached its end, for the chime. */
export interface TimerCompletion {
  mode: TimerMode
  phase: PomodoroPhase
}

/**
 * Time spent in the current run at `now`. Main uses it to find the end; the renderer uses it
 * to draw the seconds between state pushes, so both always agree.
 */
export function elapsedAt(state: TimerState, now: number): number {
  const sinceStart = state.runningSince === null ? 0 : Math.max(0, now - state.runningSince)
  const elapsed = state.elapsedSec + sinceStart
  return state.durationSec > 0 ? Math.min(elapsed, state.durationSec) : elapsed
}
