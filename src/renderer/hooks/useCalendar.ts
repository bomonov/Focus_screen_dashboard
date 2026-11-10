import type { CalendarState } from '../../main/ipc'
import { useBridgeValue } from './useBridgeValue'

const load = (): Promise<CalendarState> => window.focusScreen.getCalendar()
const subscribe = (listener: (state: CalendarState) => void): (() => void) =>
  window.focusScreen.onCalendarChanged(listener)

/** Next class: the calendars, macOS access, and the classes from today through a week on. */
export function useCalendar(): CalendarState | null {
  return useBridgeValue(load, subscribe)
}
