import type { WeatherState } from '../../main/ipc'
import { useBridgeValue } from './useBridgeValue'

const load = (): Promise<WeatherState> => window.focusScreen.getWeather()
const subscribe = (listener: (state: WeatherState) => void): (() => void) =>
  window.focusScreen.onWeatherChanged(listener)

/** The weather pill: where this Mac is (its town) and the forecast there. */
export function useWeather(): WeatherState | null {
  return useBridgeValue(load, subscribe)
}
