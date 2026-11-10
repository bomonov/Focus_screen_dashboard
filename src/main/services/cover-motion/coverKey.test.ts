import { expect, it } from 'vitest'
import { dHash, sameCover } from './coverKey'

/** A 9×8 grey picture from a function of (x, y). */
function picture(at: (x: number, y: number) => number): Uint8Array {
  const out = new Uint8Array(9 * 8)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) out[y * 9 + x] = at(x, y)
  return out
}

const scene = (x: number, y: number): number => (x * 37 + y * 53 + ((x * y) % 5) * 11) % 200

it('gives the same cover the same key, in 16 hex digits', () => {
  expect(dHash(picture(scene))).toBe(dHash(picture(scene)))
  expect(dHash(picture(scene))).toMatch(/^[0-9a-f]{16}$/)
})

it('keeps the key when the cover is only brighter (a re-encoded or smaller copy)', () => {
  expect(dHash(picture((x, y) => scene(x, y) + 20))).toBe(dHash(picture(scene)))
})

it('gives a different picture a different key', () => {
  expect(dHash(picture((x, y) => scene(8 - x, y)))).not.toBe(dHash(picture(scene)))
})

it('tells the same cover from another that happens to share its key', () => {
  const fingerprint = Uint8Array.from({ length: 256 }, (_, i) => (i * 7) % 256)
  const reencoded = fingerprint.map((v) => Math.min(255, v + 3))
  const other = fingerprint.map((v) => 255 - v)
  expect(sameCover(fingerprint, fingerprint)).toBe(true)
  expect(sameCover(fingerprint, reencoded)).toBe(true)
  expect(sameCover(fingerprint, other)).toBe(false)
  expect(sameCover(fingerprint, fingerprint.slice(0, 100))).toBe(false)
})
