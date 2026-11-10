import { describe, expect, it } from 'vitest'
import {
  BREAK_PICKS,
  clockLabel,
  COUNTDOWN_PICKS,
  FOCUS_PICKS,
  joinLength,
  MAX_LENGTH_SEC,
  pickLabel,
  splitLength,
  spokenLength
} from './lengths'

describe('timer lengths', () => {
  it('goes up to 23:59:59', () => {
    expect(MAX_LENGTH_SEC).toBe(86399)
  })

  it('keeps the old presets as quick picks, in seconds', () => {
    expect(FOCUS_PICKS).toEqual([1500, 2700, 3000])
    expect(BREAK_PICKS).toEqual([300, 600, 900])
    expect(COUNTDOWN_PICKS).toEqual([300, 600, 900, 1800, 3600])
  })

  it('splits a length into hours, minutes and seconds, and back', () => {
    expect(splitLength(3930)).toEqual({ hours: 1, minutes: 5, seconds: 30 })
    expect(splitLength(86399)).toEqual({ hours: 23, minutes: 59, seconds: 59 })
    expect(splitLength(0)).toEqual({ hours: 0, minutes: 0, seconds: 0 })
    expect(joinLength({ hours: 1, minutes: 5, seconds: 30 })).toBe(3930)
    expect(joinLength({ hours: 0, minutes: 0, seconds: 0 })).toBe(0)
  })

  it('labels the quick picks in minutes, or hours when even', () => {
    expect(pickLabel(1500)).toBe('25 min')
    expect(pickLabel(300)).toBe('5 min')
    expect(pickLabel(3600)).toBe('1 hour')
    expect(pickLabel(7200)).toBe('2 hours')
    expect(pickLabel(90)).toBe('1:30')
    expect(pickLabel(5400)).toBe('1:30:00')
  })

  it('writes a length the way the face does', () => {
    expect(clockLabel(3930)).toBe('1:05:30')
    expect(clockLabel(1500)).toBe('25:00')
    expect(clockLabel(90)).toBe('1:30')
    expect(clockLabel(5)).toBe('0:05')
    expect(clockLabel(86399)).toBe('23:59:59')
  })

  it('says a length in words, for screen readers', () => {
    expect(spokenLength(3930)).toBe('1 hour 5 minutes 30 seconds')
    expect(spokenLength(1500)).toBe('25 minutes')
    expect(spokenLength(1)).toBe('1 second')
    expect(spokenLength(7260)).toBe('2 hours 1 minute')
    expect(spokenLength(0)).toBe('0 seconds')
  })
})
