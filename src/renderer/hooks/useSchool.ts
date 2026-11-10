import type { SchoolState } from '../../main/ipc'
import { useBridgeValue } from './useBridgeValue'

const load = (): Promise<SchoolState> => window.focusScreen.getSchool()
const subscribe = (listener: (state: SchoolState) => void): (() => void) =>
  window.focusScreen.onSchoolChanged(listener)

/** The school whose buildings Next class's map knows, and its map's state. */
export function useSchool(): SchoolState | null {
  return useBridgeValue(load, subscribe)
}
