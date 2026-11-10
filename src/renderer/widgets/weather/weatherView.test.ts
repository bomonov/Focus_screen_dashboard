import { describe, expect, it } from 'vitest'
import type { WeatherHour, WeatherReading, WeatherState } from '../../../main/ipc'
import { nextHours, temperature, weatherPillView } from './weatherView'

const NOW = 1_793_087_100

function reading(readAt: number): WeatherReading {
  return {
    readAt,
    tempC: 36.7,
    feelsLikeC: 38.1,
    highC: 38.3,
    lowC: 23.4,
    kind: 'clear',
    words: 'Sunny',
    isDay: true,
    hours: []
  }
}

function state(change: Partial<WeatherState>): WeatherState {
  return {
    supported: true,
    access: 'granted',
    place: 'Tempe',
    reading: reading(NOW),
    problem: null,
    demo: false,
    ...change
  }
}

describe('temperature', () => {
  it('shows whole degrees in the user’s unit', () => {
    expect(temperature(36.7, 'f')).toBe('98°')
    expect(temperature(36.7, 'c')).toBe('37°')
  })

  it('never shows minus zero', () => {
    expect(temperature(-0.4, 'c')).toBe('0°')
  })
})

describe('weatherPillView', () => {
  it('shows nothing without weather', () => {
    expect(weatherPillView(null, NOW)).toBeNull()
    expect(weatherPillView(state({ supported: false }), NOW)).toBeNull()
    expect(weatherPillView(state({ access: null }), NOW)).toBeNull()
  })

  it('says how to fix Location', () => {
    expect(weatherPillView(state({ access: 'notDetermined' }), NOW)).toEqual({
      kind: 'setup',
      text: 'Allow Location for weather',
      action: 'requestAccess'
    })
    for (const access of ['denied', 'restricted'] as const) {
      expect(weatherPillView(state({ access }), NOW)).toEqual({
        kind: 'setup',
        text: 'Turn on Location for weather',
        action: 'openLocationSettings'
      })
    }
    expect(weatherPillView(state({ access: 'off' }), NOW)).toEqual({
      kind: 'setup',
      text: 'Location Services is off on this Mac',
      action: 'openLocationSettings'
    })
  })

  it('shows a reading up to an hour old', () => {
    const fresh = state({ reading: reading(NOW - 3599) })
    expect(weatherPillView(fresh, NOW)).toEqual({
      kind: 'reading',
      reading: fresh.reading,
      place: 'Tempe'
    })
  })

  it('says unavailable once the reading is too old and reads fail', () => {
    const old = state({ reading: reading(NOW - 3601), problem: 'Open-Meteo didn’t answer.' })
    expect(weatherPillView(old, NOW)).toEqual({ kind: 'unavailable' })
    const never = state({ reading: null, problem: 'Open-Meteo didn’t answer.' })
    expect(weatherPillView(never, NOW)).toEqual({ kind: 'unavailable' })
  })

  it('waits quietly for a read under way', () => {
    expect(weatherPillView(state({ reading: reading(NOW - 3601) }), NOW)).toBeNull()
    expect(weatherPillView(state({ reading: null }), NOW)).toBeNull()
  })
})

describe('nextHours', () => {
  /** 2 PM to 11 PM, an hour apart. */
  const TWO_PM = 1_793_041_200
  const hours: WeatherHour[] = Array.from({ length: 10 }, (_, index) => ({
    at: TWO_PM + index * 3600,
    tempC: 30 + index,
    kind: 'clear',
    isDay: true
  }))

  it('nextHours starts after now, not after readAt', () => {
    const quarterTo3 = TWO_PM + 45 * 60
    const shown = nextHours(hours, quarterTo3)
    expect(shown).toHaveLength(6)
    expect(shown[0]?.at).toBe(TWO_PM + 3600)
    expect(nextHours(hours, TWO_PM + 3600)[0]?.at).toBe(TWO_PM + 2 * 3600)
  })
})
