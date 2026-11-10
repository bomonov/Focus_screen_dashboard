import type { WeatherCommand } from './types'

/** The pill's and Customize's buttons; from the renderer, so only the exact known shapes pass. */
export function parseWeatherCommand(raw: unknown): WeatherCommand | null {
  if (typeof raw !== 'object' || raw === null) return null
  const kind = (raw as Record<string, unknown>).kind
  return kind === 'retry' || kind === 'requestAccess' || kind === 'openLocationSettings'
    ? { kind }
    : null
}
