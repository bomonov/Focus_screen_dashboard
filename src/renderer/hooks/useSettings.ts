import type { Settings } from '../../main/ipc'
import { useBridgeValue } from './useBridgeValue'

const load = (): Promise<Settings> => window.focusScreen.getSettings()
const subscribe = (listener: (settings: Settings) => void): (() => void) =>
  window.focusScreen.onSettingsChanged(listener)

export function useSettings(): Settings | null {
  return useBridgeValue(load, subscribe)
}
