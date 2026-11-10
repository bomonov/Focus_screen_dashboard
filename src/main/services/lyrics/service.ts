import {
  AD_TRACK_ID,
  positionAt,
  type PlaybackState,
  type PlayerId,
  type Track,
  type UpNext
} from '../music/types'
import type { CachedLookup, LyricsCache } from './cache'
import { parsePlainLyrics } from './lrc'
import type { OffsetStore } from './offsets'
import { pickedLyricsKey, type LyricsPick, type PickStore } from './picks'
import type { LookupResult, LyricsProvider } from './provider'
import { lyricsQuery, nearSongKeys, songKey, type LyricsQuery } from './query'
import { keepOrReplace } from './recheck'
import { alignRomaji, pairRomaji, wantsRomaji } from './romaji'
import type { RomajiStore } from './romajiStore'
import type { MadeRomajiStore } from './madeRomaji/store'
import { colorLyrics } from './singers/apply'
import type { SongColorsStore } from './singers/store'
import type { SongColors } from './singers/types'
import {
  canAutoSync,
  NO_LYRICS,
  OFFSET_STEP_SEC,
  type Lyrics,
  type LyricsCommand,
  type LyricsState,
  type RomajiSource,
  type SyncedLine
} from './types'
import type { RomajiLookup } from './vocadb'
import type { LyricsVersion } from './versions'

/**
 * Skipping through songs shouldn't ask LRCLIB about each one, and players fill in metadata
 * (album, duration) a moment after the title: look up once the song has settled.
 */
const SETTLE_MS = 800
/** While LRCLIB can't be reached, ask again this often for the song on screen. */
const RETRY_MS = 60_000
/**
 * A hiccup (a site answering 503 a few times, or slowly) usually passes within seconds, so the
 * first tries again come sooner: a minute of "can't reach the lyrics sites" was mostly that.
 * They're cheap: LRCLIB's provider remembers what it was already told, and only asks the rest.
 */
const FIRST_RETRIES_MS = [5_000, 15_000, 30_000]

export interface LyricsService {
  get(): LyricsState
  command(command: Exclude<LyricsCommand, { kind: 'setVisible' | 'setAlbumInk' }>): void
  /** Hidden lyrics are never looked up. */
  setVisible(on: boolean): void
  /** Romaji under Japanese lyrics (Customize › Music). */
  setRomaji(on: boolean): void
  subscribe(listener: (state: LyricsState) => void): () => void
  /** The song on screen's key (as the cache and offsets know it); null without a song. */
  currentKey(): string | null
  /** Timings were just worked out for `key`: shows them now if that song is still on. */
  refreshAutoSynced(key: string): void
  /**
   * The user's pick for the song on screen, from "Pick Other Lyrics…" (`version` the picked
   * one, so it shows at once); null goes back to automatic. Clears the song's timing fix.
   */
  pick(pick: LyricsPick | null, version?: LyricsVersion): void
  /** The song on screen, for the picker; null without one. */
  currentSong(): { key: string; trackId: string; query: LyricsQuery; cacheable: boolean } | null
  /**
   * The singer coding laid over the song on screen, as it was given (saved, or the demo's own),
   * for the color-coding editor to start from; null when it has none.
   */
  currentCoding(): SongColors | null
  dispose(): void
}

