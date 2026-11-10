import { describe, expect, it } from 'vitest'
import { movedFar, roundPosition } from './position'

describe('roundPosition', () => {
  it('keeps two decimals, about a kilometre', () => {
    expect(roundPosition({ lat: 33.42456, lon: -111.93349 })).toEqual({ lat: 33.42, lon: -111.93 })
  })
})

describe('movedFar', () => {
  const here = { lat: 33.42, lon: -111.93 }

  it('counts no place yet as far', () => {
    expect(movedFar(null, here)).toBe(true)
  })

  it('needs a kilometre or more', () => {
    // 0.01° of longitude here is about 930 m.
    expect(movedFar(here, { lat: 33.42, lon: -111.94 })).toBe(false)
    expect(movedFar(here, { lat: 33.43, lon: -111.94 })).toBe(true)
  })
})
