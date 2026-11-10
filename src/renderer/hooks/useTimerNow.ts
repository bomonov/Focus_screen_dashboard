import type { TimerState } from '../../main/ipc'
import { useAnchoredNow } from './useAnchoredNow'

/** The moment to draw the timer at; ticks once per displayed second while a run is going. */
export function useTimerNow(timer: TimerState | null): number {
  return useAnchoredNow(
    timer?.status === 'running' ? timer.runningSince : null,
    timer?.elapsedSec ?? 0
  )
}
