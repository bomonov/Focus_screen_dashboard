import type { HotkeyState } from '../../main/ipc'
import { useBridgeValue } from './useBridgeValue'

const load = (): Promise<HotkeyState> => window.focusScreen.getHotkeys()
const subscribe = (listener: (hotkeys: HotkeyState) => void): (() => void) =>
  window.focusScreen.onHotkeysChanged(listener)

export function useHotkeys(): HotkeyState | null {
  return useBridgeValue(load, subscribe)
}
