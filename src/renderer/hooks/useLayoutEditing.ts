import { useBridgeValue } from './useBridgeValue'

const load = (): Promise<boolean> => window.focusScreen.getLayoutEditing()
const subscribe = (listener: (editing: boolean) => void): (() => void) =>
  window.focusScreen.onLayoutEditingChanged(listener)

/** True while the cards on the Focus Screen are being moved and resized. */
export function useLayoutEditing(): boolean {
  return useBridgeValue(load, subscribe) ?? false
}
