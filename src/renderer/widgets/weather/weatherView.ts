import type {
  TemperatureUnit,
  WeatherCommand,
  WeatherHour,
  WeatherReading,
  WeatherState
} from '../../../main/ipc'

/** A reading older than this says too little about now to show. */
export const STALE_SEC = 3600
/** The hold card's next hours. */
const HOURS_SHOWN = 6

/** "98°": whole degrees in the user's unit (main keeps °C). */
export function temperature(celsius: number, unit: TemperatureUnit): string {
  const degrees = Math.round(unit === 'f' ? (celsius * 9) / 5 + 32 : celsius)
  // Math.round(-0.4) is -0, which toLocaleString would print as "-0".
  return `${degrees === 0 ? 0 : degrees}°`
}

export type WeatherPillView =
  | { kind: 'reading'; reading: WeatherReading; place: string | null }
  /** Location isn't allowed: the words, and what clicking the pill does about it. */
  | { kind: 'setup'; text: string; action: WeatherCommand['kind'] }
  /** Reads have failed for an hour: clicking tries again. */
  | { kind: 'unavailable' }

/** What the pill shows, or null for nothing at all (off, or the first read under way). */
export function weatherPillView(
  state: WeatherState | null,
  nowSec: number
): WeatherPillView | null {
  if (!state?.supported) return null
  switch (state.access) {
    case null:
      return null
    case 'notDetermined':
      return { kind: 'setup', text: 'Allow Location for weather', action: 'requestAccess' }
    case 'denied':
    case 'restricted':
      return { kind: 'setup', text: 'Turn on Location for weather', action: 'openLocationSettings' }
    case 'off':
      return {
        kind: 'setup',
        text: 'Location Services is off on this Mac',
        action: 'openLocationSettings'
      }
    case 'granted': {
      const { reading, place, problem } = state
      if (reading && nowSec - reading.readAt <= STALE_SEC)
        return { kind: 'reading', reading, place }
      // Too old with nothing wrong yet: a read is under way (just shown again, say).
      return problem ? { kind: 'unavailable' } : null
    }
  }
}

/** The next whole hours after now, by the renderer's clock, not when the reading was taken. */
export function nextHours(
  hours: readonly WeatherHour[],
  nowSec: number,
  count = HOURS_SHOWN
): WeatherHour[] {
  return hours.filter((hour) => hour.at > nowSec).slice(0, count)
}
