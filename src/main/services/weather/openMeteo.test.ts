import { describe, expect, it } from 'vitest'
import { createOpenMeteo, forecastUrl, parseForecast } from './openMeteo'

/** 2026-10-27, midnight in Arizona (UTC−7). */
const MIDNIGHT = Date.UTC(2026, 9, 27, 7) / 1000
/** 2:45 PM that day. */
const NOW = MIDNIGHT + 14.75 * 3600

function body(): Record<string, unknown> {
  const time = Array.from({ length: 48 }, (_, hour) => MIDNIGHT + hour * 3600)
  return {
    current: { temperature_2m: 36.7, apparent_temperature: 38.1, weather_code: 0, is_day: 1 },
    hourly: {
      time,
      temperature_2m: time.map((_, hour) => 20 + (hour % 24)),
      weather_code: time.map((_, hour) => (hour % 24 >= 17 ? 2 : 0)),
      is_day: time.map((_, hour) => (hour % 24 >= 6 && hour % 24 < 18 ? 1 : 0))
    },
    daily: {
      time: [MIDNIGHT, MIDNIGHT + 86400],
      temperature_2m_max: [38.3, 37.8],
      temperature_2m_min: [23.4, 22.8]
    }
  }
}

describe('forecastUrl', () => {
  it('asks only for what the pill and card show, in metric', () => {
    expect(forecastUrl({ lat: 33.42, lon: -111.93 })).toBe(
      'https://api.open-meteo.com/v1/forecast?latitude=33.42&longitude=-111.93' +
        '&current=temperature_2m,apparent_temperature,weather_code,is_day' +
        '&hourly=temperature_2m,weather_code,is_day' +
        '&daily=temperature_2m_max,temperature_2m_min' +
        '&timezone=auto&forecast_days=2&timeformat=unixtime'
    )
  })
})

describe('parseForecast', () => {
  it('reads now, today and the hours from the one under way', () => {
    const forecast = parseForecast(body(), NOW)
    expect(forecast).toMatchObject({
      tempC: 36.7,
      feelsLikeC: 38.1,
      highC: 38.3,
      lowC: 23.4,
      kind: 'clear',
      words: 'Sunny',
      isDay: true
    })
    expect(forecast?.hours).toHaveLength(24)
    expect(forecast?.hours[0]).toEqual({
      at: MIDNIGHT + 14 * 3600,
      tempC: 34,
      kind: 'clear',
      isDay: true
    })
    expect(forecast?.hours[3]).toEqual({
      at: MIDNIGHT + 17 * 3600,
      tempC: 37,
      kind: 'partlyCloudy',
      isDay: true
    })
  })

  it('takes tomorrow’s high and low once it’s tomorrow', () => {
    expect(parseForecast(body(), MIDNIGHT + 86400 + 3600)).toMatchObject({
      highC: 37.8,
      lowC: 22.8
    })
  })

  it('rejects a body without current', () => {
    const broken = body()
    delete broken.current
    expect(parseForecast(broken, NOW)).toBeNull()
  })

  it('rejects hourly arrays of different lengths', () => {
    const broken = body()
    const hourly = broken.hourly as Record<string, unknown[]>
    hourly.temperature_2m = hourly.temperature_2m?.slice(1) ?? []
    expect(parseForecast(broken, NOW)).toBeNull()
  })

  it('rejects a temperature that isn’t a number', () => {
    const broken = body()
    ;(broken.current as Record<string, unknown>).temperature_2m = null
    expect(parseForecast(broken, NOW)).toBeNull()
    const brokenHour = body()
    const temperatures = (brokenHour.hourly as Record<string, unknown[]>).temperature_2m ?? []
    // 4 PM: inside the hours the card shows.
    temperatures[16] = 'hot'
    expect(parseForecast(brokenHour, NOW)).toBeNull()
  })

  it('rejects null', () => {
    expect(parseForecast(null, NOW)).toBeNull()
  })
})

describe('createOpenMeteo', () => {
  it('sends only the rounded position and reads the answer', async () => {
    const asked: string[] = []
    const source = createOpenMeteo(
      async (url) => {
        asked.push(url)
        return { status: 200, body: body() }
      },
      () => NOW * 1000
    )
    const forecast = await source.read({ lat: 33.42456, lon: -111.93349 })
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('latitude=33.42&longitude=-111.93&')
    expect(forecast?.tempC).toBe(36.7)
  })

  it('gives null for an error status or a body it can’t read', async () => {
    const failing = createOpenMeteo(
      async () => ({ status: 429, body: body() }),
      () => NOW * 1000
    )
    expect(await failing.read({ lat: 33.42, lon: -111.93 })).toBeNull()
    const garbled = createOpenMeteo(
      async () => ({ status: 200, body: 'nope' }),
      () => NOW * 1000
    )
    expect(await garbled.read({ lat: 33.42, lon: -111.93 })).toBeNull()
  })
})
