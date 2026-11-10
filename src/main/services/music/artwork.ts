import { nativeImage } from 'electron'

/** Big enough for the disc label on a 4K screen; covers can arrive at 3000 px. */
const MAX_SIDE_PX = 600
const JPEG_QUALITY = 85

/**
 * Decodes cover bytes and re-encodes them as a small JPEG data URL. Re-encoding also means
 * only pixels we decoded ourselves reach the renderer, never the bytes as they came in.
 */
export function toArtworkDataUrl(bytes: Uint8Array): string | null {
  const image = nativeImage.createFromBuffer(Buffer.from(bytes))
  if (image.isEmpty()) return null
  const { width, height } = image.getSize()
  const scaled =
    Math.max(width, height) <= MAX_SIDE_PX
      ? image
      : image.resize(
          width >= height
            ? { width: MAX_SIDE_PX, quality: 'good' }
            : { height: MAX_SIDE_PX, quality: 'good' }
        )
  return `data:image/jpeg;base64,${scaled.toJPEG(JPEG_QUALITY).toString('base64')}`
}
