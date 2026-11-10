import { describe, expect, it } from 'vitest'
import {
  bezelDisplacements,
  capsuleMaps,
  convexSquircle,
  glassMaps,
  PANEL_PIECES,
  panelMaps,
  type PanelPiece
} from './liquidGlass'

describe('convexSquircle', () => {
  it('rises from the edge to a flat top', () => {
    expect(convexSquircle(0)).toBe(0)
    expect(convexSquircle(1)).toBe(1)
    expect(convexSquircle(0.5)).toBeGreaterThan(0.9)
    expect(convexSquircle(-1)).toBe(0)
    expect(convexSquircle(2)).toBe(1)
  })
})

describe('bezelDisplacements', () => {
  it('bends nothing at the very edge or on the flat top, and most in between', () => {
    const pushes = bezelDisplacements(16, 12)
    expect(pushes).toHaveLength(127)
    expect(pushes[0]).toBeCloseTo(0, 5)
    expect(pushes[126]).toBeCloseTo(0, 1)
    expect(Math.max(...pushes)).toBeGreaterThan(1)
  })

  it('bends more through thicker glass', () => {
    const thin = Math.max(...bezelDisplacements(8, 12))
    const thick = Math.max(...bezelDisplacements(24, 12))
    expect(thick).toBeGreaterThan(thin)
  })
})

describe('glassMaps', () => {
  const shape = { width: 80, height: 40, radius: 18, bezel: 10, thickness: 16 }
  const at = (data: Uint8ClampedArray, x: number, y: number): number[] => {
    const i = (y * shape.width + x) * 4
    return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 0]
  }

  it('leaves the flat middle alone', () => {
    const { displacement, specular } = glassMaps(shape)
    expect(at(displacement, 40, 20).slice(0, 2)).toEqual([128, 128])
    expect(at(specular, 40, 20)[3]).toBe(0)
  })

  it('pushes the bezel inward: right edge to the left, top edge down', () => {
    const { displacement } = glassMaps(shape)
    const [rightX] = at(displacement, 76, 20)
    const [, topY] = at(displacement, 40, 3)
    expect(rightX).toBeLessThan(128)
    expect(topY).toBeGreaterThan(128)
  })

  it('catches the light on the top left more than the bottom right', () => {
    const { specular } = glassMaps(shape)
    expect(at(specular, 8, 4)[3]).toBeGreaterThan(at(specular, 71, 35)[3] ?? 0)
  })

  it('gives the filter a scale and sizes the maps to the glass', () => {
    const maps = glassMaps(shape)
    expect(maps.scale).toBeGreaterThan(0)
    expect(maps.displacement).toHaveLength(80 * 40 * 4)
  })
})

describe('capsuleMaps', () => {
  const maps = capsuleMaps(40, 10, 16)
  const px = (data: Uint8ClampedArray, width: number, x: number, y: number): number[] => {
    const i = (y * width + x) * 4
    return [data[i] ?? 0, data[i + 1] ?? 0]
  }

  it('splits into two round ends of half the height and a one-pixel middle', () => {
    expect(maps.cap).toBe(20)
    expect(maps.displacement.left).toHaveLength(20 * 40 * 4)
    expect(maps.displacement.middle).toHaveLength(1 * 40 * 4)
    expect(maps.displacement.right).toHaveLength(20 * 40 * 4)
  })

  it('bends the middle only up and down, so it can be stretched', () => {
    for (let y = 0; y < 40; y++) expect(px(maps.displacement.middle, 1, 0, y)[0]).toBe(128)
    expect(px(maps.displacement.middle, 1, 0, 3)[1]).toBeGreaterThan(128)
    expect(px(maps.displacement.middle, 1, 0, 36)[1]).toBeLessThan(128)
  })

  it('bends each end inward', () => {
    expect(px(maps.displacement.left, 20, 3, 20)[0]).toBeGreaterThan(128)
    expect(px(maps.displacement.right, 20, 16, 20)[0]).toBeLessThan(128)
  })
})

describe('panelMaps', () => {
  /** The pieces laid out on a panel this size, as the filter lays them, with a flat middle. */
  function stitch(
    maps: Record<PanelPiece, Uint8ClampedArray>,
    c: number,
    width: number,
    height: number
  ): Uint8ClampedArray {
    const out = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < out.length; i += 4) out.set([128, 128, 128, 255], i)
    const place: Record<PanelPiece, [number, number, number, number]> = {
      topLeft: [0, 0, c, c],
      top: [c, 0, width - 2 * c, c],
      topRight: [width - c, 0, c, c],
      left: [0, c, c, height - 2 * c],
      right: [width - c, c, c, height - 2 * c],
      bottomLeft: [0, height - c, c, c],
      bottom: [c, height - c, width - 2 * c, c],
      bottomRight: [width - c, height - c, c, c]
    }
    for (const piece of PANEL_PIECES) {
      const [x0, y0, w, h] = place[piece]
      const pixels = maps[piece]
      const pw = piece === 'top' || piece === 'bottom' ? 1 : c
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          // Edge strips are one pixel across: stretched, every pixel along them is that pixel.
          const sx = pw === 1 ? 0 : x
          const sy = piece === 'left' || piece === 'right' ? 0 : y
          const from = (sy * pw + sx) * 4
          out.set(pixels.subarray(from, from + 4), ((y0 + y) * width + x0 + x) * 4)
        }
      }
    }
    return out
  }

  it('stitches back into the same glass as a panel drawn whole', () => {
    const shape = { radius: 9, bezel: 6, thickness: 10 }
    const pieces = panelMaps(shape.radius, shape.bezel, shape.thickness)
    expect(pieces.corner).toBe(9)
    const sizes: [number, number][] = [
      [40, 30],
      [19, 64]
    ]
    for (const [width, height] of sizes) {
      const whole = glassMaps({ width, height, ...shape })
      expect(pieces.scale).toBeCloseTo(whole.scale, 6)
      expect(stitch(pieces.displacement, pieces.corner, width, height)).toEqual(whole.displacement)
    }
  })

  it('has a rim that catches the light at the top-left corner', () => {
    const { specular } = panelMaps(12, 8, 10)
    const alpha = (pixels: Uint8ClampedArray): number =>
      Math.max(...pixels.filter((_, i) => i % 4 === 3))
    expect(alpha(specular.topLeft)).toBeGreaterThan(alpha(specular.right))
  })
})
