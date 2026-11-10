import { describe, expect, it } from 'vitest'
import { DOUBLE_MS, pressStart } from './pressStart'

const LIST = { disabled: false }
const LIST_AT_ONCE = { disabled: false, atOnce: true }

describe('pressStart', () => {
  it('starts a hold for a press long after the last click', () => {
    expect(pressStart(Infinity, false, LIST_AT_ONCE)).toBe('hold')
    expect(pressStart(DOUBLE_MS, false, LIST_AT_ONCE)).toBe('hold')
  })

  it('opens the second card at once on a double-click’s second press (the class list)', () => {
    expect(pressStart(250, false, LIST_AT_ONCE)).toBe('double')
  })

  it('waits for a double press’s second press to be held (the Bus list)', () => {
    expect(pressStart(250, false, LIST)).toBe('double-held')
  })

  it('opens the second card even when the pill has nothing to hold for', () => {
    expect(pressStart(250, true, LIST_AT_ONCE)).toBe('double')
  })

  it('treats a quick second press as a plain hold when there’s no second card', () => {
    expect(pressStart(250, false, undefined)).toBe('hold')
    expect(pressStart(250, false, { disabled: true, atOnce: true })).toBe('hold')
  })

  it('starts nothing with nothing to hold for and no double press', () => {
    expect(pressStart(Infinity, true, LIST_AT_ONCE)).toBe('none')
    expect(pressStart(250, true, { disabled: true })).toBe('none')
  })
})
