import type { ScreenCare } from '../../main/ipc'
import { useBridgeValue } from './useBridgeValue'

const load = (): Promise<ScreenCare> => window.focusScreen.getScreenCare()
const subscribe = (listener: (care: ScreenCare) => void): (() => void) =>
  window.focusScreen.onScreenCareChanged(listener)

/** Idle dim and burn-in shift, both decided by the main process. */
export function useScreenCare(): ScreenCare | null {
  return useBridgeValue(load, subscribe)
}
