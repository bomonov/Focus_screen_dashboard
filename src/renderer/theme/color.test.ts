import { describe, expect, it } from 'vitest'
import {
  backgroundShade,
  contrast,
  coverColors,
  fitContrast,
  glowShade,
  inkShade,
  livingPalette,
  onAccentColor,
  parseHex,
  pickArtAccent,
  toHex,
  withAlpha
} from './color'

/** `count` copies of one RGBA pixel. */
function pixels(
  ...runs: [r: number, g: number, b: number, count: number, alpha?: number][]
): Uint8ClampedArray {
  const out: number[] = []
  for (const [r, g, b, count, alpha = 255] of runs) {
    for (let i = 0; i < count; i++) out.push(r, g, b, alpha)
  }
  return new Uint8ClampedArray(out)
}

describe('parseHex / toHex', () => {
  it('round-trips six-digit colors', () => {
    expect(parseHex('#FFC627')).toEqual({ r: 255, g: 198, b: 39 })
    expect(toHex({ r: 255, g: 198, b: 39 })).toBe('#FFC627')
  })

  it('rejects anything else', () => {
    expect(parseHex('gold')).toBeNull()
    expect(parseHex('#fff')).toBeNull()
  })
})

describe('contrast', () => {
  it('matches the WCAG extremes', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(contrast('#777777', '#777777')).toBe(1)
  })
})

describe('onAccentColor', () => {
  it('puts black on light accents and white on dark ones', () => {
    expect(onAccentColor('#FFC627')).toBe('#000000')
    expect(onAccentColor('#78BE20')).toBe('#000000')
    expect(onAccentColor('#8C1D40')).toBe('#FFFFFF')
  })
})

describe('withAlpha', () => {
  it('writes a CSS rgb() with opacity', () => {
    expect(withAlpha('#191919', 0.78)).toBe('rgb(25 25 25 / 0.78)')
  })
})

describe('fitContrast', () => {
  it('leaves a readable color alone', () => {
    expect(fitContrast('#FFC627', '#191919')).toBe('#FFC627')
  })

  it('lightens a dark color on a dark card and darkens a light one on a white card', () => {
    const lifted = fitContrast('#3A0C1A', '#191919')
    expect(contrast(lifted, '#191919')).toBeGreaterThanOrEqual(3)
    const deepened = fitContrast('#FFE680', '#FFFFFF')
    expect(contrast(deepened, '#FFFFFF')).toBeGreaterThanOrEqual(3)
  })
})

describe('pickArtAccent', () => {
  it('finds the colorful part of a mostly grey cover', () => {
    const accent = pickArtAccent(pixels([128, 128, 128, 900], [220, 30, 40, 100]))
    const rgb = parseHex(accent ?? '')
    expect(rgb).not.toBeNull()
    expect(rgb!.r).toBeGreaterThan(rgb!.g + 100)
    expect(rgb!.r).toBeGreaterThan(rgb!.b + 100)
  })

  it('prefers the more present color', () => {
    const accent = pickArtAccent(pixels([30, 90, 220, 600], [230, 200, 40, 200]))
    const rgb = parseHex(accent ?? '')!
    expect(rgb.b).toBeGreaterThan(rgb.r)
  })

  it('gives up on black-and-white covers', () => {
    expect(
      pickArtAccent(pixels([0, 0, 0, 500], [255, 255, 255, 500], [90, 90, 90, 500]))
    ).toBeNull()
  })

  it('ignores see-through pixels and empty input', () => {
    expect(pickArtAccent(pixels([220, 30, 40, 100, 0]))).toBeNull()
    expect(pickArtAccent(new Uint8ClampedArray())).toBeNull()
  })
})

