import { useEffect, useState } from 'react'
import { pickArtAccent } from '../theme/color'

/** A tiny copy is plenty to find a cover's main color, and quick to read back. */
const SAMPLE_PX = 32

/** Decodes a cover (a data URL from the main process) and reads a small copy's pixels. */
export function readCoverPixels(src: string): Promise<Uint8ClampedArray> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = SAMPLE_PX
      canvas.height = SAMPLE_PX
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) {
        reject(new Error('No 2D canvas'))
        return
      }
      context.drawImage(image, 0, 0, SAMPLE_PX, SAMPLE_PX)
      resolve(context.getImageData(0, 0, SAMPLE_PX, SAMPLE_PX).data)
    }
    image.onerror = () => reject(new Error('Could not decode the cover'))
    image.src = src
  })
}

/** The current cover's main color while "Match accent to album art" is on; null otherwise. */
export function useArtAccent(artwork: string | null, enabled: boolean): string | null {
  const [accent, setAccent] = useState<{ artwork: string; color: string | null } | null>(null)

  useEffect(() => {
    if (!enabled || !artwork) return
    let active = true
    readCoverPixels(artwork)
      .then((pixels) => {
        if (active) setAccent({ artwork, color: pickArtAccent(pixels) })
      })
      .catch(() => {
        if (active) setAccent({ artwork, color: null })
      })
    return () => {
      active = false
    }
  }, [artwork, enabled])

  // A color worked out for the previous song never colors the next one.
  return enabled && accent && accent.artwork === artwork ? accent.color : null
}
