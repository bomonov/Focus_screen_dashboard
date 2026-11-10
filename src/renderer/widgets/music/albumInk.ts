// Album colors in the lyrics (the user's pick, 2026-11-07: "colored as it's sung"): the cover's
// colors run across each line, uncovered by the word-by-word light and kept once sung, while the
// lines still to come stay in the text color. Pure, so the rows only have to draw.
import { inkShade, parseHex, toHex } from '../../theme/color'

/** The cover's colors, each fitted to read on the card (4.5:1, the floor for words). */
export function albumInks(colors: readonly string[], ground: string): string[] {
  return colors.map((color) => inkShade(color, ground))
}

/**
 * The line's colors at `t` (0 at its start, 1 at its end): the first, then each next one at an
 * equal step, mixed in sRGB as the browser mixes a gradient's stops, so boxes side by side join.
 */
export function inkAt(inks: readonly string[], t: number): string {
  const last = inks.length - 1
  if (last <= 0) return inks[0] ?? '#FFFFFF'
  const at = Math.min(Math.max(t, 0), 1) * last
  const k = Math.min(Math.floor(at), last - 1)
  const a = parseHex(inks[k] ?? '')
  const b = parseHex(inks[k + 1] ?? '')
  if (!a || !b) return inks[k] ?? '#FFFFFF'
  const u = at - k
  return toHex({ r: a.r + (b.r - a.r) * u, g: a.g + (b.g - a.g) * u, b: a.b + (b.b - a.b) * u })
}

/** One stop of a box's colors: `at` 0 at the box's left edge, 1 at its right. */
export interface InkStop {
  color: string
  at: number
}

/**
 * The stretch of the line's colors a box covers, from `from` to `to` along the line (0 to 1):
 * its two ends and the line's own stops between them, so a box's colors bend where the line's do.
 */
export function inkSlice(inks: readonly string[], from: number, to: number): InkStop[] {
  if (to <= from) return [{ color: inkAt(inks, from), at: 0 }]
  const stops: InkStop[] = [{ color: inkAt(inks, from), at: 0 }]
  const last = inks.length - 1
  for (let k = 1; k < last; k++) {
    const t = k / last
    if (t > from && t < to)
      stops.push({ color: inks[k] ?? '#FFFFFF', at: (t - from) / (to - from) })
  }
  stops.push({ color: inkAt(inks, to), at: 1 })
  return stops
}

/**
 * A word box's light in the album's colors: like the plain light (bright half, soft 0.6em edge,
 * unsung half, twice the box plus the edge wide, slid across as the word is sung), with the bright
 * half carrying the box's own stretch of the line's colors.
 */
export function wordInk(inks: readonly string[], from: number, to: number): string {
  const lit = inkSlice(inks, from, to).map(
    (stop) => `${stop.color} calc((50% - 0.3em) * ${round(stop.at)})`
  )
  return `linear-gradient(90deg, ${lit.join(', ')}, var(--glide-unsung) calc(50% + 0.3em))`
}

/** The line's colors across a whole element (romaji); `quiet` mixes in the romaji's grey. */
export function lineInk(inks: readonly string[], quiet = false): string {
  const stops = inkSlice(inks, 0, 1).map((stop) => {
    const color = quiet
      ? `color-mix(in srgb, ${stop.color} 75%, var(--text-secondary))`
      : stop.color
    return `${color} ${round(stop.at * 100)}%`
  })
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

/**
 * Only timed lyrics take the album's colors: untimed ones have nothing known to be sung (the user
 * wants them in the text color), and a song colored by singer keeps the user's own coloring.
 */
export function showsAlbumInk(kind: 'synced' | 'plain' | null, singerColored: boolean): boolean {
  return kind === 'synced' && !singerColored
}

/** Short numbers in the styles, so measuring again writes the same text and costs no restyle. */
function round(value: number): number {
  return Math.round(value * 10000) / 10000
}
