import { useEffect, useState } from 'react'
import { backgroundShade, coverColors, type CoverColors } from '../theme/color'
import { readCoverPixels } from './useArtAccent'

/** From the stand-in label's colors when there's no cover: the first again as the base. */
function fallbackPalette(fallback: readonly string[]): string[] {
  const [first = '#333333', second = first, third = second] = fallback
  return [first, second, third, first].map(backgroundShade)
}

/** A cover's own colors, read once per cover; null with no cover, until read, or unreadable. */
export function useCoverColors(artwork: string | null): CoverColors | null {
  const [read, setRead] = useState<{ artwork: string; colors: CoverColors | null } | null>(null)
  useEffect(() => {
    if (!artwork) return
    let live = true
    readCoverPixels(artwork)
      .then((pixels) => {
        if (live) setRead({ artwork, colors: coverColors(pixels) })
      })
      .catch(() => {
        if (live) setRead({ artwork, colors: null })
      })
    return () => {
      live = false
    }
  }, [artwork])
  return artwork && read?.artwork === artwork ? read.colors : null
}

/** The song's four colors: read from its cover, or the stand-in label's until then (or ever). */
export function useCoverPalette(artwork: string | null, fallback: readonly string[]): string[] {
  const read = useCoverColors(artwork)
  return read ? [...read.lively, read.base].map(backgroundShade) : fallbackPalette(fallback)
}
