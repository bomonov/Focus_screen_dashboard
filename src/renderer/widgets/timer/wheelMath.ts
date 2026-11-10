// How the hours, minutes and seconds wheels turn: pure, so the feel can be tested.

/** A slow, deliberate scroll this far turns a wheel one value. */
export const SCROLL_PX_PER_VALUE = 40

/** One step up or down, wrapping round within 0..max without carrying into the next wheel. */
export function stepWheel(value: number, delta: number, max: number): number {
  const size = max + 1
  return (((value + delta) % size) + size) % size
}

/** Wheel events further apart than this start a new scroll. */
const GESTURE_GAP_MS = 140
/** Up to this speed (px/ms) a scroll is followed one to one; past it, only FAST_KEEP of the rest. */
const FAST_PX_PER_MS = 0.6
const FAST_KEEP = 0.3
/** How quickly (ms) the speed's running average follows the events. */
const SPEED_EASE_MS = 12
/** Only a scroll this fast at its peak (px/ms) is a flick with a glide to damp. */
const FLICK_PX_PER_MS = 1.2
/** The glide: the speed has fallen for this long (ms), to under this share of its peak. */
const GLIDE_AFTER_MS = 32
const GLIDE_BELOW_PEAK = 0.9
/** In the glide, scrolling counts this much, and at most this many values in all. */
const GLIDE_KEEP = 0.25
const MAX_GLIDE_VALUES = 1.5
/**
 * The fingers again, not the glide: an event this much faster than the running average, or
 * PUSH_AFTER_MS of events faster than it (a glide only ever slows).
 */
const PUSH = 1.4
const PUSH_AFTER_MS = 24

/** One scroll on a wheel, from its first event until a pause or a turn the other way. */
export interface ScrollGesture {
  at: number
  sign: number
  /**
   * Running average of the speed (px/ms), its peak, how long (ms) it's been falling, and how
   * long events have been coming in faster than it. Times, not counts, so a 60 Hz screen and a
   * 120 Hz one feel the same.
   */
  speed: number
  peak: number
  falling: number
  rising: number
  /** In macOS's glide after a flick, which is damped. */
  glide: boolean
  glideValues: number
  /** How far this scroll has turned the wheel, in values. */
  values: number
}

/**
 * How far one wheel event turns a wheel, in values (fractional: the wheel glides with the
 * fingers and settles on a value once they stop). A slow scroll is followed evenly, one value
 * per SCROLL_PX_PER_VALUE; a fast one less than its distance. After a flick macOS keeps sending
 * a second or more of shrinking "glide" events, which would spin the wheel round: once a fast
 * scroll's speed has been falling for GLIDE_AFTER_MS, the rest counts for little and stops
 * after MAX_GLIDE_VALUES, until the fingers push on. Line or page scrolling (a notched mouse
 * elsewhere) is one value per event.
 */
export function scrollValues(
  gesture: ScrollGesture | null,
  deltaPx: number,
  deltaMode: number,
  atMs: number
): { values: number; gesture: ScrollGesture | null } {
  if (deltaMode !== 0) return { values: Math.sign(deltaPx), gesture: null }
  const sign = Math.sign(deltaPx)
  const abs = Math.abs(deltaPx)
  if (sign === 0) return { values: 0, gesture }
  const fresh = !gesture || atMs - gesture.at > GESTURE_GAP_MS || sign !== gesture.sign
  // The first event of a scroll has no time before it: take it as one frame's worth.
  const dt = fresh || !gesture ? 16 : Math.min(32, Math.max(4, atMs - gesture.at))
  const speed = abs / dt
  const kept =
    speed <= FAST_PX_PER_MS ? speed : FAST_PX_PER_MS + (speed - FAST_PX_PER_MS) * FAST_KEEP
  const turned = (kept * dt) / SCROLL_PX_PER_VALUE

  const before: ScrollGesture =
    fresh || !gesture
      ? {
          at: atMs,
          sign,
          speed,
          peak: speed,
          falling: 0,
          rising: 0,
          glide: false,
          glideValues: 0,
          values: 0
        }
      : gesture
  const ease = 1 - Math.exp(-dt / SPEED_EASE_MS)
  const average = fresh ? speed : before.speed + (speed - before.speed) * ease
  const falling = !fresh && average < before.speed ? before.falling + dt : 0
  const peak = Math.max(before.peak, average)
  const rising = !fresh && speed > before.speed ? before.rising + dt : 0
  const pushed = speed > before.speed * PUSH || rising >= PUSH_AFTER_MS
  const glide = before.glide
    ? !pushed
    : peak >= FLICK_PX_PER_MS && falling >= GLIDE_AFTER_MS && average < peak * GLIDE_BELOW_PEAK
  let values = turned
  let glideValues = glide ? before.glideValues : 0
  if (glide) {
    values = Math.min(turned * GLIDE_KEEP, Math.max(0, MAX_GLIDE_VALUES - glideValues))
    glideValues += values
  }
  return {
    values: sign * values,
    gesture: {
      at: atMs,
      sign,
      speed: average,
      // A push starts its own peak, so its own glide is judged afresh.
      peak: pushed ? average : peak,
      falling: pushed ? 0 : falling,
      rising: pushed ? 0 : rising,
      glide,
      glideValues,
      values: before.values + sign * values
    }
  }
}

