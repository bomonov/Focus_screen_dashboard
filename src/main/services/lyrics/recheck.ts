// Whether a fresh lookup's lyrics replace ones saved by an older lookup. Kept conservative on
// purpose: only another name's version is swapped, only for the singers' own, so a song that's
// right today can't turn wrong (the user's irony had scop's original saved; Nightcord's is the
// one they play).
import type { Lyrics } from './types'
import { sameLyrics, type LyricsVersion } from './versions'

/** Whom the saved lyrics are credited to: as they say, or as the version they match does. */
function creditOf(old: Lyrics, seen: readonly LyricsVersion[]): LyricsVersion['credit'] {
  if (old.from) return old.from.credit
  return seen.find((version) => sameLyrics(old, version.lyrics))?.credit ?? null
}

/**
 * `timedByListening`: auto-sync timed these words from the user's own recording, and those
 * timings are better than any version's.
 */
export function keepOrReplace(
  old: Lyrics,
  fresh: { lyrics: Lyrics; seen?: LyricsVersion[] },
  timedByListening: boolean
): 'keep' | 'replace' {
  if (timedByListening || old.source !== 'lrclib') return 'keep'
  if (fresh.lyrics.from?.credit !== 'singers' || sameLyrics(old, fresh.lyrics)) return 'keep'
  return creditOf(old, fresh.seen ?? []) === 'others' ? 'replace' : 'keep'
}
