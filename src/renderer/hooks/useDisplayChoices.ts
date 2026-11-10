import type { DisplayChoice } from '../../main/ipc'
import { useBridgeValue } from './useBridgeValue'

const load = (): Promise<DisplayChoice[]> => window.focusScreen.getDisplayChoices()
const subscribe = (listener: (choices: DisplayChoice[]) => void): (() => void) =>
  window.focusScreen.onDisplayChoicesChanged(listener)

export function useDisplayChoices(): DisplayChoice[] | null {
  return useBridgeValue(load, subscribe)
}
