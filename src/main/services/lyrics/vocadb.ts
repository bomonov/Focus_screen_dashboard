import type { JsonResponse } from '../http'
import { parsePlainLyrics } from './lrc'
import type { FetchJson } from './lrclib'
import { artistScore, MIN_ARTIST, MIN_TITLE, titleScore } from './match'
import type { LookupResult, LyricsProvider } from './provider'
import { OPEN_BRACKET, quotedTitle, type LyricsQuery } from './query'
import { normalize } from './text'

const API = 'https://vocadb.net/api/'
/** A search page of up to 50 songs with their names and artists; lyrics come one song at a time. */
export const VOCADB_MAX_BYTES = 1024 * 1024
export const VOCADB_TIMEOUT_MS = 10_000
const SEARCH_RESULTS = 20
/** Without the favourites order the song may sit further down, so the unsorted search reads more. */
const UNSORTED_RESULTS = 50
/** A cover or remix without its own lyrics points at the song it's based on; follow that far. */
const MAX_HOPS = 2
/**
 * VocaDB lists vocal-synth characters and producers, while a player may credit a unit or a
 * channel, so a title plus a length this close also counts as the same song.
 */
const LENGTH_TOLERANCE_SEC = 3
const DEFAULT_PAUSE_SEC = 60
const MAX_PAUSE_SEC = 15 * 60
const MAX_LYRICS_CHARS = 100_000
/** Plenty for a real entry; caps what a malformed one can make us compare. */
const MAX_NAMES = 50
/** Artists who sing or make the song, not the video's animators or illustrators. */
const CREDITED = new Set(['Producer', 'Vocalist', 'Circle', 'Band'])

/** One VocaDB song from a search, with every name it and its artists go by. */
export interface VocadbSong {
  id: number
  names: string[]
  artists: string[]
  /** The same names, each credited artist's together: the player's singers among them can then be told from the rest (`SongNames.artistGroups`). */
  artistGroups?: string[][]
  songType: string
  /** 0 when unknown. */
  lengthSec: number
}

class RateLimited extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 500).trim() : ''
}

function songId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function errorName(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error'
  return `${error.name}: ${error.message.replace(/https?:\/\/\S+/g, '…')}`
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value !== ''))].slice(0, MAX_NAMES)
}

/** `additionalNames` is one comma-separated string ("しゅどう, Chat noir"). */
function artistNames(raw: unknown): string[] {
  if (!isRecord(raw)) return []
  const categories = text(raw.categories).split(/\s*,\s*/)
  if (!categories.some((category) => CREDITED.has(category))) return []
  const artist = isRecord(raw.artist) ? raw.artist : {}
  return [text(raw.name), text(artist.name), ...text(artist.additionalNames).split(/\s*,\s*/)]
}

/** One song from VocaDB's search. It's input from the network: anything off-shape is null. */
export function parseVocadbSong(raw: unknown): VocadbSong | null {
  if (!isRecord(raw)) return null
  const id = songId(raw.id)
  const name = text(raw.name)
  if (id === null || !name) return null
  const names = Array.isArray(raw.names)
    ? raw.names.map((entry: unknown) => (isRecord(entry) ? text(entry.value) : ''))
    : []
  const groups = Array.isArray(raw.artists)
    ? raw.artists
        .map((artist: unknown) => unique(artistNames(artist)))
        .filter((group) => group.length > 0)
    : []
  const length = raw.lengthSeconds
  return {
    id,
    names: unique([name, text(raw.defaultName), ...names]),
    artists: unique([text(raw.artistString), ...groups.flat()]),
    artistGroups: groups,
    songType: text(raw.songType),
    lengthSec: typeof length === 'number' && Number.isFinite(length) && length > 0 ? length : 0
  }
}

/** The first non-empty lyrics entry of one kind ("Original", "Romanized"). */
function lyricsEntry(entries: unknown[], translationType: string): string | null {
  for (const entry of entries) {
    if (!isRecord(entry) || entry.translationType !== translationType) continue
    const value = typeof entry.value === 'string' ? entry.value.trim() : ''
    if (value !== '') return value.slice(0, MAX_LYRICS_CHARS)
  }
  return null
}

/**
 * A song's own lyrics in the language it's sung in (VocaDB's "Original" entry), their
 * romanization (shown under Japanese lines, never in their place: it isn't what's sung), and
 * the song it's based on. Translations are never used. Romanizations are picked by type, not
 * by language code, which VocaDB sometimes gets wrong.
 */
export function parseVocadbLyrics(raw: unknown): {
  original: string | null
  romanized: string | null
  basedOn: number | null
} {
  if (!isRecord(raw)) return { original: null, romanized: null, basedOn: null }
  const entries: unknown[] = Array.isArray(raw.lyrics) ? raw.lyrics : []
  return {
    original: lyricsEntry(entries, 'Original'),
    romanized: lyricsEntry(entries, 'Romanized'),
    basedOn: songId(raw.originalVersionId)
  }
}

