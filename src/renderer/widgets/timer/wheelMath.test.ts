import { describe, expect, it } from 'vitest'
import {
  nudge,
  scrollValues,
  SCROLL_PX_PER_VALUE,
  shownOffset,
  firmTick,
  stepWheel,
  takesWheel,
  turnWheel,
  typeDigit,
  type ScrollGesture
} from './wheelMath'

describe('stepWheel', () => {
  it('steps and wraps round, without carrying into the next wheel', () => {
    expect(stepWheel(25, 1, 59)).toBe(26)
    expect(stepWheel(59, 1, 59)).toBe(0)
    expect(stepWheel(0, -1, 59)).toBe(59)
    expect(stepWheel(23, 1, 23)).toBe(0)
    expect(stepWheel(5, -10, 59)).toBe(55)
    expect(stepWheel(3, 130, 59)).toBe(13)
  })
})

/** Feeds wheel events through, as a trackpad sends them, and adds up how far the wheel turns. */
function feed(deltas: readonly number[], everyMs = 8, mode = 0): number {
  let gesture: ScrollGesture | null = null
  let total = 0
  deltas.forEach((delta, i) => {
    const result = scrollValues(gesture, delta, mode, i * everyMs)
    gesture = result.gesture
    total += result.values
  })
  return total
}

const steady = (px: number, events: number): number[] => Array.from({ length: events }, () => px)
/** Small, repeatable unevenness, as fingers never move quite steadily. */
const uneven = (px: number, events: number, spread: number): number[] =>
  Array.from(
    { length: events },
    (_, i) => Math.round(px * (1 + spread * Math.sin(i * 2.4)) * 10) / 10
  )
/** macOS's glide after the fingers lift: about a second of shrinking, rounded, repeated deltas. */
const glide = (from: number, events: number, tauMs = 500): number[] =>
  Array.from({ length: events }, (_, i) =>
    Math.max(1, Math.round(from * Math.exp((-i * 8) / tauMs)))
  )

describe('scrollValues', () => {
  it('follows a slow, deliberate scroll evenly: 40 px a value', () => {
    expect(feed(steady(4, 90))).toBeCloseTo((4 * 90) / SCROLL_PX_PER_VALUE, 5)
  })

  it('isn’t thrown by fingers that move a little unevenly', () => {
    const even = feed(steady(4, 90))
    expect(feed(uneven(4, 90, 0.2))).toBeGreaterThan(even * 0.9)
    expect(feed(uneven(4, 90, 0.2))).toBeLessThan(even * 1.1)
  })

  it('turns slower than the fingers when they move fast', () => {
    expect(feed(steady(20, 40))).toBeLessThan(feed(steady(4, 200)) * 0.6)
  })

  it('lets a hard flick move several values, not spin the wheel round', () => {
    const values = feed([6, 14, 28, 40, ...glide(45, 150)])
    expect(values).toBeGreaterThan(3)
    expect(values).toBeLessThan(8)
  })

  it('lets a gentle flick move a couple', () => {
    const values = feed([4, 8, 12, 16, ...glide(16, 150)])
    expect(values).toBeGreaterThan(1)
    expect(values).toBeLessThan(5)
  })

  it('counts again when the fingers push on through the glide', () => {
    const flick = [6, 14, 28, 40, ...glide(45, 40)]
    expect(feed([...flick, ...steady(30, 20)]) - feed(flick)).toBeGreaterThan(2)
  })

  it('starts a new scroll after a pause, or the other way', () => {
    let gesture: ScrollGesture | null = null
    const at = (delta: number, ms: number): number => {
      const result = scrollValues(gesture, delta, 0, ms)
      gesture = result.gesture
      return result.gesture?.values ?? 0
    }
    const first = at(40, 0)
    // Not added to the first: a scroll of its own.
    expect(at(40, 400)).toBeCloseTo(first, 5)
    expect(at(-40, 410)).toBeLessThan(0)
  })

  it('takes a mouse wheel’s lines or pages as one value each', () => {
    expect(scrollValues(null, 3, 1, 0).values).toBe(1)
    expect(scrollValues(null, -1, 2, 0).values).toBe(-1)
  })
})

