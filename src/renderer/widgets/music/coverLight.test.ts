import { describe, expect, it } from 'vitest'
import {
  glowColors,
  GLOW_SHIFT_MS,
  SHEEN_EVERY_MS,
  SHEEN_SWEEP_MS,
  sparkles,
  SPARKLE_COUNT
} from './coverLight'

// Visually induced motion sickness peaks at about 0.1–0.4 Hz: nothing repeats in 2.5–10 s.
const SICKEST_CYCLE_MS = 10_000

describe('the cover light’s pace', () => {
  it('shifts the glow far slower than the sickening band', () => {
    expect(GLOW_SHIFT_MS).toBeGreaterThanOrEqual(2 * SICKEST_CYCLE_MS)
  })

  it('glints once in a while, not in a rhythm the eye follows', () => {
    expect(SHEEN_EVERY_MS).toBeGreaterThanOrEqual(1.5 * SICKEST_CYCLE_MS)
    expect(SHEEN_SWEEP_MS).toBeLessThan(SHEEN_EVERY_MS / 4)
  })
})

describe('sparkles', () => {
  const specks = sparkles('yt:abc123')

  it('gives a song the same specks every time, and another song others', () => {
    expect(sparkles('yt:abc123')).toEqual(specks)
    expect(sparkles('yt:xyz789')).not.toEqual(specks)
    expect(specks).toHaveLength(SPARKLE_COUNT)
  })

  it('keeps every speck on the cover the whole way', () => {
    for (const speck of specks) {
      expect(speck.x + Math.min(speck.drift, 0)).toBeGreaterThan(0)
      expect(speck.x + Math.max(speck.drift, 0)).toBeLessThan(1)
      expect(speck.y).toBeLessThan(1)
      expect(speck.y - speck.rise).toBeGreaterThan(0.1)
    }
  })

  it('drifts slowly: under 4% of the cover a second (about 13 px at 21rem)', () => {
    for (const speck of specks) {
      expect(speck.rise / (speck.durationMs / 1000)).toBeLessThan(0.04)
      expect(speck.startMs).toBeLessThan(speck.durationMs)
    }
  })

  it('spreads them across the cover, one to a column', () => {
    specks.forEach((speck, i) => {
      expect(speck.x).toBeGreaterThanOrEqual(i / SPARKLE_COUNT)
      expect(speck.x).toBeLessThan((i + 1) / SPARKLE_COUNT)
    })
  })
})

it('lights the glow’s colors and swaps them round for its second arrangement', () => {
  const glow = glowColors(['#C43C64', '#431F53', '#EAB83E', '#773656'])
  expect(glow.a).toEqual(['#CC3461', '#9D33CC', '#EAB83E'])
  expect(glow.b).toEqual(['#EAB83E', '#CC3461', '#9D33CC'])
  expect(glowColors(['#C43C64']).a).toEqual(['#CC3461', '#CC3461', '#CC3461'])
})
