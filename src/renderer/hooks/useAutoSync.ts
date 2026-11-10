import type { AutoSyncState } from '../../main/ipc'
import { useBridgeValue } from './useBridgeValue'

const load = (): Promise<AutoSyncState> => window.focusScreen.getAutoSync()
const subscribe = (listener: (state: AutoSyncState) => void): (() => void) =>
  window.focusScreen.onAutoSyncChanged(listener)

export function useAutoSync(): AutoSyncState | null {
  return useBridgeValue(load, subscribe)
}
