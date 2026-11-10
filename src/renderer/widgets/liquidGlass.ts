// Real refraction for small pieces of glass, after kube.io's "Liquid Glass in the Browser":
// the glass has a curved bezel; Snell's law says how far light under each point of it is bent;
// that becomes an SVG displacement map applied to what's behind the glass (Chromium only, which
// Electron is). A rim highlight, lit from the top left, goes on top.

/** Glass's refractive index; the air around it is 1. */
const GLASS_INDEX = 1.5
/** Steps across the bezel: an 8-bit displacement map can't tell more apart. */
const SAMPLES = 127

/** The bezel's height, 0 at the glass's edge rising to 1 where its flat top begins: a squircle. */
export function convexSquircle(t: number): number {
  const u = 1 - Math.min(Math.max(t, 0), 1)
  return Math.pow(1 - u ** 4, 0.25)
}

/**
 * How far, in pixels, light coming straight down is pushed inward at each step across the bezel
 * (from the edge in). `thickness` is the glass's height and `bezel` the bezel's width, in px.
 */
export function bezelDisplacements(thickness: number, bezel: number): number[] {
  const delta = 0.001
  const out: number[] = []
  for (let i = 0; i < SAMPLES; i++) {
    const t = i / (SAMPLES - 1)
    const height = convexSquircle(t) * thickness
    const slope =
      ((convexSquircle(t + delta) - convexSquircle(t - delta)) / (2 * delta)) * (thickness / bezel)
    const incidence = Math.atan(slope)
    const refracted = Math.asin(Math.sin(incidence) / GLASS_INDEX)
    out.push(height * Math.tan(incidence - refracted))
  }
  return out
}

export interface GlassMaps {
  /** RGBA pixels: red and green are the x and y push (128 = none), for feDisplacementMap. */
  displacement: Uint8ClampedArray
  /** RGBA pixels: white, as opaque as the rim catches the light. */
  specular: Uint8ClampedArray
  /** The largest push in px: feDisplacementMap's scale. */
  scale: number
}

export interface GlassShape {
  width: number
  height: number
  /** Corner radius, in px. */
  radius: number
  /** How far in from the edge the glass curves, in px. */
  bezel: number
  /** How thick the glass is, in px; thicker bends more. */
  thickness: number
}

/** The light's direction, from the top left, as a unit vector pointing toward it. */
const LIGHT = { x: -0.6, y: -0.8 }

/**
 * Both maps for a rounded rectangle. Every pixel is placed by its distance in from the nearest
 * edge and that edge's outward direction (a rounded-rectangle signed distance field).
 */
export function glassMaps(shape: GlassShape): GlassMaps {
  const width = Math.max(1, Math.round(shape.width))
  const height = Math.max(1, Math.round(shape.height))
  const radius = Math.min(shape.radius, width / 2, height / 2)
  const bezel = Math.max(1, Math.min(shape.bezel, radius))
  const pushes = bezelDisplacements(shape.thickness, bezel)
  const scale = Math.max(...pushes, 0.0001)
  const displacement = new Uint8ClampedArray(width * height * 4)
  const specular = new Uint8ClampedArray(width * height * 4)
  const halfW = width / 2
  const halfH = height / 2

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const px = x + 0.5 - halfW
      const py = y + 0.5 - halfH
      const qx = Math.abs(px) - (halfW - radius)
      const qy = Math.abs(py) - (halfH - radius)
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
      const depth = radius - (outside + Math.min(Math.max(qx, qy), 0))

      // The outward direction of the nearest edge.
      let nx = 0
      let ny = 0
      if (qx > 0 && qy > 0) {
        nx = Math.sign(px) * qx
        ny = Math.sign(py) * qy
        const length = Math.hypot(nx, ny) || 1
        nx /= length
        ny /= length
      } else if (qx > qy) {
        nx = Math.sign(px)
      } else {
        ny = Math.sign(py)
      }

      let dx = 0
      let dy = 0
      let shine = 0
      if (depth > 0 && depth < bezel) {
        const t = depth / bezel
        const push = (pushes[Math.round(t * (SAMPLES - 1))] ?? 0) / scale
        // Convex glass bends light inward: each pixel shows what's a little further in.
        dx = -nx * push
        dy = -ny * push
        const facing = Math.max(0, nx * LIGHT.x + ny * LIGHT.y)
        const away = Math.max(0, -(nx * LIGHT.x + ny * LIGHT.y)) * 0.55
        shine = Math.pow(1 - t, 2.2) * Math.pow(facing + away, 1.5)
      }
      displacement[i] = 128 + dx * 127
      displacement[i + 1] = 128 + dy * 127
      displacement[i + 2] = 128
      displacement[i + 3] = 255
      specular[i] = 255
      specular[i + 1] = 255
      specular[i + 2] = 255
      specular[i + 3] = Math.min(1, shine) * 255
    }
  }
  return { displacement, specular, scale }
}

