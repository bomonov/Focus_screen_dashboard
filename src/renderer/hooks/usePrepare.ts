import type { PrepareState } from '../../main/ipc'
import { useBridgeValue } from './useBridgeValue'

const load = (): Promise<PrepareState> => window.focusScreen.getPrepare()
const subscribe = (listener: (state: PrepareState) => void): (() => void) =>
  window.focusScreen.onPrepareChanged(listener)

export function usePrepare(): PrepareState | null {
  return useBridgeValue(load, subscribe)
}
