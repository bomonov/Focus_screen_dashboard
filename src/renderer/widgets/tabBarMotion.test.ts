import { describe, expect, it } from 'vitest'
import { atRest, FOLLOW, SETTLE, stepSpring, stretchFor, type Spring } from './tabBarMotion'

function run(config: typeof SETTLE, from: number, to: number, seconds: number): Spring[] {
  const frames: Spring[] = []
  let spring: Spring = { value: from, velocity: 0 }
  for (let t = 0; t < seconds; t += 1 / 60) {
    spring = stepSpring(spring, to, config, 1 / 60)
    frames.push(spring)
  }
  return frames
}

describe('stepSpring', () => {
  it('gets there and stops', () => {
    const frames = run(SETTLE, 0, 100, 1.5)
    const last = frames[frames.length - 1]
    expect(last?.value).toBeCloseTo(100, 0)
    expect(last && atRest(last, 100, 0.5)).toBe(true)
  })

  it('overshoots a little when settling, never when following', () => {
    const settle = Math.max(...run(SETTLE, 0, 100, 1.5).map((s) => s.value))
    const follow = Math.max(...run(FOLLOW, 0, 100, 1.5).map((s) => s.value))
    expect(settle).toBeGreaterThan(100.5)
    expect(settle).toBeLessThan(115)
    expect(follow).toBeLessThan(100.5)
  })

  it('moves the same over a second however the frames fall', () => {
    let fine: Spring = { value: 0, velocity: 0 }
    for (let i = 0; i < 120; i++) fine = stepSpring(fine, 100, SETTLE, 1 / 120)
    let coarse: Spring = { value: 0, velocity: 0 }
    for (let i = 0; i < 30; i++) coarse = stepSpring(coarse, 100, SETTLE, 1 / 30)
    expect(coarse.value).toBeCloseTo(fine.value, 0)
  })

  it('treats a long pause as a short one rather than jumping wildly', () => {
    const after = stepSpring({ value: 0, velocity: 0 }, 100, SETTLE, 5)
    expect(Math.abs(after.value)).toBeLessThan(200)
  })
})

describe('stretchFor', () => {
  it('stays round at rest and stretches with speed, up to a limit', () => {
    expect(stretchFor(0)).toEqual({ x: 1, y: 1 })
    expect(stretchFor(-600)).toEqual({ x: 1.1, y: 1 - 0.1 * 0.45 })
    expect(stretchFor(1e6).x).toBeCloseTo(1.16)
    expect(stretchFor(1e6).y).toBeLessThan(1)
  })
})
