import type { TransitState } from '../../main/ipc'
import { useBridgeValue } from './useBridgeValue'

const load = (): Promise<TransitState> => window.focusScreen.getTransit()
const subscribe = (listener: (state: TransitState) => void): (() => void) =>
  window.focusScreen.onTransitChanged(listener)

/** Next bus: the stop list, the picked stops, and Valley Metro's coming buses. */
export function useTransit(): TransitState | null {
  return useBridgeValue(load, subscribe)
}