describe('nudge', () => {
  it('turns one value for a scroll too small to reach the next, so a notch always counts', () => {
    expect(nudge(0.1, 0)).toBe(1)
    expect(nudge(-0.3, 0)).toBe(-1)
  })

  it('leaves a scroll that already turned a value, or barely touched the pad, alone', () => {
    expect(nudge(1.3, 1)).toBe(0)
    expect(nudge(0.01, 0)).toBe(0)
  })
})

describe('takesWheel', () => {
  it('turns the card’s wheels whenever the pointer is over them', () => {
    expect(takesWheel('card', false)).toBe(true)
  })

  it('leaves the Customize page scrolling past a box that isn’t being used', () => {
    expect(takesWheel('row', false)).toBe(false)
    expect(takesWheel('row', true)).toBe(true)
  })
})

describe('typeDigit', () => {
  it('takes two digits typed quickly as one number', () => {
    const first = typeDigit('', 1, 59, Infinity)
    expect(first).toEqual({ value: 1, typed: '1' })
    expect(typeDigit(first.typed, 5, 59, 0.4)).toEqual({ value: 15, typed: '' })
  })

  it('starts over when the second digit comes slowly', () => {
    expect(typeDigit('1', 5, 59, 1.5)).toEqual({ value: 5, typed: '5' })
  })

  it('starts over when the two digits would go past the wheel', () => {
    expect(typeDigit('2', 5, 23, 0.2)).toEqual({ value: 5, typed: '' })
    expect(typeDigit('1', 7, 12, 0.2)).toEqual({ value: 7, typed: '' })
  })

  it('doesn’t wait for a second digit that could never fit', () => {
    expect(typeDigit('', 7, 23, Infinity)).toEqual({ value: 7, typed: '' })
    expect(typeDigit('', 6, 59, Infinity)).toEqual({ value: 6, typed: '' })
  })
})

describe('the detent at zero', () => {
  /** How far a scroll has to turn a wheel resting on `from` before it shows the next value. */
  function toLeave(from: number, way: 1 | -1, max = 59): number {
    for (let turned = 0.01; turned < 2; turned += 0.01) {
      if (turnWheel(from, 0, way * turned, max).value !== from) return turned
    }
    return Infinity
  }

  it('holds a wheel on zero a little longer than on any other number', () => {
    expect(toLeave(7, 1)).toBeCloseTo(0.5, 1)
    expect(toLeave(0, 1)).toBeGreaterThan(toLeave(7, 1) * 1.3)
    expect(toLeave(0, -1)).toBeGreaterThan(toLeave(7, 1) * 1.3)
  })

  it('never stops it: a steady scroll always gets past', () => {
    expect(toLeave(0, 1)).toBeLessThan(1)
    expect(toLeave(0, -1, 23)).toBeLessThan(1)
  })

  it('draws the numbers round zero held back, and the rest as scrolled', () => {
    expect(shownOffset(0, 59, 0.3)).toBeLessThan(0.3)
    expect(shownOffset(0, 59, 0.3)).toBeGreaterThan(0)
    expect(shownOffset(12, 59, 0.3)).toBe(0.3)
  })

  it('pulls a wheel coming back onto zero, from either side', () => {
    expect(turnWheel(1, 0, -0.35, 59).value).toBe(0)
    expect(turnWheel(59, 0, 0.35, 59).value).toBe(0)
    expect(turnWheel(2, 0, -0.35, 59).value).toBe(2)
  })

  it('says when a turn lands on zero, for the trackpad’s tick', () => {
    expect(turnWheel(1, 0, -0.6, 59).landedOnZero).toBe(1)
    expect(turnWheel(58, 0, 3, 59).landedOnZero).toBe(1)
    expect(turnWheel(5, 0, 1, 59).landedOnZero).toBe(0)
  })

  it('doesn’t jump as it lets go: the drawn place is the same either side of the change', () => {
    for (const delta of [0.72, 0.8, 1.1, -0.72, -0.9]) {
      const before = 0 + shownOffset(0, 59, delta - Math.sign(delta) * 0.0001)
      const turned = turnWheel(0, 0, delta, 59)
      const base = turned.value === 59 ? -1 : turned.value
      expect(base + shownOffset(turned.value, 59, turned.offset)).toBeCloseTo(before, 2)
    }
  })
})

describe('firmTick', () => {
  it('gives a wheel coming onto zero fast the firmer tick, which a quick scroll would miss', () => {
    expect(firmTick(0.3)).toBe(false)
    expect(firmTick(1.5)).toBe(true)
  })
})
