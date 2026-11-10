import type { CardStatuses } from '../../main/ipc'
import { useBridgeValue } from './useBridgeValue'

const load = (): Promise<CardStatuses> => window.focusScreen.getCardStatuses()
const subscribe = (listener: (statuses: CardStatuses) => void): (() => void) =>
  window.focusScreen.onCardStatusesChanged(listener)

export function useCardStatuses(): CardStatuses | null {
  return useBridgeValue(load, subscribe)
}
