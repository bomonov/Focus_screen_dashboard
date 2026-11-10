import { describe, expect, it } from 'vitest'
import { atRest, stepSpring, type Spring } from '../tabBarMotion'
import {
  CLOSE,
  GONE,
  menuFrame,
  OPEN_ACROSS,
  OPEN_DOWN,
  menuTop,
  originCss,
  placeMenu,
  START_SCALE,
  unfoldFrame
} from './cardMenuMotion'

describe('menuFrame', () => {
  it('starts as a faint dot and ends as the full, sharp menu', () => {
    const start = menuFrame(0, 0)
    expect(start.scaleX).toBe(START_SCALE)
    expect(start.opacity).toBe(0)
    expect(start.contentOpacity).toBe(0)
    expect(start.contentBlur).toBeGreaterThan(0)
    const open = menuFrame(1, 1)
    expect(open).toEqual({
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      contentOpacity: 1,
      contentBlur: 0,
      scrim: 1
    })
  })

  it('shows the glass before its words', () => {
    const early = menuFrame(0.15, 0.15)
    expect(early.opacity).toBeGreaterThan(0.4)
    expect(early.contentOpacity).toBeLessThan(0.2)
    // …but its words are there, sharp, by halfway: any later reads as a slow menu.
    const half = menuFrame(0.6, 0.6)
    expect(half.contentOpacity).toBe(1)
    expect(half.contentBlur).toBe(0)
  })

  it('keeps an overshoot as a little extra size, never extra opacity', () => {
    const over = menuFrame(1.03, 1.02)
    expect(over.scaleX).toBeGreaterThan(1)
    expect(over.opacity).toBe(1)
    expect(over.contentOpacity).toBe(1)
    expect(over.contentBlur).toBe(0)
  })
})

describe('the open and close springs', () => {
  function run(
    from: Spring,
    target: number,
    config: typeof CLOSE,
    seconds: number
  ): { spring: Spring; peak: number } {
    let spring = from
    let peak = from.value
    for (let t = 0; t < seconds; t += 1 / 120) {
      spring = stepSpring(spring, target, config, 1 / 120)
      peak = Math.max(peak, spring.value)
    }
    return { spring, peak }
  }

  it('spreads across before it drops, then settles with a small overshoot', () => {
    const across = run({ value: 0, velocity: 0 }, 1, OPEN_ACROSS, 0.06).spring.value
    const down = run({ value: 0, velocity: 0 }, 1, OPEN_DOWN, 0.06).spring.value
    expect(across).toBeGreaterThan(down)
    const { spring, peak } = run({ value: 0, velocity: 0 }, 1, OPEN_DOWN, 1)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThan(1.04)
    expect(atRest(spring, 1, 0.002)).toBe(true)
  })

  it('closes into the dot within a fifth of a second, without bouncing back out', () => {
    const { spring, peak } = run({ value: 1, velocity: 0 }, 0, CLOSE, 0.2)
    expect(peak).toBe(1)
    expect(spring.value).toBeLessThan(GONE * 2)
    expect(menuFrame(spring.value, spring.value).opacity).toBeLessThan(0.1)
  })
})

describe('unfoldFrame', () => {
  it('fades the rows in as the room opens', () => {
    expect(unfoldFrame(0)).toEqual({ opacity: 0, shift: -0.5 })
    expect(unfoldFrame(1)).toEqual({ opacity: 1, shift: -0 })
    expect(unfoldFrame(0.5).opacity).toBeGreaterThan(0)
  })
})

describe('placeMenu', () => {
  const view = { width: 1920, height: 1080 }
  const dot = { left: 1860, top: 100, right: 1884, bottom: 124 }

  it('hangs under the dot with its right edge under the dot’s', () => {
    const place = placeMenu(dot, { width: 400, height: 500 }, view, 8, 16)
    expect(place).toEqual({
      left: 1484,
      down: true,
      edge: 132,
      dot: { x: 1872, y: 112 },
      maxHeight: 1048
    })
    expect(menuTop(place, 500, 1080, 16)).toBe(132)
    // The dot's centre: 388 px in from the panel's left, 20 px above its top.
    expect(originCss(place, 132)).toBe('388px -20px')
  })

  it('stands above the dot when there’s no room below and more above', () => {
    const low = { left: 1860, top: 800, right: 1884, bottom: 824 }
    const place = placeMenu(low, { width: 400, height: 500 }, view, 8, 16)
    expect(place.down).toBe(false)
    expect(place.edge).toBe(792)
    expect(menuTop(place, 500, 1080, 16)).toBe(292)
    expect(originCss(place, 292)).toBe('388px 520px')
  })

  it('stays under the dot when neither side fits but below has more room', () => {
    const place = placeMenu(dot, { width: 400, height: 2000 }, view, 8, 16)
    expect(place.down).toBe(true)
  })

  it('slides up to stay on screen as it grows near the bottom, over the dot if need be', () => {
    const mid = { left: 1860, top: 540, right: 1884, bottom: 564 }
    const place = placeMenu(mid, { width: 400, height: 400 }, view, 8, 16)
    expect(place.down).toBe(true)
    expect(menuTop(place, 400, 1080, 16)).toBe(572)
    expect(menuTop(place, 700, 1080, 16)).toBe(364)
    // Taller than the window: its top stays at the margin and its rows scroll.
    expect(menuTop(place, 1100, 1080, 16)).toBe(16)
  })

  it('slides down to stay on screen when it grows upward past the top', () => {
    const low = { left: 1860, top: 800, right: 1884, bottom: 824 }
    const place = placeMenu(low, { width: 400, height: 500 }, view, 8, 16)
    expect(menuTop(place, 900, 1080, 16)).toBe(16)
  })

  it('opens to the right of the pointer, and to its left near the right edge', () => {
    const at = (x: number, y: number): typeof dot => ({ left: x, top: y, right: x, bottom: y })
    const place = placeMenu(at(600, 300), { width: 400, height: 500 }, view, 0, 16, 'pointer')
    expect(place.left).toBe(600)
    expect(place.edge).toBe(300)
    expect(place.dot).toEqual({ x: 600, y: 300 })
    expect(originCss(place, 300)).toBe('0px 0px')
    const flipped = placeMenu(at(1700, 300), { width: 400, height: 500 }, view, 0, 16, 'pointer')
    expect(flipped.left).toBe(1300)
    // Growing out of the pointer from the menu's top-right corner.
    expect(originCss(flipped, 300)).toBe('400px 0px')
  })

  it('stands above the pointer near the bottom, like a Mac context menu', () => {
    const low = { left: 600, top: 900, right: 600, bottom: 900 }
    const place = placeMenu(low, { width: 400, height: 500 }, view, 0, 16, 'pointer')
    expect(place.down).toBe(false)
    expect(menuTop(place, 500, 1080, 16)).toBe(400)
  })

  it('keeps on screen near the left edge', () => {
    const near = { left: 100, top: 100, right: 124, bottom: 124 }
    const place = placeMenu(near, { width: 400, height: 300 }, view, 8, 16)
    expect(place.left).toBe(16)
    expect(originCss(place, 132)).toBe('96px -20px')
  })
})
