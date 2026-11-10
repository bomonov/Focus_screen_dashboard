import { describe, expect, it } from 'vitest'
import { weatherKind, weatherWords } from './codes'

describe('weatherWords', () => {
  it('says sunny by day and clear by night', () => {
    expect(weatherWords(0, true)).toBe('Sunny')
    expect(weatherWords(0, false)).toBe('Clear')
  })

  it('words each kind of weather', () => {
    expect(weatherWords(1, true)).toBe('Mostly clear')
    expect(weatherWords(2, true)).toBe('Partly cloudy')
    expect(weatherWords(3, true)).toBe('Cloudy')
    expect(weatherWords(45, true)).toBe('Fog')
    expect(weatherWords(51, true)).toBe('Light drizzle')
    expect(weatherWords(61, true)).toBe('Light rain')
    expect(weatherWords(65, true)).toBe('Heavy rain')
    expect(weatherWords(66, true)).toBe('Freezing rain')
    expect(weatherWords(75, true)).toBe('Heavy snow')
    expect(weatherWords(81, true)).toBe('Rain showers')
    expect(weatherWords(86, true)).toBe('Snow showers')
    expect(weatherWords(95, true)).toBe('Thunderstorm')
    expect(weatherWords(99, true)).toBe('Thunderstorm with hail')
  })

  it('has no words for a code it doesn’t know', () => {
    expect(weatherWords(42, true)).toBeNull()
  })
})

describe('weatherKind', () => {
  it('picks the icon for each code', () => {
    expect(weatherKind(0)).toBe('clear')
    expect(weatherKind(1)).toBe('clear')
    expect(weatherKind(2)).toBe('partlyCloudy')
    expect(weatherKind(48)).toBe('fog')
    expect(weatherKind(55)).toBe('rain')
    expect(weatherKind(73)).toBe('snow')
    expect(weatherKind(96)).toBe('storm')
    expect(weatherKind(42)).toBeNull()
  })
})
