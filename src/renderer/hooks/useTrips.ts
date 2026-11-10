import type { TripState } from '../../main/ipc'
import { useBridgeValue } from './useBridgeValue'

const load = (): Promise<TripState> => window.focusScreen.getTrips()
const subscribe = (listener: (state: TripState) => void): (() => void) =>
  window.focusScreen.onTripsChanged(listener)

/** The trip card's state: where to, the trips planned, the one kept. */
export function useTrips(): TripState | null {
  return useBridgeValue(load, subscribe)
}