export interface LyricsServiceOptions {
  music: {
    get(): PlaybackState
    subscribe(listener: (state: PlaybackState) => void): () => void
  }
  visible: boolean
  /** LRCLIB, then VocaDB, for real players; built-in lyrics for the dev demo player. */
  providerFor(player: PlayerId): LyricsProvider
  cache: LyricsCache
  offsets: OffsetStore
  /** Timings worked out on this Mac for lyrics that only came as plain text. */
  autoSynced?: { read(key: string, plain: readonly string[]): SyncedLine[] | null }
  /**
   * Lyrics YouTube Music showed in its Lyrics tab (read by the extension), by song id: for songs
   * neither LRCLIB nor VocaDB has.
   */
  pageLyrics?: {
    get(trackId: string): { text: string; credit: string | null } | null
    subscribe(listener: (trackId: string) => void): () => void
  }
  /** Romaji for Japanese lyrics: saved per song, asked of VocaDB (title only) the first time. */
  romaji?: {
    store: RomajiStore
    lookUp(query: LyricsQuery): Promise<RomajiLookup>
    enabled: boolean
    /** Romaji made from a dictionary, for the lines VocaDB has none for (or songs it hasn't got). */
    made?: MadeRomaji
  }
  /** The user's singer coloring, saved per song; the song on screen is shown again when it changes. */
  colors?: SongColorsStore
  /** The user's picks, which win over the automatic choice. */
  picks?: PickStore
  /** A picked version fetched again (LRCLIB's `/api/get/{id}`), when its saved lyrics are gone. */
  fetchVersion?(
    id: number
  ): Promise<
    { kind: 'found'; version: LyricsVersion } | { kind: 'notFound' } | { kind: 'unavailable' }
  >
  settleMs?: number
  retryMs?: number
}

/**
 * The next song's lyrics are looked up this long before it starts, so they're there the moment
 * it does: a lookup can take several seconds when LRCLIB is busy.
 */
const PREFETCH_LEAD_SEC = 60
/** Songs looked up ahead this run; enough to never ask twice for a queue's worth. */
const MAX_PREFETCHED = 100

/**
 * The cache under the song's key, or a second either side: the queue gives a song's length in
 * whole seconds, and the player then reports it to the millisecond, which can round the other
 * way. The same artist and title within a second is the same recording.
 */
function readNear(cache: LyricsCache, query: LyricsQuery): CachedLookup | null {
  return savedNear(cache, query)?.result ?? null
}

/** As `readNear`, with the key it was saved under (a re-check writes back there). */
function savedNear(
  cache: LyricsCache,
  query: LyricsQuery
): { key: string; result: CachedLookup } | null {
  const key = songKey(query)
  const exact = cache.read(key)
  if (exact) return { key, result: exact }
  if (query.durationSec <= 0) return null
  const rounded = Math.round(query.durationSec)
  for (const durationSec of [rounded - 1, rounded + 1]) {
    const nearKey = songKey({ ...query, durationSec })
    const near = cache.read(nearKey)
    if (near) return { key: nearKey, result: near }
  }
  return null
}

/** The song on screen, as far as lyrics care. */
interface Song {
  /** Changes with the player, the track, or the metadata we'd send. */
  identity: string
  trackId: string
  key: string
  query: LyricsQuery
  provider: LyricsProvider
}

/** Plain lyrics (LRCLIB's or VocaDB's) with timings from `autoSynced` when there are some for them. */
function withAutoSync(
  key: string,
  result: CachedLookup,
  autoSynced: LyricsServiceOptions['autoSynced']
): CachedLookup {
  if (result.kind !== 'found' || result.lyrics.kind !== 'plain') return result
  const { source } = result.lyrics
  if (!canAutoSync(source)) return result
  const lines = autoSynced?.read(key, result.lyrics.lines)
  if (!lines) return result
  const credit =
    source === 'vocadb' || source === 'ytmusic'
      ? { wordsFrom: source, ...(result.lyrics.credit ? { credit: result.lyrics.credit } : {}) }
      : {}
  return {
    kind: 'found',
    lyrics: { kind: 'synced', lines, source: 'autosync', ...credit, plain: result.lyrics.lines }
  }
}

/** Lyrics as words only, for auto-sync to time ("Time them by listening"). */
function asWords(lyrics: Lyrics): Lyrics {
  if (lyrics.kind !== 'synced') return lyrics
  const timedHere = lyrics.source === 'autosync'
  const source = timedHere ? (lyrics.wordsFrom ?? 'lrclib') : lyrics.source
  const lines = timedHere && lyrics.plain ? lyrics.plain : lyrics.lines.map((line) => line.text)
  return { kind: 'plain', lines, source, ...(lyrics.from ? { from: lyrics.from } : {}) }
}

