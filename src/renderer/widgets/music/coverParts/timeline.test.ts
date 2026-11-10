import { describe, expect, it } from 'vitest'
import { bob, drift, sprayDrops, surge, sway, type Drop } from './timeline'

const close = (a: number, b: number): void => expect(a).toBeCloseTo(b, 6)

it('loops without a seam', () => {
  close(surge(0, 1.5), surge(8, 1.5))
  close(sway(0.3, 1), sway(8.3, 1))
  close(bob(1.1, 1.5, 1).lift, bob(9.1, 1.5, 1).lift)
  const d0 = drift(0.5, 1.5)
  const d8 = drift(8.5, 1.5)
  close(d0.a, d8.a)
  close(d0.blend, d8.blend)
  expect(sprayDrops(2, 1.5, [[400, 200]], 7)).toEqual(sprayDrops(10, 1.5, [[400, 200]], 7))
})

it('scales distance with strength, never the rhythm', () => {
  close(surge(4, 1.5), 24)
  close(surge(4, 1), 16)
  close(surge(2, 1.5) / surge(2, 1), 1.5)
  expect(drift(1, 1.5).blend).toBe(drift(1, 1).blend)
})

describe('spray', () => {
  it('throws drops only from emitters', () => {
    expect(sprayDrops(3, 1.5, [], 1)).toEqual([])
  })

  it('keeps every drop fading in and out', () => {
    const drops = sprayDrops(3, 1.5, [[400, 200]], 1)
    expect(drops.length).toBeGreaterThan(0)
    for (const d of drops) {
      expect(d.alpha).toBeGreaterThan(0)
      expect(d.alpha).toBeLessThanOrEqual(1)
    }
  })
})

describe('spray direction', () => {
  const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length
  const flying = (move: [number, number]): Drop[] => sprayDrops(1.2, 1.5, [[400, 400]], 3, move)

  it('throws drops the way the part moves, and the arrow turns them', () => {
    expect(mean(flying([1, 0]).map((d) => d.x))).toBeGreaterThan(400)
    expect(mean(flying([-1, 0]).map((d) => d.x))).toBeLessThan(400)
  })

  it('throws them up from a part that moves up, sideways only a little', () => {
    const up = flying([0, -1])
    expect(mean(up.map((d) => d.y))).toBeLessThan(400)
    expect(Math.abs(mean(up.map((d) => d.x)) - 400)).toBeLessThan(5)
  })
})