/**
 * A scroll that ended without turning the wheel to the next value still turns it one, so a single
 * mouse notch or a short nudge on the pad always counts; a bare touch (under NUDGE_FROM) doesn't.
 */
const NUDGE_FROM = 0.04
export function nudge(scrolledValues: number, committed: number): number {
  return committed === 0 && Math.abs(scrolledValues) >= NUDGE_FROM ? Math.sign(scrolledValues) : 0
}

/**
 * The detent at zero (the user asked for "a checkpoint" there, 2026-10-26): within one value of
 * 0 the wheel is drawn held back, as |x|^DETENT_POWER of how far it's turned, so leaving 0 takes
 * about 40% more scrolling and coming back onto it a bit less, as a click-stop does. It never
 * stops a scroll: past one value away it moves as turned again.
 */
const DETENT_POWER = 2

/** Where to draw a wheel resting on `value` turned `offset` values past it (zero's detent). */
export function shownOffset(value: number, max: number, offset: number): number {
  const base = value === 0 ? 0 : value === 1 ? 1 : value === max ? -1 : null
  if (base === null) return offset
  const x = base + offset
  if (Math.abs(x) >= 1) return offset
  return Math.sign(x) * Math.abs(x) ** DETENT_POWER - base
}

/**
 * A wheel resting on `value`, `offset` past it, turned `delta` more: the value changes as each
 * drawn number passes the middle. `steps` is how many values it moved (+ up, − down), and
 * `landedOnZero` the times it came onto 0 (the trackpad's tick).
 */
export function turnWheel(
  value: number,
  offset: number,
  delta: number,
  max: number
): { value: number; offset: number; steps: number; landedOnZero: number } {
  let now = value
  let past = offset + delta
  let steps = 0
  let landedOnZero = 0
  // Strictly past the middle, so the change never flips straight back at the detent's edge.
  for (let guard = 0; guard < 10_000; guard++) {
    const shown = shownOffset(now, max, past)
    if (shown > 0.5) {
      now = stepWheel(now, 1, max)
      past -= 1
      steps++
    } else if (shown < -0.5) {
      now = stepWheel(now, -1, max)
      past += 1
      steps--
    } else break
    if (now === 0) landedOnZero++
  }
  return { value: now, offset: past, steps, landedOnZero }
}

/**
 * From this speed (px/ms) a wheel coming onto 0 gets the trackpad's firmer tick: at a quick
 * scroll the light one is easy to miss (the user found it so, 2026-10-26).
 */
const FIRM_TICK_PX_PER_MS = 0.7
export function firmTick(speedPxPerMs: number): boolean {
  return speedPxPerMs >= FIRM_TICK_PX_PER_MS
}

/**
 * Whether a wheel takes a scroll. The card's always do; a box in Customize only once it's being
 * used (focused, by a click or Tab), so scrolling the page past it never changes a length.
 */
export function takesWheel(size: 'card' | 'row', focused: boolean): boolean {
  return size === 'card' || focused
}

/** A second digit typed within this long makes a two-digit number with the first. */
const SECOND_DIGIT_SEC = 1

/**
 * A digit typed on a wheel: with the one before it, if it came quickly and the two fit
 * (1 then 5 is 15); otherwise on its own. `typed` is kept only while another digit could follow.
 */
export function typeDigit(
  typed: string,
  digit: number,
  max: number,
  sinceLastSec: number
): { value: number; typed: string } {
  if (typed !== '' && sinceLastSec < SECOND_DIGIT_SEC) {
    const both = Number(typed + String(digit))
    if (both <= max) return { value: both, typed: '' }
  }
  return { value: Math.min(digit, max), typed: digit * 10 <= max ? String(digit) : '' }
}