describe('livingPalette', () => {
  const hue = (hex: string): number => {
    const { r, g, b } = parseHex(hex) ?? { r: 0, g: 0, b: 0 }
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max === min) return -1
    const d = max - min
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    return Math.round((h * 60 + 360) % 360)
  }

  it('takes a cover’s main colors, most present first, then its overall tone', () => {
    const palette = livingPalette(pixels([200, 30, 40, 60], [30, 60, 200, 30], [20, 20, 20, 10]))
    expect(palette).toHaveLength(4)
    // Red sits either side of 0°.
    const red = hue(palette?.[0] ?? '')
    expect(Math.min(red, 360 - red)).toBeLessThan(15)
    expect(hue(palette?.[1] ?? '')).toBeGreaterThan(200)
  })

  it('keeps the colors a few hues apart, filling in with lighter and darker takes', () => {
    const palette = livingPalette(pixels([200, 30, 40, 50], [210, 50, 30, 50]))
    expect(palette).toHaveLength(4)
    expect(new Set(palette).size).toBe(4)
  })

  it('makes greys from a cover with no color', () => {
    const palette = livingPalette(pixels([128, 128, 128, 40], [40, 40, 40, 40]))
    expect(palette).toHaveLength(4)
    for (const color of palette ?? []) expect(hue(color)).toBe(-1)
  })

  it('has nothing to say about an empty picture', () => {
    expect(livingPalette(new Uint8ClampedArray())).toBeNull()
    expect(livingPalette(pixels([255, 0, 0, 10, 0]))).toBeNull()
  })
})

describe('glowShade', () => {
  it('lights a dark, dusty color and keeps its hue', () => {
    expect(glowShade('#431F53')).toBe('#9D33CC')
    expect(glowShade('#EAB83E')).toBe('#EAB83E')
  })

  it('keeps a grey glow grey', () => {
    expect(glowShade('#202020')).toBe('#808080')
  })
})

describe('coverColors', () => {
  it('gives the cover’s main colors as they are, and its overall tone', () => {
    const read = coverColors(pixels([200, 30, 40, 60], [30, 60, 200, 30], [20, 20, 20, 10]))
    // Unshaded: the living background tames these, the lyrics fit them on their own.
    expect(read?.lively[0]).toBe('#C81E28')
    expect(read?.lively[1]).toBe('#1E3CC8')
    expect(read?.lively).toHaveLength(3)
    expect(read?.base).toBe(toHex({ r: 131, g: 38, b: 86 }))
  })

  it('is what the living background shades', () => {
    const cover = pixels([200, 30, 40, 50], [30, 160, 90, 40], [240, 200, 40, 30])
    const read = coverColors(cover)
    expect(livingPalette(cover)).toEqual(
      [...(read?.lively ?? []), read?.base ?? ''].map(backgroundShade)
    )
  })

  it('has nothing to say about an empty picture', () => {
    expect(coverColors(new Uint8ClampedArray())).toBeNull()
  })
})

describe('inkShade', () => {
  const hueOf = (hex: string): number => {
    const { r, g, b } = parseHex(hex) ?? { r: 0, g: 0, b: 0 }
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max === min) return -1
    const d = max - min
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    return (h * 60 + 360) % 360
  }
  const saturation = (hex: string): number => {
    const { r, g, b } = parseHex(hex) ?? { r: 0, g: 0, b: 0 }
    const max = Math.max(r, g, b) / 255
    const min = Math.min(r, g, b) / 255
    const l = (max + min) / 2
    return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1))
  }

  it('lifts a dark cover color until it reads on a dark card, keeping its hue', () => {
    const ink = inkShade('#2B3FA8', '#191919')
    expect(contrast(ink, '#191919')).toBeGreaterThanOrEqual(4.5)
    expect(Math.abs(hueOf(ink) - hueOf('#2B3FA8'))).toBeLessThan(4)
  })

  it('darkens a bright cover color on a light card', () => {
    const ink = inkShade('#F4D35E', '#F5F5F5')
    expect(contrast(ink, '#F5F5F5')).toBeGreaterThanOrEqual(4.5)
    expect(Math.abs(hueOf(ink) - hueOf('#F4D35E'))).toBeLessThan(4)
  })

  it('keeps a dusty color lively rather than letting it fade to grey', () => {
    expect(saturation(inkShade('#5E7D63', '#2E2E2E'))).toBeGreaterThan(0.7)
  })

  it('keeps a grey cover grey', () => {
    expect(hueOf(inkShade('#6B6B6B', '#191919'))).toBe(-1)
  })
})

describe('backgroundShade', () => {
  it('tames neon and lifts black, keeping the hue', () => {
    expect(backgroundShade('#000000')).toBe('#383838')
    expect(backgroundShade('#FFFFFF')).toBe('#949494')
    expect(backgroundShade('#00FF00')).toBe('#19E619')
  })
})