// Every full state spells out `colors` (null for none), so a publish built over an older state
// never keeps its singers.
function stateFor(trackId: string, result: CachedLookup, offsetSec: number): LyricsState {
  return result.kind === 'found'
    ? { trackId, status: 'found', lyrics: result.lyrics, offsetSec, romaji: null, colors: null }
    : { trackId, status: 'notFound', lyrics: null, offsetSec, romaji: null, colors: null }
}

interface MadeRomaji {
  store: MadeRomajiStore
  /** One entry per line: '' for one with no Japanese, null for one it can't read; null if none. */
  make(lines: readonly string[]): Promise<(string | null)[] | null>
}

type RomajiPart = Pick<LyricsState, 'romaji' | 'romajiFrom'>
// romajiFrom spelled out, so a publish over an older state never keeps its credit.
const NO_ROMAJI: RomajiPart = { romaji: null, romajiFrom: undefined }
const MADE_LATELY = 20
const JAPANESE_LINE = /[ぁ-ゖァ-ヺ\u3400-\u9fff々\u{20000}-\u{3FFFF}]/u

/** VocaDB's romaji where it has a line's, the dictionary's where it hasn't, and whose that is. */
function combineRomaji(
  lines: readonly string[],
  theirs: readonly string[] | null,
  ours: readonly (string | null)[] | null
): RomajiPart {
  let fromVocadb = 0
  let fromDictionary = 0
  const romaji = lines.map((_, i) => {
    const vocadb = theirs?.[i]
    if (vocadb) {
      fromVocadb++
      return vocadb
    }
    const made = ours?.[i]
    if (made) fromDictionary++
    return made || ''
  })
  if (fromVocadb + fromDictionary === 0) return NO_ROMAJI
  const romajiFrom: RomajiSource =
    fromDictionary === 0 ? 'vocadb' : fromVocadb === 0 ? 'dictionary' : 'both'
  return { romaji, romajiFrom }
}

/** The text of each line, as shown. */
function lineTexts(lyrics: Lyrics | null): string[] | null {
  if (lyrics?.kind === 'synced') return lyrics.lines.map((line) => line.text)
  return lyrics?.kind === 'plain' ? lyrics.lines : null
}

