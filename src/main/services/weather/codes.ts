// Open-Meteo's weather codes (WMO 4677's "present weather", the few it uses) as an icon and a
// few words for the card.
import type { WeatherKind } from './types'

interface Code {
  kind: WeatherKind
  words: string
}

const CODES: Readonly<Record<number, Code>> = {
  // 0 is "Sunny" by day, "Clear" by night: weatherWords picks.
  0: { kind: 'clear', words: 'Clear' },
  1: { kind: 'clear', words: 'Mostly clear' },
  2: { kind: 'partlyCloudy', words: 'Partly cloudy' },
  3: { kind: 'cloudy', words: 'Cloudy' },
  45: { kind: 'fog', words: 'Fog' },
  48: { kind: 'fog', words: 'Fog' },
  51: { kind: 'rain', words: 'Light drizzle' },
  53: { kind: 'rain', words: 'Drizzle' },
  55: { kind: 'rain', words: 'Drizzle' },
  56: { kind: 'rain', words: 'Freezing rain' },
  57: { kind: 'rain', words: 'Freezing rain' },
  61: { kind: 'rain', words: 'Light rain' },
  63: { kind: 'rain', words: 'Rain' },
  65: { kind: 'rain', words: 'Heavy rain' },
  66: { kind: 'rain', words: 'Freezing rain' },
  67: { kind: 'rain', words: 'Freezing rain' },
  71: { kind: 'snow', words: 'Light snow' },
  73: { kind: 'snow', words: 'Snow' },
  75: { kind: 'snow', words: 'Heavy snow' },
  77: { kind: 'snow', words: 'Snow' },
  80: { kind: 'rain', words: 'Rain showers' },
  81: { kind: 'rain', words: 'Rain showers' },
  82: { kind: 'rain', words: 'Rain showers' },
  85: { kind: 'snow', words: 'Snow showers' },
  86: { kind: 'snow', words: 'Snow showers' },
  95: { kind: 'storm', words: 'Thunderstorm' },
  96: { kind: 'storm', words: 'Thunderstorm with hail' },
  99: { kind: 'storm', words: 'Thunderstorm with hail' }
}

export function weatherKind(code: number): WeatherKind | null {
  return CODES[code]?.kind ?? null
}

export function weatherWords(code: number, isDay: boolean): string | null {
  if (code === 0 && isDay) return 'Sunny'
  return CODES[code]?.words ?? null
}
