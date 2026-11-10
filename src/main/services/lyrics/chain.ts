import type { LrclibProvider, SongNames, VersionById, VersionsResult } from './lrclib'
import type { LookupResult, LyricsProvider } from './provider'
import { songKey, type LyricsQuery } from './query'
import type { Vocadb, VocadbSong } from './vocadb'

/** Real songs' lyrics, and the versions of a song to pick from by hand. */
export type SongLyrics = LyricsProvider & {
  /** LRCLIB's versions of the song, under VocaDB's names for it too when VocaDB knows it. */
  versions(query: LyricsQuery): Promise<VersionsResult>
  /** LRCLIB searched for the words the user typed. */
  search(query: LyricsQuery, text: string): Promise<VersionsResult>
  /** One LRCLIB version by its id. */
  byId(id: number): Promise<VersionById>
}

function namesOf(song: VocadbSong): SongNames {
  return {
    titles: song.names,
    artists: song.artists,
    ...(song.artistGroups ? { artistGroups: song.artistGroups } : {})
  }
}

/**
 * VocaDB's answer for a song while LRCLIB is down, kept this long: LRCLIB is asked again within
 * seconds, and VocaDB needn't be each time.
 */
const STOPGAP_KEEP_MS = 30 * 60_000
const MAX_STOPGAPS = 50

/**
 * Where a real song's lyrics come from, best first:
 * 1. LRCLIB, under the title as the player gives it (and its credited and bare forms).
 * 2. Only when LRCLIB is sure it hasn't got it: the song on VocaDB, which knows every name it
 *    and its singers go by, so LRCLIB is asked again under those ("Literary Nonsense" by
 *    Wonderlands×Showtime is 「ナンセンス文学」 by 「ワンダーランズ×ショウタイム」). Timed lyrics from
 *    there beat VocaDB's plain words.
 * 3. VocaDB's own words.
 * While LRCLIB can't be reached, VocaDB's words stand in ("interim": shown, never cached), and
 * LRCLIB is asked again later, so an outage never leaves them saved in place of LRCLIB's.
 */
export function createSongLyrics(
  lrclib: LrclibProvider,
  vocadb: Vocadb,
  now: () => number = Date.now
): SongLyrics {
  const stopgaps = new Map<string, { at: number; result: LookupResult }>()

  /** VocaDB's words for a song LRCLIB can't be asked about right now; "unavailable" without. */
  async function stopgap(query: LyricsQuery): Promise<LookupResult> {
    const key = songKey(query)
    const kept = stopgaps.get(key)
    if (kept && now() - kept.at < STOPGAP_KEEP_MS) return kept.result
    const match = await vocadb.match(query)
    const words = match.kind === 'found' ? await vocadb.wordsOf(match.song) : match
    const result: LookupResult =
      words.kind === 'found' ? { kind: 'interim', lyrics: words.lyrics } : { kind: 'unavailable' }
    // VocaDB's own answers are kept; not being able to ask it either isn't one.
    if (words.kind !== 'unavailable') {
      stopgaps.delete(key)
      stopgaps.set(key, { at: now(), result })
      for (const [old] of stopgaps) {
        if (stopgaps.size <= MAX_STOPGAPS) break
        stopgaps.delete(old)
      }
    }
    return result
  }

  return {
    cacheable: true,
    async lookup(query) {
      const first = await lrclib.lookup(query)
      if (first.kind === 'unavailable') return stopgap(query)
      if (first.kind !== 'notFound') return first
      const match = await vocadb.match(query)
      if (match.kind !== 'found') return match
      const renamed = await lrclib.lookupAs(query, namesOf(match.song))
      // Timed lyrics, or the singers' own words even untimed (the user's call: another name's
      // timing can be completely off for this recording), beat VocaDB's plain words.
      if (
        renamed.kind === 'found' &&
        (renamed.lyrics.kind === 'synced' || renamed.lyrics.from?.credit === 'singers')
      ) {
        return renamed
      }
      const words = await vocadb.wordsOf(match.song)
      // VocaDB had no words of its own, but LRCLIB had some under another name.
      return words.kind !== 'found' && renamed.kind === 'found' ? renamed : words
    },
    // VocaDB hears the title only, as it does for a lookup (asked for the list by the user's
    // approval on 2026-10-22), so versions under the song's other names show up: アイロニ for
    // "irony". Without it, the list is what LRCLIB has under the player's own names.
    async versions(query) {
      const match = await vocadb.match(query)
      return lrclib.versions(query, match.kind === 'found' ? namesOf(match.song) : null)
    },
    search: (query, text) => lrclib.search(query, text),
    byId: (id) => lrclib.byId(id)
  }
}