export function createLyricsService({
  music,
  visible: initiallyVisible,
  providerFor,
  cache,
  offsets,
  autoSynced,
  pageLyrics,
  romaji,
  colors: songColors,
  picks,
  fetchVersion,
  settleMs = SETTLE_MS,
  retryMs = RETRY_MS
}: LyricsServiceOptions): LyricsService {
  let visible = initiallyVisible
  let song: Song | null = null
  let state: LyricsState = NO_LYRICS
  /** Bumped on every song change, so a slow answer for the last song is dropped. */
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const listeners = new Set<(state: LyricsState) => void>()
  let romajiOn = romaji?.enabled ?? false
  /** Songs whose romaji VocaDB is being asked for, so none is asked twice at once. */
  const askingRomaji = new Set<string>()
  /** The song VocaDB couldn't be reached for, as it plays: it's asked again the next time. */
  let vocadbDownFor: string | null = null
  /** Songs (and their lines) whose romaji is being made, so none is made twice at once. */
  const makingRomaji = new Set<string>()
  /**
   * The romaji made lately, by song and lines, in case it couldn't be saved (a full disk):
   * otherwise showing it would only ask for it again, and again.
   */
  const madeLately = new Map<string, (string | null)[]>()
  let prefetchTimer: ReturnType<typeof setTimeout> | undefined
  /** Next songs already looked up ahead (by song key), so none is asked about twice. */
  const prefetched = new Set<string>()
  /**
   * The lookup result on screen, as `present` was given it (before auto-sync and the singers'
   * coloring changed it), so a coding saved now is laid over that, not over the colored lyrics
   * already shown. Kept only for the song it's for (its `identity`), with the coding laid over it.
   */
  let shown: { identity: string; result: CachedLookup; coding: SongColors | null } | null = null

  function publish(next: LyricsState): void {
    if (JSON.stringify(next) === JSON.stringify(state)) return
    state = next
    for (const listener of listeners) listener(state)
  }

  /**
   * Romaji under `lyrics`' lines from what's saved; asks VocaDB when nothing is yet, and has the
   * lines it has none for made from a dictionary once it has answered (people's romaji first).
   */
  function romajiFor(target: Song, lyrics: Lyrics | null): RomajiPart {
    const lines = lineTexts(lyrics)
    // The demo's songs are made up: VocaDB would never have them, so they bring their own.
    if (!target.provider.cacheable) {
      const own = romajiOn && lines ? (target.provider.romaji?.(target.query, lines) ?? null) : null
      return { romaji: own, romajiFrom: undefined }
    }
    if (!romaji || !romajiOn || !lines || !wantsRomaji(lines)) return NO_ROMAJI
    const saved = romaji.store.read(target.key)
    const down = vocadbDownFor === target.key
    if (!saved && !down) askRomaji(target, romaji)
    const pairs = saved?.kind === 'found' ? pairRomaji(saved.original, saved.romanized) : null
    const theirs = pairs ? alignRomaji(lines, pairs) : null
    const missing = lines.some((line, i) => JAPANESE_LINE.test(line) && !theirs?.[i])
    const ours =
      romaji.made && (saved || down) && missing ? madeFor(target, lines, romaji.made) : null
    return combineRomaji(lines, theirs, ours)
  }

  /** Romaji made for these lines before, or null while it's being made. */
  function madeFor(target: Song, lines: string[], made: MadeRomaji): (string | null)[] | null {
    const asking = `${target.key}\n${lines.join('\n')}`
    const kept = made.store.read(target.key, lines) ?? madeLately.get(asking)
    if (kept) return kept
    if (makingRomaji.has(asking)) return null
    makingRomaji.add(asking)
    made
      .make(lines)
      .catch((error: unknown) => {
        console.warn('[lyrics] Making romaji failed.', error)
        return null
      })
      .then((romajiLines) => {
        makingRomaji.delete(asking)
        if (!romajiLines) return
        made.store.write(target.key, lines, romajiLines)
        madeLately.set(asking, romajiLines)
        const oldest = madeLately.keys().next().value
        if (madeLately.size > MADE_LATELY && oldest !== undefined) madeLately.delete(oldest)
        if (disposed || !song || song.key !== target.key) return
        if (state.trackId !== song.trackId || state.status !== 'found') return
        if (lineTexts(state.lyrics)?.join('\n') !== lines.join('\n')) return
        publish({ ...state, ...romajiFor(song, state.lyrics) })
      })
    return null
  }

  function askRomaji(target: Song, source: NonNullable<LyricsServiceOptions['romaji']>): void {
    if (askingRomaji.has(target.key)) return
    askingRomaji.add(target.key)
    source
      .lookUp(target.query)
      .catch((error: unknown): RomajiLookup => {
        console.warn('[lyrics] Romaji lookup failed.', error)
        return { kind: 'unavailable' }
      })
      .then((result) => {
        askingRomaji.delete(target.key)
        if (disposed || !song || song.key !== target.key) {
          if (result.kind !== 'unavailable') source.store.write(target.key, result)
          return
        }
        if (result.kind === 'unavailable') {
          // Asked again the next time the song comes up (without a maker, whenever its romaji
          // is next worked out); made from the dictionary meanwhile.
          if (!source.made) return
          vocadbDownFor = target.key
        } else source.store.write(target.key, result)
        if (state.trackId !== song.trackId || state.status !== 'found') return
        publish({ ...state, ...romajiFor(song, state.lyrics) })
      })
  }

  const pickFor = (target: Song): LyricsPick | null =>
    target.provider.cacheable ? (picks?.get(target.key) ?? null) : null

  const noLyrics = (target: Song, offsetSec: number): LyricsState => ({
    trackId: target.trackId,
    status: 'notFound',
    lyrics: null,
    offsetSec,
    romaji: null,
    colors: null
  })

  /**
   * A picked version: its own save (`pickedLyricsKey`, under the song at either length), else
   * what's saved for the song (or none) only while LRCLIB is asked for it again.
   */
  function showPicked(target: Song, id: number, offsetSec: number): void {
    for (const near of nearSongKeys(target.key)) {
      const picked = cache.read(pickedLyricsKey(near, id))
      if (picked?.kind === 'found') {
        publish(present(target, picked, offsetSec))
        return
      }
    }
    const saved = savedNear(cache, target.query)?.result
    const has = saved?.kind === 'found' ? saved : null
    publish(has ? present(target, has, offsetSec) : noLyrics(target, offsetSec))
    if (!fetchVersion) return
    const mine = generation
    fetchVersion(id)
      .then((result) => {
        if (result.kind !== 'found') return
        const found: CachedLookup = { kind: 'found', lyrics: result.version.lyrics }
        cache.write(pickedLyricsKey(target.key, id), found)
        if (!disposed && mine === generation) publish(present(target, found, state.offsetSec))
      })
      .catch((error: unknown) => {
        console.warn('[lyrics] Fetching the picked lyrics failed.', error)
      })
  }

  /** YouTube Music's own words for the song, if it showed some: they fill in for nobody else's. */
  function fromPage(target: Song): CachedLookup | null {
    const page = pageLyrics?.get(target.trackId)
    const lines = page ? parsePlainLyrics(page.text) : null
    if (!page || !lines) return null
    const credit = page.credit ? { credit: page.credit } : {}
    return { kind: 'found', lyrics: { kind: 'plain', lines, source: 'ytmusic', ...credit } }
  }

  /**
   * The song's coding: the user's, saved, for every song, the demo's too (so its coding can be
   * edited like any); else the one the demo's songs bring with them.
   */
  function codingFor(target: Song): SongColors | null {
    return songColors?.read(target.key) ?? target.provider.colors?.(target.query) ?? null
  }

  /**
   * Found (or not) lyrics as the screen gets them: timed by auto-sync, in the singers' colors
   * and times if the user colored the song, romaji underneath.
   */
  function present(target: Song, result: CachedLookup, offsetSec: number): LyricsState {
    const words =
      result.kind === 'found' && pickFor(target)?.kind === 'listen'
        ? { kind: 'found' as const, lyrics: asWords(result.lyrics) }
        : result
    const next = stateFor(target.trackId, withAutoSync(target.key, words, autoSynced), offsetSec)
    const coding = next.lyrics ? codingFor(target) : null
    shown = { identity: target.identity, result, coding }
    const colored = next.lyrics && coding ? colorLyrics(next.lyrics, coding) : null
    // Coloring can add the user's lines (and a like line stands in for the lyrics' own), so the
    // romaji is made for the rows as shown; the lyrics' own rows are `colors.own`.
    const lyrics = colored?.lyrics ?? next.lyrics
    return { ...next, lyrics, colors: colored?.colors ?? null, ...romajiFor(target, lyrics) }
  }

  function songFor(player: PlayerId, track: Track): Song | null {
    if (track.id === AD_TRACK_ID) return null
    const query = lyricsQuery(track)
    if (!query) return null
    const key = songKey(query)
    return {
      identity: [player, track.id, key, query.title, query.artist, query.album].join('\n'),
      trackId: track.id,
      key,
      query,
      provider: providerFor(player)
    }
  }

  function follow(playback: PlaybackState): void {
    const next =
      visible && playback.player && playback.track
        ? songFor(playback.player.id, playback.track)
        : null
    if (next?.identity === song?.identity) return
    song = next
    shown = null
    generation += 1
    vocadbDownFor = null
    clearTimeout(timer)
    if (!next) {
      publish(NO_LYRICS)
      return
    }
    const offsetSec = offsets.get(next.key)
    const picked = pickFor(next)
    if (picked?.kind === 'none') {
      publish(noLyrics(next, offsetSec))
      return
    }
    if (picked?.kind === 'version') {
      showPicked(next, picked.id, offsetSec)
      return
    }
    const saved = next.provider.cacheable ? savedNear(cache, next.query) : null
    const cached = saved?.result ?? null
    if (saved && cached) {
      const page = cached.kind === 'notFound' ? fromPage(next) : null
      if (page) cache.write(next.key, page)
      publish(present(next, page ?? cached, offsetSec))
      // Auto-sync's timings came from the user's own recording: no version beats those. They're
      // kept under the length the song played at, which may not be where its save sits.
      const timed = [next.key, saved.key].some(
        (at) => withAutoSync(at, cached, autoSynced) !== cached
      )
      if (!picked && !page && !timed && cached.kind === 'found' && cache.needsRecheck(saved.key)) {
        const mine = generation
        timer = setTimeout(() => void recheck(next, cached.lyrics, saved.key, mine), settleMs)
      }
      return
    }
    // A player filling in the album for the same song keeps its lyrics up while we re-check.
    const refining = state.trackId === next.trackId && state.status === 'found'
    if (!refining) {
      publish({
        trackId: next.trackId,
        status: 'loading',
        lyrics: null,
        offsetSec,
        romaji: null,
        colors: null
      })
    }
    const mine = generation
    timer = setTimeout(() => void lookUp(next, mine), settleMs)
  }

  /**
   * Looks the song up next up a minute before it starts, so its lyrics are cached by then. Its
   * metadata goes to LRCLIB (and VocaDB) a little early, even if it ends up skipped.
   */
  function planPrefetch(playback: PlaybackState): void {
    clearTimeout(prefetchTimer)
    const { player, track, next } = playback
    if (!visible || !playback.playing || !player || !track || !next || track.durationSec <= 0) {
      return
    }
    const left = track.durationSec - positionAt(playback, Date.now() / 1000)
    const wait = Math.max(0, left - PREFETCH_LEAD_SEC)
    prefetchTimer = setTimeout(() => prefetch(player.id, next), wait * 1000)
  }

  function prefetch(player: PlayerId, next: UpNext): void {
    const track = { id: 'up-next', album: '', ...next, artwork: null }
    const target = songFor(player, track)
    if (!target || !target.provider.cacheable || prefetched.has(target.key)) return
    if (readNear(cache, target.query)) return
    prefetched.add(target.key)
    if (prefetched.size > MAX_PREFETCHED) {
      const oldest = prefetched.values().next().value
      if (oldest !== undefined) prefetched.delete(oldest)
    }
    target.provider
      .lookup(target.query)
      .then((result) => {
        if (result.kind === 'found' || result.kind === 'notFound') cache.write(target.key, result)
      })
      .catch((error: unknown) => {
        console.warn('[lyrics] Looking up the next song failed.', error)
      })
  }

  async function lookUp(target: Song, mine: number, attempt = 0): Promise<void> {
    let result: LookupResult
    try {
      result = await target.provider.lookup(target.query)
    } catch (error) {
      console.warn('[lyrics] Lookup failed.', error)
      result = { kind: 'unavailable' }
    }
    // Nobody had the song, or nobody could be asked: YouTube Music's own words, if it showed them.
    if (result.kind === 'notFound' || result.kind === 'unavailable') {
      result = fromPage(target) ?? result
    }
    // Saved even when the user has moved on: the song is likely to come round again.
    if (target.provider.cacheable && (result.kind === 'found' || result.kind === 'notFound')) {
      cache.write(target.key, result)
    }
    if (disposed || mine !== generation) return
    if (result.kind === 'unavailable' || result.kind === 'interim') {
      // Stand-in words show meanwhile; the song is asked about again either way.
      publish(
        result.kind === 'interim'
          ? present(target, { kind: 'found', lyrics: result.lyrics }, state.offsetSec)
          : { ...state, status: 'unavailable', lyrics: null, ...NO_ROMAJI, colors: null }
      )
      const wait = Math.min(FIRST_RETRIES_MS[attempt] ?? retryMs, retryMs)
      timer = setTimeout(() => void lookUp(target, mine, attempt + 1), wait)
      return
    }
    publish(present(target, result, state.offsetSec))
  }

  /**
   * One more look for lyrics an older lookup saved, shown meanwhile: they're swapped only for
   * the singers' own version (`keepOrReplace`), and kept when LRCLIB has no better or can't be
   * reached (asked again next time, then).
   */
  async function recheck(target: Song, old: Lyrics, savedKey: string, mine: number): Promise<void> {
    let result: LookupResult
    try {
      result = await target.provider.lookup(target.query)
    } catch (error) {
      console.warn('[lyrics] Re-check failed.', error)
      return
    }
    if (result.kind === 'unavailable' || result.kind === 'interim') return
    if (result.kind === 'found' && keepOrReplace(old, result, false) === 'replace') {
      cache.write(savedKey, { kind: 'found', lyrics: result.lyrics })
      // The timing fix was for the other version.
      offsets.set(target.key, 0)
      if (!disposed && mine === generation) publish(present(target, result, 0))
      return
    }
    cache.write(savedKey, { kind: 'found', lyrics: old })
  }

  function setOffset(offsetSec: number): void {
    if (!song) return
    offsets.set(song.key, offsetSec)
    publish({ ...state, offsetSec: offsets.get(song.key) })
  }

  const unsubscribe = music.subscribe((playback) => {
    follow(playback)
    planPrefetch(playback)
  })
  // YouTube Music's words arrive once its Lyrics tab shows them: maybe after "no lyrics found".
  const unsubscribePage = pageLyrics?.subscribe((trackId) => {
    if (!song || song.trackId !== trackId || state.trackId !== trackId) return
    // A lookup still running checks for them itself; found lyrics stay.
    if (state.status !== 'notFound' && state.status !== 'unavailable') return
    const page = fromPage(song)
    if (!page) return
    if (song.provider.cacheable) cache.write(song.key, page)
    publish(present(song, page, state.offsetSec))
  })
  // Colors saved (or removed) for the song on screen, or the same song a second away: shown at
  // once, over the lyrics already found, without asking anyone for them again.
  const unsubscribeColors = songColors?.subscribe((key) => {
    if (!song || shown?.identity !== song.identity) return
    if (state.trackId !== song.trackId || state.status !== 'found') return
    if (!nearSongKeys(song.key).includes(key)) return
    publish(present(song, shown.result, state.offsetSec))
  })
  follow(music.get())
  planPrefetch(music.get())

  return {
    get: () => state,
    command(command) {
      switch (command.kind) {
        case 'nudgeOffset':
          setOffset(state.offsetSec + (command.direction === 'earlier' ? 1 : -1) * OFFSET_STEP_SEC)
          break
        case 'resetOffset':
          setOffset(0)
          break
      }
    },
    setVisible(on) {
      if (on === visible) return
      visible = on
      follow(music.get())
      planPrefetch(music.get())
    },
    setRomaji(on) {
      if (on === romajiOn) return
      romajiOn = on
      if (!song || state.trackId !== song.trackId || state.status !== 'found') return
      publish({ ...state, ...romajiFor(song, state.lyrics) })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    currentKey: () => song?.key ?? null,
    currentCoding: () => (song && shown?.identity === song.identity ? shown.coding : null),
    currentSong: () =>
      song
        ? {
            key: song.key,
            trackId: song.trackId,
            query: song.query,
            cacheable: song.provider.cacheable
          }
        : null,
    pick(choice, version) {
      if (!song || !song.provider.cacheable || !picks) return
      const target = song
      picks.set(target.key, choice)
      // The timing fix was for what showed before.
      offsets.set(target.key, 0)
      // Its own save: the song's automatic one stays as it was, for Back to automatic.
      if (choice?.kind === 'version' && version?.id === choice.id) {
        cache.write(pickedLyricsKey(target.key, choice.id), {
          kind: 'found',
          lyrics: version.lyrics
        })
      }
      // The same song again, with the pick or (null) as automatic: its save at once, if any.
      // Anything still on its way for it (a lookup, a re-check) is for another generation.
      song = null
      follow(music.get())
    },
    refreshAutoSynced(key) {
      if (!song || song.key !== key || state.trackId !== song.trackId || !state.lyrics) return
      // From the lookup, not the lyrics on screen: those may already be in the singers' times.
      const result: CachedLookup =
        shown?.identity === song.identity ? shown.result : { kind: 'found', lyrics: state.lyrics }
      publish(present(song, result, state.offsetSec))
    },
    dispose() {
      disposed = true
      clearTimeout(timer)
      clearTimeout(prefetchTimer)
      unsubscribe()
      unsubscribePage?.()
      unsubscribeColors?.()
      listeners.clear()
    }
  }
}
