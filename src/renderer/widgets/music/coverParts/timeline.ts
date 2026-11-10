// Where every moving part is at time t in the cover's loop: the shader and the spray pass both
// read their numbers from here, so the loop's seamlessness is tested once. Distances are in the
// 768 px analysis space; strength scales them (the user's pick, 1.5) but never the rhythm, as the
// quicker rhythms are the ones that made the user dizzy.

import { LOOP_SEC } from '../../../../main/services/cover-motion/recipe'
import { random } from '../coverLight'

const TAU = 2 * Math.PI

/** A swell out and back once per loop: 0 at the loop's start and end, all the way out halfway. */
function swell(t: number): number {
  return 0.5 - 0.5 * Math.cos((TAU * t) / LOOP_SEC)
}

/** How far a Surge part's far end is pushed, in px. */
export function surge(t: number, strength: number): number {
  return 16 * strength * swell(t)
}

/** Sway is Surge's gentler cousin, for hair, plants and ribbons. */
export function sway(t: number, strength: number): number {
  return 10 * strength * swell(t)
}

/** Flutter's reach; its phase (twice per loop) is per pixel, in the shader. */
export function flutterAmp(strength: number): number {
  return 2.5 * strength
}

/** Twinkle's phase: twice per loop, offset per pixel in the shader. */
export function twinkle(t: number): number {
  return (TAU * t) / (LOOP_SEC / 2)
}

const DRIFT_PERIOD = LOOP_SEC / 2

/**
 * A drifting part is drawn from two offsets, half a period apart, crossfaded so that each one's
 * jump back to 0 happens while it's fully faded out.
 */
export function drift(t: number, strength: number): { a: number; b: number; blend: number } {
  const ta = t % DRIFT_PERIOD
  const tb = (t + DRIFT_PERIOD / 2) % DRIFT_PERIOD
  return {
    a: 4 * strength * ta,
    b: 4 * strength * tb,
    blend: Math.abs((2 * ta) / DRIFT_PERIOD - 1)
  }
}

/** Each floating part's own rhythm (periods that divide the loop), so no two bob together. */
const BOBS = [
  { amp: 3, period: 4, phase: 0 },
  { amp: 2.5, period: LOOP_SEC / 3, phase: 1.3 },
  { amp: 2, period: 4, phase: 2.6 }
] as const

export function bob(t: number, strength: number, index: number): { lift: number; tiltDeg: number } {
  const base = BOBS[index % BOBS.length] ?? BOBS[0]
  const phase = base.phase + 0.7 * Math.floor(index / BOBS.length)
  const angle = (TAU * t) / base.period + phase
  return {
    lift: base.amp * strength * Math.sin(angle),
    tiltDeg: 0.8 * strength * Math.sin(angle + 0.9)
  }
}

export interface Drop {
  x: number
  y: number
  r: number
  alpha: number
}

const DROPS_PER_LOOP = 90
const GRAVITY = 55

/**
 * The spray drops in the air at time t: 90 a loop, each thrown from one of the part's emitters
 * the way the part moves (`move`, a unit vector; the editor's arrow turns it) with a toss
 * upward, then falling, fading in and out. The same seed always throws the same drops.
 */
export function sprayDrops(
  t: number,
  strength: number,
  emitters: readonly (readonly [number, number])[],
  seed: number,
  move: readonly [number, number] = [1, 0]
): Drop[] {
  if (emitters.length === 0) return []
  // Into the first loop before anything else, so the same moment in any loop is the same numbers.
  const at = ((t % LOOP_SEC) + LOOP_SEC) % LOOP_SEC
  const next = random(`spray:${seed}`)
  const drops: Drop[] = []
  for (let k = 0; k < DROPS_PER_LOOP; k++) {
    const born = (k * LOOP_SEC) / DROPS_PER_LOOP + next() * 0.08
    const [ex, ey] = emitters[Math.floor(next() * emitters.length)] ?? emitters[0] ?? [0, 0]
    const life = 1.4 + next() * 1.0
    // Out along the part's way, and always up a little first: turned left, spray still rises.
    const along = (35 + next() * 50) * strength
    const toss = (20 + next() * 50) * strength
    const vx = move[0] * along
    const vy = move[1] * along - toss
    const r = 1.1 + next() * 1.7
    const age = (at - born + LOOP_SEC) % LOOP_SEC
    if (age > life) continue
    const share = age / life
    const alpha = Math.min(1, age / 0.15) * (1 - Math.max(0, (share - 0.6) / 0.4))
    if (alpha <= 0) continue
    drops.push({
      x: ex + vx * age,
      y: ey + vy * age + 0.5 * GRAVITY * strength * age * age,
      r,
      alpha
    })
  }
  return drops
}
