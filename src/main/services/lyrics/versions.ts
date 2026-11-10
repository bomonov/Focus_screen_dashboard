// One LRCLIB version of a song, as the lookup and the picker see it, and telling two apart.
import type { Credit } from './match'
import type { Lyrics } from './types'

/** One record of a song on LRCLIB, ready to show. */
export interface LyricsVersion {
  id: number
  title: string
  artist: string
  album: string
  durationSec: number
  /** The singers', another name VocaDB has for the song, or neither (only the picker lists those). */
  credit: Credit | null
  lyrics: Lyrics
}

/** Line timings this close are the same version saved twice (LRCLIB rounds to the hundredth). */
const SAME_TIME_SEC = 0.05

/** The same lyrics: same kind, same words line by line, and (timed) the same timings. */
export function sameLyrics(a: Lyrics, b: Lyrics): boolean {
  if (a.kind === 'instrumental' || b.kind === 'instrumental') return a.kind === b.kind
  if (a.kind !== b.kind || a.lines.length !== b.lines.length) return false
  if (a.kind === 'plain' && b.kind === 'plain')
    return a.lines.every((line, i) => line === b.lines[i])
  if (a.kind !== 'synced' || b.kind !== 'synced') return false
  return a.lines.every((line, i) => {
    const other = b.lines[i]
    return (
      other !== undefined &&
      line.text === other.text &&
      Math.abs(line.timeSec - other.timeSec) <= SAME_TIME_SEC
    )
  })
}
