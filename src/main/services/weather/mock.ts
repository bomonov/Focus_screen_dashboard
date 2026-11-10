// Dev builds: a clear Tempe day, made up from the clock, with no helper and no network.
import { weatherKind, weatherWords } from './codes'
import type { LocationSource } from './location'
import type { WeatherSource } from './openMeteo'
import type { Forecast, LatLon, WeatherHour } from './types'

/** Old Main, ASU's Tempe campus. */
export const DEMO_POSITION: LatLon = { lat: 33.4255, lon: -111.94 }

/** A good Wi-Fi fix. */
export const DEMO_ACCURACY_M = 50

/** Arizona keeps UTC−7 all year. */
const ARIZONA_OFFSET_SEC = 7 * 3600
const LOW_F = 74
const HIGH_F = 101
const LOW_HOUR = 6
const HIGH_HOUR = 16

const celsius = (fahrenheit: number): number => ((fahrenheit - 32) * 5) / 9

/** Rises from 74 °F at 6 AM to 101 °F at 4 PM, then falls back overnight. */
function demoF(hour: number): number {
  const swing = HIGH_F - LOW_F
  const rising = HIGH_HOUR - LOW_HOUR
  const since = (((hour - LOW_HOUR) % 24) + 24) % 24
  if (since <= rising) return LOW_F + (swing * (1 - Math.cos((Math.PI * since) / rising))) / 2
  const falling = 24 - rising
  return HIGH_F - (swing * (1 - Math.cos((Math.PI * (since - rising)) / falling))) / 2
}

/** A few clouds come over at 5 and 6 PM. */
const demoCode = (hour: number): number => (hour === 17 || hour === 18 ? 2 : 0)
const isDemoDay = (hour: number): boolean => hour >= 6 && hour < 18

export function demoLocation(): LocationSource {
  return {
    access: () => 'granted',
    onAccess: () => () => undefined,
    requestAccess: () => undefined,
    locate: () =>
      Promise.resolve({ ok: true, position: DEMO_POSITION, accuracyM: DEMO_ACCURACY_M }),
    placeName: () => Promise.resolve('Tempe'),
    stop: () => undefined
  }
}

export function demoWeather(now: () => number): WeatherSource {
  return {
    read() {
      const nowSec = Math.floor(now() / 1000)
      const local = nowSec - ARIZONA_OFFSET_SEC
      const hourStart = Math.floor(nowSec / 3600) * 3600
      const hourOf = (at: number): number => Math.floor((at - ARIZONA_OFFSET_SEC) / 3600) % 24
      const hours: WeatherHour[] = Array.from({ length: 24 }, (_, index) => {
        const at = hourStart + index * 3600
        const hour = hourOf(at)
        return {
          at,
          tempC: celsius(demoF(hour)),
          kind: weatherKind(demoCode(hour)),
          isDay: isDemoDay(hour)
        }
      })
      const hour = (local / 3600) % 24
      const code = demoCode(Math.floor(hour))
      const isDay = isDemoDay(Math.floor(hour))
      const forecast: Forecast = {
        tempC: celsius(demoF(hour)),
        // Dry heat feels a little hotter than it reads.
        feelsLikeC: celsius(demoF(hour) + 3),
        highC: celsius(HIGH_F),
        lowC: celsius(LOW_F),
        kind: weatherKind(code),
        words: weatherWords(code, isDay),
        isDay,
        hours
      }
      return Promise.resolve(forecast)
    }
  }
}
