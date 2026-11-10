import { describe, expect, it } from 'vitest'
import { lensTarget } from './tabBarView'

// "Pomodoro" chosen (wide, with its name) and two icon-only tabs.
const TABS = [
  { left: 4, width: 150 },
  { left: 158, width: 48 },
  { left: 210, width: 48 }
]

describe('lensTarget', () => {
  it('picks the tab under the lens’s center', () => {
    expect(lensTarget(TABS, 60)).toBe(0)
    expect(lensTarget(TABS, 180)).toBe(1)
    expect(lensTarget(TABS, 250)).toBe(2)
  })

  it('picks the nearest tab from a gap or past either end', () => {
    expect(lensTarget(TABS, 156)).toBe(0)
    expect(lensTarget(TABS, 208.5)).toBe(2)
    expect(lensTarget(TABS, -20)).toBe(0)
    expect(lensTarget(TABS, 400)).toBe(2)
  })

  it('falls back to the first tab when there are none to measure', () => {
    expect(lensTarget([], 100)).toBe(0)
  })
})
