// Spring motion for the tab bar's lens, after iOS: it follows the pointer, stretches with its
// speed, and springs into place with a little bounce when let go.

export interface Spring {
  value: number
  velocity: number
}

/** `response`: seconds to get most of the way there; `damping`: 1 = no bounce, lower = some. */
export interface SpringConfig {
  response: number
  damping: number
}

/** While dragging: right behind the pointer, no wobble. */
export const FOLLOW: SpringConfig = { response: 0.16, damping: 1 }
/** Into place after a pick or a drop: quick, with a small overshoot. */
export const SETTLE: SpringConfig = { response: 0.38, damping: 0.72 }
/** Lifting off the bar when pressed, and sinking back. */
export const LIFT: SpringConfig = { response: 0.28, damping: 0.62 }

/** Steps small enough to stay stable whatever the frame rate. */
const MAX_STEP_SEC = 1 / 240

/** Advances a spring toward `target` by `dt` seconds (unit mass, semi-implicit Euler). */
export function stepSpring(
  spring: Spring,
  target: number,
  config: SpringConfig,
  dt: number
): Spring {
  const stiffness = ((2 * Math.PI) / config.response) ** 2
  const friction = (4 * Math.PI * config.damping) / config.response
  let { value, velocity } = spring
  let left = Math.min(Math.max(dt, 0), 0.1)
  while (left > 0) {
    const step = Math.min(left, MAX_STEP_SEC)
    velocity += (-stiffness * (value - target) - friction * velocity) * step
    value += velocity * step
    left -= step
  }
  return { value, velocity }
}

/**
 * A spring as a CSS `linear()` easing, so a plain transition or a Web Animation moves (and
 * overshoots) like one, off the main thread. `durationSec` should give it time to settle.
 */
export function springEasing(config: SpringConfig, durationSec: number, samples = 48): string {
  let spring: Spring = { value: 0, velocity: 0 }
  const points = ['0']
  for (let i = 1; i < samples; i++) {
    spring = stepSpring(spring, 1, config, durationSec / samples)
    points.push(String(Math.round(spring.value * 1000) / 1000))
  }
  points.push('1')
  return `linear(${points.join(', ')})`
}

/** Close enough to stop animating: within `epsilon` and barely moving. */
export function atRest(spring: Spring, target: number, epsilon: number): boolean {
  return Math.abs(spring.value - target) < epsilon && Math.abs(spring.velocity) < epsilon * 10
}

/**
 * The lens's squash and stretch at a horizontal speed (px/s): longer along the way it's going,
 * a little shorter across, like a drop of liquid. At most 16% longer.
 */
export function stretchFor(speed: number): { x: number; y: number } {
  const amount = Math.min(Math.abs(speed) / 6000, 0.16)
  return { x: 1 + amount, y: 1 - amount * 0.45 }
}
