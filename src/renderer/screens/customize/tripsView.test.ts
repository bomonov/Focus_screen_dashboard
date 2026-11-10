import { describe, expect, it } from 'vitest'
import { clampEarly, cleanName, earlyWords, locationWords, scheduleWords } from './tripsView'

describe('tripsView', () => {
  it('holds the early minutes to 0–30, whole', () => {
    expect(clampEarly(-3)).toBe(0)
    expect(clampEarly(31)).toBe(30)
    expect(clampEarly(4.6)).toBe(5)
    expect(clampEarly(Number.NaN)).toBe(0)
    expect(earlyWords(0)).toBe('Right on time')
    expect(earlyWords(5)).toBe('5 min early')
  })

  it('cleans a name to 60 characters, or nothing', () => {
    expect(cleanName('   ')).toBeNull()
    expect(cleanName('  Alex’s  ')).toBe('Alex’s')
    expect(cleanName('x'.repeat(80))).toHaveLength(60)
  })

  it('words the schedule and offers the download only when missing', () => {
    expect(scheduleWords('missing').download).toBe('offer')
    expect(scheduleWords('downloading').download).toBe('busy')
    expect(scheduleWords('ready').download).toBe('none')
  })

  it('says why Location is out, with the Settings button only where it helps', () => {
    expect(locationWords(false, null, null)?.settings).toBe(false)
    expect(locationWords(true, { status: 'denied', name: null }, null)?.settings).toBe(true)
    expect(locationWords(true, { status: 'found', name: null }, null)).toBeNull()
  })

  it('says so from macOS’s last word when nothing’s holding the location', () => {
    const off = 'Location is off for Focus Screen on this Mac.'
    expect(locationWords(true, null, 'denied')).toEqual({ text: off, settings: true })
    expect(locationWords(true, null, 'restricted')?.text).toBe(off)
    expect(locationWords(true, null, 'off')).toEqual({
      text: 'Location Services is off on this Mac.',
      settings: true
    })
    expect(locationWords(true, null, 'granted')).toBeNull()
    expect(locationWords(true, null, null)).toBeNull()
    // While it's held, what it found now wins over an older answer.
    expect(locationWords(true, { status: 'found', name: null }, 'denied')).toBeNull()
  })
})
