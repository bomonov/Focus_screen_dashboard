import { describe, expect, it } from 'vitest'
import {
  createWheelSwipe,
  DRAG_TURN_PX,
  swipeOffset,
  turnFor,
  WHEEL_QUIET_MS,
  WHEEL_TURN_PX
} from './pillSwipe'

const ONLY_NEXT = { next: true, back: false }
const ONLY_BACK = { next: false, back: true }
const NEITHER = { next: false, back: false }

describe('swipeOffset', () => {
  it('follows the finger toward a page', () => {
    expect(swipeOffset(-30, ONLY_NEXT)).toBe(-30)
    expect(swipeOffset(30, ONLY_BACK)).toBe(30)
  })

  it('gives a little, less and less, where there is none', () => {
    const small = swipeOffset(-20, NEITHER)
    const large = swipeOffset(-400, NEITHER)
    expect(small).toBeLessThan(0)
    expect(small).toBeGreaterThan(-20)
    expect(large).toBeLessThan(small)
    expect(large).toBeGreaterThan(-24)
    expect(swipeOffset(40, ONLY_NEXT)).toBeCloseTo(-swipeOffset(-40, ONLY_BACK))
  })
})

describe('turnFor', () => {
  it('turns once far enough, and only toward a page', () => {
    expect(turnFor(-DRAG_TURN_PX + 1, ONLY_NEXT, DRAG_TURN_PX)).toBeNull()
    expect(turnFor(-DRAG_TURN_PX, ONLY_NEXT, DRAG_TURN_PX)).toBe('next')
    expect(turnFor(DRAG_TURN_PX, ONLY_NEXT, DRAG_TURN_PX)).toBeNull()
    expect(turnFor(DRAG_TURN_PX, ONLY_BACK, DRAG_TURN_PX)).toBe('back')
  })
})

describe('createWheelSwipe', () => {
  const BOTH = { next: true, back: true }
  /** Feeds deltas a frame (16 ms) apart from `from`; returns the turns and the time after. */
  function stream(
    swipe: ReturnType<typeof createWheelSwipe>,
    deltas: number[],
    from: number,
    can = BOTH
  ): { turns: string[]; at: number } {
    const turns: string[] = []
    let at = from
    for (const delta of deltas) {
      const step = swipe.feed(delta, 0, at, can)
      if (step?.turn) turns.push(step.turn)
      at += 16
    }
    return { turns, at }
  }
  /** A flick right to left: the fingers speed up, then macOS's momentum slows to a stop. */
  const flick = [4, 10, 18, 24, 22, 18, 14, 11, 9, 7, 5, 4, 3, 2, 2, 1, 1, 1]

  it('follows the fingers, then turns once per swipe', () => {
    const swipe = createWheelSwipe()
    // Fingers moving right to left scroll right: deltaX > 0.
    expect(swipe.feed(20, 0, 0, ONLY_NEXT)).toEqual({ offset: -20, turn: null })
    expect(swipe.feed(30, 1, 16, ONLY_NEXT)).toEqual({ offset: -50, turn: null })
    expect(swipe.feed(WHEEL_TURN_PX, 0, 32, ONLY_NEXT)).toEqual({ offset: 0, turn: 'next' })
    // The rest of it doesn't turn again, however far it goes.
    expect(swipe.feed(200, 0, 48, BOTH)).toEqual({ offset: 0, turn: null })
    expect(stream(swipe, flick.slice(4), 64).turns).toEqual([])
  })

  it('turns once for a flick and its momentum', () => {
    expect(stream(createWheelSwipe(), flick, 0).turns).toEqual(['next'])
  })

  it('takes the next flick at once, while the last one’s momentum is still going', () => {
    const swipe = createWheelSwipe()
    // The fingers touch down as the momentum tails off: no pause in the stream at all.
    const { at } = stream(swipe, flick.slice(0, 12), 0)
    expect(stream(swipe, flick, at).turns).toEqual(['next'])
  })

  it('swipes back and forth without waiting', () => {
    const swipe = createWheelSwipe()
    const { turns, at } = stream(swipe, flick.slice(0, 8), 0)
    const back = stream(
      swipe,
      flick.map((delta) => -delta),
      at
    )
    expect([...turns, ...back.turns]).toEqual(['next', 'back'])
  })

  it('doesn’t take a long swipe that keeps speeding up for two', () => {
    const swipe = createWheelSwipe()
    expect(
      stream(swipe, [3, 6, 10, 15, 20, 26, 32, 40, 48, 40, 30, 20, 10, 5, 2], 0).turns
    ).toEqual(['next'])
  })

  it('doesn’t take momentum events merged while the page was busy for a new swipe', () => {
    const swipe = createWheelSwipe()
    const { at } = stream(swipe, flick.slice(0, 10), 0)
    // Three frames' worth in one event, three frames late: the same speed as before.
    expect(swipe.feed(15, 0, at + 32, BOTH)).toEqual({ offset: 0, turn: null })
    expect(stream(swipe, [4, 3, 2, 2, 1], at + 48).turns).toEqual([])
  })

  it('starts afresh after a pause', () => {
    const swipe = createWheelSwipe()
    expect(swipe.feed(-WHEEL_TURN_PX, 0, 0, ONLY_BACK)).toEqual({ offset: 0, turn: 'back' })
    const later = WHEEL_QUIET_MS + 1
    expect(swipe.feed(-WHEEL_TURN_PX, 0, later, ONLY_BACK)).toEqual({ offset: 0, turn: 'back' })
  })

  it('leaves up-and-down scrolling alone', () => {
    const swipe = createWheelSwipe()
    expect(swipe.feed(4, 30, 0, ONLY_NEXT)).toBeNull()
    expect(swipe.feed(-20, 40, 16, ONLY_NEXT)).toBeNull()
    expect(swipe.feed(10, 0, 32, ONLY_NEXT)).toEqual({ offset: -10, turn: null })
  })

  it('pulls against the end when there is no page that way', () => {
    const swipe = createWheelSwipe()
    const step = swipe.feed(WHEEL_TURN_PX * 2, 0, 0, ONLY_BACK)
    expect(step?.turn).toBeNull()
    expect(step?.offset).toBeLessThan(0)
    expect(step?.offset).toBeGreaterThan(-24)
  })
})
