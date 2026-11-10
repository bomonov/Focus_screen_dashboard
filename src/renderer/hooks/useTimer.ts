import type { TimerState } from '../../main/ipc'
import { useBridgeValue } from './useBridgeValue'

const load = (): Promise<TimerState> => window.focusScreen.getTimer()
const subscribe = (listener: (timer: TimerState) => void): (() => void) =>
  window.focusScreen.onTimerChanged(listener)

export function useTimer(): TimerState | null {
  return useBridgeValue(load, subscribe)
}