export interface CapsuleMaps {
  /** Pixels for the left end, the middle (one column, stretched to any width), the right end. */
  displacement: { left: Uint8ClampedArray; middle: Uint8ClampedArray; right: Uint8ClampedArray }
  specular: { left: Uint8ClampedArray; middle: Uint8ClampedArray; right: Uint8ClampedArray }
  /** Each end's width: half the height. */
  cap: number
  height: number
  scale: number
}

function columns(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  from: number,
  to: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray((to - from) * height * 4)
  for (let y = 0; y < height; y++) {
    out.set(pixels.subarray((y * width + from) * 4, (y * width + to) * 4), y * (to - from) * 4)
  }
  return out
}

/**
 * Maps for a capsule of this height and any width. Its middle is the same all along (only the
 * top and bottom edges curve there), so one column of it can be stretched to fit, between the two
 * round ends: the glass can change width every frame without new maps, and its ends stay round.
 */
export function capsuleMaps(height: number, bezel: number, thickness: number): CapsuleMaps {
  const h = Math.max(2, Math.round(height))
  const cap = Math.ceil(h / 2)
  const width = cap * 2 + 1
  const maps = glassMaps({ width, height: h, radius: h / 2, bezel, thickness })
  const split = (pixels: Uint8ClampedArray): CapsuleMaps['displacement'] => ({
    left: columns(pixels, width, h, 0, cap),
    middle: columns(pixels, width, h, cap, cap + 1),
    right: columns(pixels, width, h, cap + 1, width)
  })
  return {
    displacement: split(maps.displacement),
    specular: split(maps.specular),
    cap,
    height: h,
    scale: maps.scale
  }
}

/** The eight edge pieces of a rounded panel's maps; its middle is flat glass, which bends nothing. */
export type PanelPiece =
  'topLeft' | 'top' | 'topRight' | 'left' | 'right' | 'bottomLeft' | 'bottom' | 'bottomRight'

export const PANEL_PIECES: readonly PanelPiece[] = [
  'topLeft',
  'top',
  'topRight',
  'left',
  'right',
  'bottomLeft',
  'bottom',
  'bottomRight'
]

export interface PanelMaps {
  /** Corners are corner × corner; edges one pixel across, stretched along the panel's side. */
  displacement: Record<PanelPiece, Uint8ClampedArray>
  specular: Record<PanelPiece, Uint8ClampedArray>
  /** Each corner's size: the radius, rounded up. */
  corner: number
  scale: number
}

function crop(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  w: number,
  h: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let row = 0; row < h; row++) {
    const from = ((y + row) * width + x) * 4
    out.set(pixels.subarray(from, from + w * 4), row * w * 4)
  }
  return out
}

/**
 * Maps for a rounded panel of any size, cut like a nine-slice image. Along each straight side
 * the glass is the same all the way (only the distance in from that side matters), so a
 * one-pixel strip of it stretches to any length between the corners, which never change: the
 * panel can grow and shrink every frame without new maps.
 */
export function panelMaps(radius: number, bezel: number, thickness: number): PanelMaps {
  const c = Math.max(1, Math.ceil(radius))
  const size = c * 2 + 1
  const maps = glassMaps({ width: size, height: size, radius, bezel, thickness })
  const boxes: Record<PanelPiece, [number, number, number, number]> = {
    topLeft: [0, 0, c, c],
    top: [c, 0, 1, c],
    topRight: [c + 1, 0, c, c],
    left: [0, c, c, 1],
    right: [c + 1, c, c, 1],
    bottomLeft: [0, c + 1, c, c],
    bottom: [c, c + 1, 1, c],
    bottomRight: [c + 1, c + 1, c, c]
  }
  const cut = (pixels: Uint8ClampedArray): Record<PanelPiece, Uint8ClampedArray> =>
    Object.fromEntries(
      PANEL_PIECES.map((piece) => {
        const [x, y, w, h] = boxes[piece]
        return [piece, crop(pixels, size, x, y, w, h)]
      })
    ) as Record<PanelPiece, Uint8ClampedArray>
  return {
    displacement: cut(maps.displacement),
    specular: cut(maps.specular),
    corner: c,
    scale: maps.scale
  }
}
