// Color math for themes: contrast, text on the accent, and an accent taken from album art.

export interface Rgb {
  /** 0–255 */
  r: number
  g: number
  b: number
}

interface Hsl {
  /** 0–360 */
  h: number
  /** 0–1 */
  s: number
  l: number
}

const HEX = /^#([0-9a-f]{6})$/i

export function parseHex(hex: string): Rgb | null {
  const match = HEX.exec(hex)
  if (!match?.[1]) return null
  const value = Number.parseInt(match[1], 16)
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (n: number): string =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase()
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance({ r, g, b }: Rgb): number {
  const channel = (n: number): number => {
    const c = n / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio, 1 to 21. Unreadable colors count as no contrast. */
export function contrast(a: string, b: string): number {
  const ca = parseHex(a)
  const cb = parseHex(b)
  if (!ca || !cb) return 1
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** Black or white, whichever reads better on the accent (Daylight's maroon needs white). */
export function onAccentColor(accent: string): '#000000' | '#FFFFFF' {
  return contrast(accent, '#000000') >= contrast(accent, '#FFFFFF') ? '#000000' : '#FFFFFF'
}

/** `hex` at the given opacity, as a CSS color. */
export function withAlpha(hex: string, alpha: number): string {
  const rgb = parseHex(hex)
  if (!rgb) return hex
  return `rgb(${rgb.r} ${rgb.g} ${rgb.b} / ${alpha})`
}

function toHsl({ r, g, b }: Rgb): Hsl {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === rn) h = ((gn - bn) / d) % 6
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return { h: (h * 60 + 360) % 360, s, l }
}

function fromHsl({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}

/**
 * Lightens (on a dark card) or darkens (on a light one) until `color` reaches `min` contrast
 * against `background`, keeping its hue. Used for accents nobody picked by hand.
 */
export function fitContrast(color: string, background: string, min = 3): string {
  const rgb = parseHex(color)
  const bg = parseHex(background)
  if (!rgb || !bg) return color
  const hsl = toHsl(rgb)
  const step = luminance(bg) < 0.5 ? 0.02 : -0.02
  let candidate = toHex(rgb)
  for (let l = hsl.l; l >= 0 && l <= 1; l += step) {
    candidate = toHex(fromHsl({ ...hsl, l }))
    if (contrast(candidate, background) >= min) return candidate
  }
  return candidate
}

const HUE_BUCKETS = 12
/** Covers that are mostly grey (or nearly all black or white) keep the user's own accent. */
const MIN_COLOR_SHARE = 0.04

/**
 * The cover's most present lively color, from RGBA pixels (a small downscaled copy is plenty).
 * Pixels are grouped by hue and weighted by how colorful they are, so a red logo on a big grey
 * sleeve still wins over the grey. null when the cover has no real color.
 */
export function pickArtAccent(pixels: Uint8ClampedArray): string | null {
  const buckets = Array.from({ length: HUE_BUCKETS }, () => ({ weight: 0, r: 0, g: 0, b: 0 }))
  let count = 0
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const alpha = pixels[i + 3] ?? 0
    if (alpha < 128) continue
    count += 1
    const rgb = { r: pixels[i] ?? 0, g: pixels[i + 1] ?? 0, b: pixels[i + 2] ?? 0 }
    const { h, s, l } = toHsl(rgb)
    if (l < 0.12 || l > 0.92) continue
    // Most weight to saturated mid-tones; pale and murky pixels count for little.
    const weight = s * (1 - Math.abs(2 * l - 1))
    const bucket = buckets[Math.floor(h / (360 / HUE_BUCKETS)) % HUE_BUCKETS]
    if (!bucket) continue
    bucket.weight += weight
    bucket.r += rgb.r * weight
    bucket.g += rgb.g * weight
    bucket.b += rgb.b * weight
  }
  const best = buckets.reduce((a, b) => (b.weight > a.weight ? b : a))
  if (count === 0 || best.weight / count < MIN_COLOR_SHARE) return null
  const average = {
    r: best.r / best.weight,
    g: best.g / best.weight,
    b: best.b / best.weight
  }
  // A button color, not a photo color: bright enough to read and never washed out.
  const hsl = toHsl(average)
  return toHex(
    fromHsl({ h: hsl.h, s: Math.max(hsl.s, 0.55), l: Math.min(Math.max(hsl.l, 0.45), 0.62) })
  )
}

/** A hue must have at least this share of a cover's lively weight to color the background. */
const MIN_LIVING_SHARE = 0.02

/**
 * A color made fit to sit behind the cards, under the theme's veil: never neon, never black,
 * never washed out, so any cover makes a calm, readable background.
 */
export function backgroundShade(hex: string): string {
  const rgb = parseHex(hex)
  if (!rgb) return '#333333'
  const { h, s, l } = toHsl(rgb)
  return toHex(fromHsl({ h, s: Math.min(s, 0.8), l: Math.min(Math.max(l, 0.22), 0.58) }))
}

/**
 * A color made fit to glow round the cover: lit and lively, so a cover's dark or dusty colors
 * don't turn the glow to mud, while a grey cover keeps a grey glow.
 */
export function glowShade(hex: string): string {
  const rgb = parseHex(hex)
  if (!rgb) return '#808080'
  const { h, s, l } = toHsl(rgb)
  const lively = s < 0.12 ? s : Math.min(Math.max(s, 0.6), 0.9)
  return toHex(fromHsl({ h, s: lively, l: Math.min(Math.max(l, 0.5), 0.66) }))
}

/**
 * A cover color made fit to color lyrics on the card (`ground`): lively, so a dusty color doesn't
 * fade to grey as it's lightened, then lighter (or darker, on a light card) until it reads at
 * `min`, its hue kept. A grey cover keeps grey words.
 */
export function inkShade(hex: string, ground: string, min = 4.5): string {
  const rgb = parseHex(hex)
  if (!rgb) return hex
  const { h, s, l } = toHsl(rgb)
  const lively = s < 0.12 ? s : Math.min(Math.max(s, 0.75), 0.95)
  return fitContrast(toHex(fromHsl({ h, s: lively, l })), ground, min)
}

/** A cover's three most present lively colors (as they are) and its overall tone. */
export interface CoverColors {
  lively: string[]
  base: string
}

/**
 * A cover's three most present lively colors, at least two hue steps apart, and its overall tone
 * as the base. A cover with little color gives its own greys. null when there are no pixels.
 */
export function coverColors(pixels: Uint8ClampedArray): CoverColors | null {
  const buckets = Array.from({ length: HUE_BUCKETS }, () => ({ weight: 0, r: 0, g: 0, b: 0 }))
  const total = { r: 0, g: 0, b: 0 }
  let count = 0
  let lively = 0
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if ((pixels[i + 3] ?? 0) < 128) continue
    const rgb = { r: pixels[i] ?? 0, g: pixels[i + 1] ?? 0, b: pixels[i + 2] ?? 0 }
    count += 1
    total.r += rgb.r
    total.g += rgb.g
    total.b += rgb.b
    const { h, s, l } = toHsl(rgb)
    if (l < 0.08 || l > 0.95) continue
    const weight = s * (1 - Math.abs(2 * l - 1))
    const bucket = buckets[Math.floor(h / (360 / HUE_BUCKETS)) % HUE_BUCKETS]
    if (!bucket) continue
    bucket.weight += weight
    bucket.r += rgb.r * weight
    bucket.g += rgb.g * weight
    bucket.b += rgb.b * weight
    lively += weight
  }
  if (count === 0) return null
  const base = { r: total.r / count, g: total.g / count, b: total.b / count }

  const ranked = buckets
    .map((bucket, index) => ({ ...bucket, index }))
    .filter((bucket) => lively > 0 && bucket.weight / lively >= MIN_LIVING_SHARE)
    .sort((a, b) => b.weight - a.weight)
  const picked: typeof ranked = []
  for (const bucket of ranked) {
    const apart = picked.every((other) => {
      const steps = Math.abs(other.index - bucket.index)
      return Math.min(steps, HUE_BUCKETS - steps) >= 2
    })
    if (apart) picked.push(bucket)
    if (picked.length === 3) break
  }
  const colors = picked.map((bucket) =>
    toHex({ r: bucket.r / bucket.weight, g: bucket.g / bucket.weight, b: bucket.b / bucket.weight })
  )
  // Too few colors of its own: lighter and darker takes on what it has (or on its grey).
  const seed = toHsl(colors[0] ? (parseHex(colors[0]) ?? base) : base)
  for (const shift of [0.14, -0.12, 0.26]) {
    if (colors.length >= 3) break
    colors.push(toHex(fromHsl({ ...seed, l: Math.min(Math.max(seed.l + shift, 0), 1) })))
  }
  return { lively: colors, base: toHex(base) }
}

/** The living background's four colors from a cover's pixels: its colors, tamed to sit behind. */
export function livingPalette(pixels: Uint8ClampedArray): string[] | null {
  const read = coverColors(pixels)
  return read ? [...read.lively, read.base].map(backgroundShade) : null
}
