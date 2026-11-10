import { describe, expect, it } from 'vitest'
import { fractionAt, keySeek } from './seekView'

describe('fractionAt', () => {
  // A 220 px bar from x = 100, with a 20 px resting knob: its centre runs from 110 to 310.
  it('follows the knob’s centre along the bar', () => {
    expect(fractionAt(110, 100, 220, 20)).toBe(0)
    expect(fractionAt(210, 100, 220, 20)).toBe(0.5)
    expect(fractionAt(310, 100, 220, 20)).toBe(1)
  })

  it('treats either end’s last stretch, and past it, as the very start or end', () => {
    expect(fractionAt(100, 100, 220, 20)).toBe(0)
    expect(fractionAt(40, 100, 220, 20)).toBe(0)
    expect(fractionAt(319, 100, 220, 20)).toBe(1)
    expect(fractionAt(900, 100, 220, 20)).toBe(1)
  })

  it('is the start on a bar too short to slide along', () => {
    expect(fractionAt(105, 100, 10, 20)).toBe(0)
  })
})

describe('keySeek', () => {
  it('moves 5 s with the arrows and 30 s a page, never past either end', () => {
    expect(keySeek('ArrowRight', 60, 200)).toBe(65)
    expect(keySeek('ArrowLeft', 60, 200)).toBe(55)
    expect(keySeek('ArrowUp', 198, 200)).toBe(200)
    expect(keySeek('ArrowDown', 2, 200)).toBe(0)
    expect(keySeek('PageUp', 60, 200)).toBe(90)
    expect(keySeek('PageDown', 20, 200)).toBe(0)
    expect(keySeek('Home', 60, 200)).toBe(0)
    expect(keySeek('End', 60, 200)).toBe(200)
  })

  it('leaves other keys alone', () => {
    expect(keySeek('Enter', 60, 200)).toBeNull()
    expect(keySeek(' ', 60, 200)).toBeNull()
  })
})