/** Brackets of either width, and the lenticular ones Japanese titles use. */
const CREDITS = /\s*[(（[［【〔][^)）\]］】〕]*[)）\]］】〕]/g
/** "Song / Singer × Singer", "Song - Singer". */
const CREDIT_SEPARATOR = /\s+[/／|｜]\s+|\s+[-–—]\s+/
/** A match on the song's name without its credits is a little weaker than on the whole title. */
const BARE_TITLE = 0.9

/**
 * The song's own name, which is all VocaDB lists: "アンチサイノウ (桃井愛莉×東雲彰人×MEIKO)",
 * "…（…）", "アンチサイノウ / 桃井愛莉 × …" and "syudou「アンチサイノウ」MV" are all "アンチサイノウ".
 * The title itself when that would leave nothing ("【Song】").
 */
export function baseTitle(title: string): string {
  const quoted = quotedTitle(title)
  if (quoted) return quoted
  const [first = ''] = title.replace(CREDITS, ' ').replace(OPEN_BRACKET, '').split(CREDIT_SEPARATOR)
  return first.replace(/\s+/g, ' ').trim() || title.trim()
}

/** How well a VocaDB song matches ours; null when it isn't ours or can't have lyrics. */
export function scoreSong(query: LyricsQuery, song: VocadbSong): number | null {
  if (song.songType === 'Instrumental' && !/\binstrumental\b/.test(normalize(query.title))) {
    return null
  }
  const base = baseTitle(query.coreTitle)
  const bare = base === query.coreTitle ? null : { ...query, title: base, coreTitle: base }
  const title = Math.max(
    0,
    ...song.names.map((name) =>
      // The song's own name without the credits counts like titleScore's bracket rule.
      Math.max(titleScore(query, name), bare ? Math.min(BARE_TITLE, titleScore(bare, name)) : 0)
    )
  )
  if (title < MIN_TITLE) return null
  const artist =
    query.artist === '' ? 0 : Math.max(0, ...song.artists.map((name) => artistScore(query, name)))
  const lengthGap =
    query.durationSec > 0 && song.lengthSec > 0
      ? Math.abs(query.durationSec - song.lengthSec)
      : null
  const lengthFits = lengthGap !== null && lengthGap <= LENGTH_TOLERANCE_SEC
  if (artist < MIN_ARTIST && !lengthFits) return null
  const lengthPoints = lengthGap === null ? 0 : lengthGap <= 2 ? 10 : lengthGap <= 5 ? 5 : 0
  // The song as first released, when a cover scores the same.
  return 50 * title + 30 * artist + lengthPoints + (song.songType === 'Original' ? 1 : 0)
}

const FAILED = Symbol('failed')

/** A Japanese song's lyrics as VocaDB has them, and their romanization, for romaji lines. */
export type RomajiLookup =
  | { kind: 'found'; original: string; romanized: string }
  | { kind: 'notFound' }
  /** Couldn't ask right now (offline, rate limited). Never saved. */
  | { kind: 'unavailable' }

/** The VocaDB song a query is, with every name it and its singers go by. */
export type VocadbMatch =
  { kind: 'found'; song: VocadbSong } | { kind: 'notFound' } | { kind: 'unavailable' }

export interface Vocadb {
  /** Plain lyrics for songs LRCLIB hasn't got: `match`, then `wordsOf` what it found. */
  lyrics: LyricsProvider
  /** Which song on VocaDB the query is. */
  match(query: LyricsQuery): Promise<VocadbMatch>
  /** A matched song's own words (or those of the song it's based on). */
  wordsOf(song: VocadbSong): Promise<LookupResult>
  /** The romanization of a Japanese song's lyrics, whoever supplied the lyrics shown. */
  romaji(query: LyricsQuery): Promise<RomajiLookup>
}

/**
 * VocaDB (vocadb.net), mostly Vocaloid and related Japanese songs: plain lyrics for songs LRCLIB
 * doesn't have, and romaji for Japanese songs. It receives the song's title, nothing else. Its
 * lyrics carry no timings, so auto-sync times them like LRCLIB's plain lyrics.
 */
