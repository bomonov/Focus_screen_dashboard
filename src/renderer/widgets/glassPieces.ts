// Shared by the glass filters (GlassFilter's capsule, PanelGlass's panel).

/** Pixels to a PNG data URL, for an SVG <feImage>. */
export function toDataUrl(pixels: Uint8ClampedArray, width: number, height: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return ''
  const image = context.createImageData(width, height)
  image.data.set(pixels)
  context.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

/** Red, green and blue bend by slightly different amounts, which fringes edges with a rainbow. */
export const CHANNELS = [
  { keep: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', spread: 0.94 },
  { keep: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', spread: 1 },
  { keep: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0', spread: 1.08 }
] as const
