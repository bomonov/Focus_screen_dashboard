/**
 * A stand-in cover for songs without one, in the mockup's style: a colored label with a band
 * across the bottom and a dot. The colors come from the album, so one album always looks the
 * same. These are artwork colors, not theme colors.
 */
export interface PlaceholderCover {
  base: string
  band: string
  dot: string
}

const MAROON_GOLD: PlaceholderCover = { base: '#8C1D40', band: '#FFC627', dot: '#FF7F32' }

const PALETTES: readonly PlaceholderCover[] = [
  MAROON_GOLD,
  { base: '#4AB7C4', band: '#191919', dot: '#FFFFFF' },
  { base: '#484848', band: '#00A3E0', dot: '#FFC627' },
  { base: '#FFC627', band: '#8C1D40', dot: '#FFFFFF' },
  { base: '#78BE20', band: '#191919', dot: '#FFC627' },
  { base: '#FF7F32', band: '#484848', dot: '#00A3E0' }
]

/** FNV-1a: tiny, stable across runs, and spreads similar names apart. */
function hash(text: string): number {
  let value = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i)
    value = Math.imul(value, 0x01000193)
  }
  return value >>> 0
}

export function placeholderCover(artist: string, album: string, title: string): PlaceholderCover {
  const seed = album ? `${artist}\n${album}` : `${artist}\n${title}`
  return PALETTES[hash(seed) % PALETTES.length] ?? MAROON_GOLD
}
