// Open-Meteo's forecast, the weather pill's one source: free for non-commercial use, no key,
// CC BY 4.0 ("Weather: Open-Meteo"). It gets only the rounded position, always in metric.
import { weatherKind, weatherWords } from './codes'
import { roundPosition } from './position'
import type { Forecast, LatLon, WeatherHour } from './types'

/** The card shows six; a day's worth leaves room for a reading up to an hour old. */
const HOURS_KEPT = 24
const HOUR_SEC = 3600
const DAY_SEC = 86400

export interface WeatherSource {
  /** null when it can't be read (offline, an error status, a body we can't make sense of). */
  read(position: LatLon): Promise<Forecast | null>
}

export function forecastUrl({ lat, lon }: LatLon): string {
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,apparent_temperature,weather_code,is_day' +
    '&hourly=temperature_2m,weather_code,is_day' +
    '&daily=temperature_2m_max,temperature_2m_min' +
    // The place's own day for the high and low; epoch seconds, so no time zone parsing here.
    '&timezone=auto&forecast_days=2&timeformat=unixtime'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** Same-length arrays under these keys, or null. Their items are checked where they're used. */
function columns(value: unknown, keys: readonly string[]): unknown[][] | null {
  if (!isRecord(value)) return null
  const arrays = keys.map((key) => value[key])
  if (!arrays.every((array): array is unknown[] => Array.isArray(array))) return null
  const length = arrays[0]?.length ?? 0
  return length > 0 && arrays.every((array) => array.length === length) ? arrays : null
}

/** The entry whose span holds `now` (spans run to the next entry), else the first. */
function indexAt(times: readonly unknown[], now: number, span: number): number {
  const found = times.findIndex((time, index) => {
    const next = times[index + 1]
    return isNumber(time) && time <= now && now < (isNumber(next) ? next : time + span)
  })
  return Math.max(0, found)
}

/** Open-Meteo's answer, untrusted: anything missing or not a number in what's shown is null. */
export function parseForecast(body: unknown, nowSec: number): Forecast | null {
  if (!isRecord(body) || !isRecord(body.current)) return null
  const { temperature_2m: temp, apparent_temperature: feels, weather_code: code } = body.current
  const isDay = body.current.is_day === 1
  if (!isNumber(temp) || !isNumber(feels) || !isNumber(code)) return null

  const hourly = columns(body.hourly, ['time', 'temperature_2m', 'weather_code', 'is_day'])
  const daily = columns(body.daily, ['time', 'temperature_2m_max', 'temperature_2m_min'])
  if (!hourly || !daily) return null
  const [times = [], temps = [], codes = [], days = []] = hourly
  const first = indexAt(times, nowSec, HOUR_SEC)
  const hours: WeatherHour[] = []
  for (let index = first; index < Math.min(times.length, first + HOURS_KEPT); index++) {
    const [at, hourTemp, hourCode] = [times[index], temps[index], codes[index]]
    if (!isNumber(at) || !isNumber(hourTemp) || !isNumber(hourCode)) return null
    hours.push({ at, tempC: hourTemp, kind: weatherKind(hourCode), isDay: days[index] === 1 })
  }

  const [dayTimes = [], highs = [], lows = []] = daily
  const today = indexAt(dayTimes, nowSec, DAY_SEC)
  const [high, low] = [highs[today], lows[today]]
  if (!isNumber(high) || !isNumber(low)) return null

  return {
    tempC: temp,
    feelsLikeC: feels,
    highC: high,
    lowC: low,
    kind: weatherKind(code),
    words: weatherWords(code, isDay),
    isDay,
    hours
  }
}

export function createOpenMeteo(
  fetchJson: (url: string) => Promise<{ status: number; body: unknown }>,
  now: () => number
): WeatherSource {
  return {
    async read(position) {
      const { status, body } = await fetchJson(forecastUrl(roundPosition(position)))
      return status === 200 ? parseForecast(body, Math.floor(now() / 1000)) : null
    }
  }
}
