// The animated cover's light. Its picture never moves: the first animated cover warped and swayed
// the whole picture in loops of 6–8 s and made the user dizzy. Visually induced motion sickness
// peaks at about 0.1–0.4 Hz (2.5–10 s a cycle), and whole-picture warping, zoom and sway are the
// usual vestibular triggers. So the cover stays put, as album motion keeps its frame, and life
// comes from light: a glow of its colors that shifts over most of a minute, a glint now and then,
// and a few slow specks.

import { glowShade } from '../../theme/color'

/** The glow's two arrangements cross over this long each way: far slower than the 2.5–10 s band. */
export const GLOW_SHIFT_MS = 24_000

/** A glint of light crosses the cover in this long, once every SHEEN_EVERY_MS. */
export const SHEEN_SWEEP_MS = 3_600
export const SHEEN_EVERY_MS = 20_000
/** A new song's first glint comes once its cover has settled in. */
export const SHEEN_FIRST_DELAY_MS = 2_500

/** A few, small and slow: specks, not a snowstorm. */
export const SPARKLE_COUNT = 6

export interface Sparkle {
  /** Where it starts, in shares of the cover from its top left. */
  x: number
  y: number
  /** Its size, in rem. */
  size: number
  /** How far up it drifts, and how far across, in shares of the cover. */
  rise: number
  drift: number
  /** One drift, start to end; it fades in and out on the way. */
  durationMs: number
  /** How far into its first drift it already is, so they don't all start together. */
  startMs: number
}

/** Mulberry32: tiny and stable, so a song's specks are the same every time it plays. */
export function random(seed: string): () => number {
  let state = 0x9e3779b9
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 0x85ebca6b)
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The song's specks, spread across the cover in columns so they never bunch up. */
export function sparkles(seed: string, count = SPARKLE_COUNT): Sparkle[] {
  const next = random(seed)
  return Array.from({ length: count }, (_, i) => {
    const durationMs = 11_000 + next() * 6_000
    return {
      x: (i + 0.2 + next() * 0.6) / count,
      y: 0.55 + next() * 0.4,
      size: 0.1875 + next() * 0.1875,
      rise: 0.25 + next() * 0.15,
      drift: (next() - 0.5) * 0.08,
      durationMs,
      startMs: next() * durationMs
    }
  })
}

/**
 * The glow's two arrangements of the cover's three colors, one to a side, lit so they glow:
 * the second has them swapped round, so crossing from one to the other they seem to wander.
 */
export function glowColors(palette: readonly string[]): { a: string[]; b: string[] } {
  const [one = '#333333', two = one, three = two] = palette.map(glowShade)
  return { a: [one, two, three], b: [three, one, two] }
}
