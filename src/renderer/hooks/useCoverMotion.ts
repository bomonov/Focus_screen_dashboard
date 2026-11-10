import type { CoverMotionState } from '../../main/ipc'
import { useBridgeValue } from './useBridgeValue'

const load = (): Promise<CoverMotionState> => window.focusScreen.getCoverMotion()
const subscribe = (listener: (state: CoverMotionState) => void): (() => void) =>
  window.focusScreen.onCoverMotionChanged(listener)

/** The playing cover's moving parts, from main; null until it answers. */
export function useCoverMotion(): CoverMotionState | null {
  return useBridgeValue(load, subscribe)
}