export function createVocadb(
  fetchJson: FetchJson,
  now: () => number = () => Date.now() / 1000
): Vocadb {
  // Shared by both lookups: a 429 from either pauses both.
  let pausedUntil = 0

  /** The parsed body; null for 404; FAILED when VocaDB couldn't answer this one. */
  async function request(path: string, params: Record<string, string>): Promise<unknown> {
    if (now() < pausedUntil) throw new RateLimited()
    const target = new URL(path, API)
    for (const [name, value] of Object.entries(params)) target.searchParams.set(name, value)
    let response: JsonResponse
    try {
      response = await fetchJson(target.toString())
    } catch (error) {
      // The reason only: the URL would put the song in the log.
      console.warn(`[lyrics] VocaDB couldn't be reached (${errorName(error)}).`)
      return FAILED
    }
    if (response.status === 404) return null
    if (response.status === 429) {
      const wait = Math.min(response.retryAfterSec ?? DEFAULT_PAUSE_SEC, MAX_PAUSE_SEC)
      pausedUntil = now() + wait
      console.warn(`[lyrics] VocaDB asked us to slow down; waiting ${wait} s.`)
      throw new RateLimited()
    }
    if (response.status !== 200) {
      console.warn(`[lyrics] VocaDB answered ${response.status}.`)
      return FAILED
    }
    return response.body
  }

  async function search(
    query: LyricsQuery,
    nameMatchMode: 'Exact' | 'Auto',
    sort: 'FavoritedTimes' | 'None',
    maxResults: number
  ): Promise<VocadbSong | null | typeof FAILED> {
    const body = await request('songs', {
      query: baseTitle(query.coreTitle),
      nameMatchMode,
      sort,
      maxResults: String(maxResults),
      fields: 'Names,Artists',
      lang: 'Default'
    })
    if (body === FAILED) return FAILED
    const items: unknown[] = isRecord(body) && Array.isArray(body.items) ? body.items : []
    let best: { song: VocadbSong; score: number } | null = null
    for (const song of items.map(parseVocadbSong)) {
      const score = song ? scoreSong(query, song) : null
      if (song && score !== null && (!best || score > best.score)) best = { song, score }
    }
    return best?.song ?? null
  }

  /**
   * Cheapest search first. A common title has hundreds of songs, and the one someone is
   * listening to is likely popular, so they're sorted by favourites. Sorting every song whose
   * name shares a word with common words ("Brand New Day") can take VocaDB over 30 s, ending
   * in an error; the exact name answers in a fraction of a second, and the same word search
   * unsorted in seconds.
   */
  async function bestSong(query: LyricsQuery): Promise<VocadbSong | null | typeof FAILED> {
    const exact = await search(query, 'Exact', 'FavoritedTimes', SEARCH_RESULTS)
    if (exact !== null && exact !== FAILED) return exact
    const words = await search(query, 'Auto', 'FavoritedTimes', SEARCH_RESULTS)
    if (words !== FAILED) return words
    return search(query, 'Auto', 'None', UNSORTED_RESULTS)
  }

  /**
   * The first entry, from the song's own on to the song it's based on, that has `want`: its
   * own lyrics, or (for romaji) its lyrics and their romanization, which must come together.
   */
  async function lyricsOf<T>(
    id: number,
    want: (lyrics: ReturnType<typeof parseVocadbLyrics>) => T | null
  ): Promise<T | null | typeof FAILED> {
    let next: number | null = id
    for (let hop = 0; next !== null && hop <= MAX_HOPS; hop++) {
      const body = await request(`songs/${next}`, { fields: 'Lyrics' })
      if (body === FAILED) return FAILED
      const lyrics = parseVocadbLyrics(body)
      const found = want(lyrics)
      if (found !== null) return found
      next = lyrics.basedOn
    }
    return null
  }

  async function match(query: LyricsQuery): Promise<VocadbMatch> {
    try {
      const song = await bestSong(query)
      if (song === FAILED) return { kind: 'unavailable' }
      return song ? { kind: 'found', song } : { kind: 'notFound' }
    } catch (error) {
      if (error instanceof RateLimited) return { kind: 'unavailable' }
      throw error
    }
  }

  async function wordsOf(song: VocadbSong): Promise<LookupResult> {
    try {
      const original = await lyricsOf(song.id, (lyrics) => lyrics.original)
      if (original === FAILED) return { kind: 'unavailable' }
      const lines = original ? parsePlainLyrics(original) : null
      return lines
        ? { kind: 'found', lyrics: { kind: 'plain', lines, source: 'vocadb' } }
        : { kind: 'notFound' }
    } catch (error) {
      if (error instanceof RateLimited) return { kind: 'unavailable' }
      throw error
    }
  }

  async function lookup(query: LyricsQuery): Promise<LookupResult> {
    const found = await match(query)
    return found.kind === 'found' ? wordsOf(found.song) : found
  }

  async function romaji(query: LyricsQuery): Promise<RomajiLookup> {
    try {
      const song = await bestSong(query)
      if (song === FAILED) return { kind: 'unavailable' }
      if (!song) return { kind: 'notFound' }
      const found = await lyricsOf(song.id, ({ original, romanized }) =>
        original && romanized ? { original, romanized } : null
      )
      if (found === FAILED) return { kind: 'unavailable' }
      return found ? { kind: 'found', ...found } : { kind: 'notFound' }
    } catch (error) {
      if (error instanceof RateLimited) return { kind: 'unavailable' }
      throw error
    }
  }

  return { lyrics: { lookup, cacheable: true }, match, wordsOf, romaji }
}

/** VocaDB's lyrics alone (the lyrics fallback), for tests and callers that need nothing else. */
export function createVocadbProvider(
  fetchJson: FetchJson,
  now: () => number = () => Date.now() / 1000
): LyricsProvider {
  return createVocadb(fetchJson, now).lyrics
}
