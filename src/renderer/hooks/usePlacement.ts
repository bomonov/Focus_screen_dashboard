import type { PlacementInfo } from '../../main/ipc'
import { useBridgeValue } from './useBridgeValue'

const load = (): Promise<PlacementInfo> => window.focusScreen.getPlacement()
const subscribe = (listener: (placement: PlacementInfo) => void): (() => void) =>
  window.focusScreen.onPlacementChanged(listener)

export function usePlacement(): PlacementInfo | null {
  return useBridgeValue(load, subscribe)
}
