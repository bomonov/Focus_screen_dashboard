import type { NativeImage } from 'electron'
import { ANALYSIS_PX } from './recipe'

/**
 * A difference hash of a 9×8 grey picture: one bit per neighbouring pair in each row (is the
 * left one brighter?). It survives re-encoding, resizing and brightness changes, so a song's
 * full cover and the queue's small copy of it get the same key.
 */
export function dHash(gray: Uint8Array): string {
  let hex = ''
  for (let y = 0; y < 8; y++) {
    let byte = 0
    for (let x = 0; x < 8; x++) {
      const left = gray[y * 9 + x] ?? 0
      const right = gray[y * 9 + x + 1] ?? 0
      byte = (byte << 1) | (left > right ? 1 : 0)
    }
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

/** The cover's middle square, as the record label and the square cover both show it. */
function middleSquare(image: NativeImage): NativeImage {
  const { width, height } = image.getSize()
  const side = Math.min(width, height)
  return image.crop({
    x: Math.floor((width - side) / 2),
    y: Math.floor((height - side) / 2),
    width: side,
    height: side
  })
}

/** The key a cover's moving parts are kept under. */
export function coverKey(image: NativeImage): string {
  const small = middleSquare(image).resize({ width: 9, height: 8, quality: 'good' })
  const bgra = small.toBitmap()
  const gray = new Uint8Array(9 * 8)
  for (let i = 0; i < gray.length; i++) {
    const b = bgra[i * 4] ?? 0
    const g = bgra[i * 4 + 1] ?? 0
    const r = bgra[i * 4 + 2] ?? 0
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
  }
  return dHash(gray)
}

const FINGERPRINT_SIDE = 16
/** Mean difference (0–255) under which two fingerprints are one cover, re-encoded or resized. */
const SAME_COVER = 10

/**
 * A 16×16 grey thumbnail, kept with a cover's parts: two different covers can share a 64-bit key
 * (flat or templated art especially), and parts must never be drawn over the wrong picture.
 */
export function coverFingerprint(image: NativeImage): Uint8Array {
  const small = middleSquare(image).resize({
    width: FINGERPRINT_SIDE,
    height: FINGERPRINT_SIDE,
    quality: 'good'
  })
  const bgra = small.toBitmap()
  const gray = new Uint8Array(FINGERPRINT_SIDE * FINGERPRINT_SIDE)
  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.round(
      0.299 * (bgra[i * 4 + 2] ?? 0) + 0.587 * (bgra[i * 4 + 1] ?? 0) + 0.114 * (bgra[i * 4] ?? 0)
    )
  }
  return gray
}

export function sameCover(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length || a.length === 0) return false
  let total = 0
  for (let i = 0; i < a.length; i++) total += Math.abs((a[i] ?? 0) - (b[i] ?? 0))
  return total / a.length < SAME_COVER
}

/** The cover the worker cuts parts from: the middle square at the analysis size. */
export function squareCover(image: NativeImage, px = ANALYSIS_PX): Buffer {
  return middleSquare(image).resize({ width: px, height: px, quality: 'best' }).toJPEG(92)
}
