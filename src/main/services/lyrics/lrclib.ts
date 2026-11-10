import type { JsonResponse } from '../http'
import {
  artistScore,
  better,
  evaluate,
  languageVersion,
  MIN_ARTIST,
  MIN_TITLE,
  recordLyrics,
  titleScore,
  type Candidate,
  type Credit,
  type LyricsRecord
} from './match'
import type { LookupResult, LyricsProvider } from './provider'
import { bareTitle, coverTitle, creditedQuery, quotedTitle, type LyricsQuery } from './query'
import { normalize } from './text'
import type { LyricsVersion } from './versions'

/** A record the lookup took, as a version of the song. */
function versionOf({ record, credit, lyrics }: Candidate): LyricsVersion {
  return {
    id: record.id,
    title: record.trackName,
    artist: record.artistName,
    album: record.albumName,
    durationSec: record.durationSec,
    credit,
    lyrics
  }
}

const API = 'https://lrclib.net/api/'
/** LRCLIB lists at most 20 per search, lyrics included; no real answer comes near this. */
export const LRCLIB_MAX_BYTES = 2 * 1024 * 1024
export const LRCLIB_TIMEOUT_MS = 10_000
/** How long to leave LRCLIB alone after it asks us to slow down without saying for how long. */
const DEFAULT_PAUSE_SEC = 60
const MAX_PAUSE_SEC = 15 * 60
const MAX_LYRICS_CHARS = 100_000

/** GETs a URL; rejects when the network fails. Injected so tests never touch LRCLIB. */
export type FetchJson = (url: string) => Promise<JsonResponse>

class RateLimited extends Error {}

function errorName(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error'
  return `${error.name}: ${error.message.replace(/https?:\/\/\S+/g, '…')}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 500) : ''
}

function lyricsText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.slice(0, MAX_LYRICS_CHARS) : null
}

/** One LRCLIB record. It's input from the network: anything off-shape is null. */
export function parseLrclibRecord(raw: unknown): LyricsRecord | null {
  if (!isRecord(raw)) return null
  const trackName = text(raw.trackName)
  if (!trackName) return null
  const duration = raw.duration
  const id = raw.id
  return {
    id: typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : 0,
    trackName,
    artistName: text(raw.artistName),
    albumName: text(raw.albumName),
    durationSec:
      typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : 0,
    instrumental: raw.instrumental === true,
    plainLyrics: lyricsText(raw.plainLyrics),
    syncedLyrics: lyricsText(raw.syncedLyrics)
  }
}

function url(endpoint: Endpoint, params: Record<string, string>): string {
  // A record by its id is a path, /api/get/{id}; the others take query parameters.
  if (endpoint === 'get-id') return new URL(`get/${params.id ?? ''}`, API).toString()
  const target = new URL(endpoint, API)
  for (const [name, value] of Object.entries(params)) target.searchParams.set(name, value)
  return target.toString()
}

/** The exact lookups want full metadata; LRCLIB matches the duration within ±2 s itself. */
function exactParams(query: LyricsQuery): Record<string, string> {
  return {
    track_name: query.title,
    artist_name: query.artist,
    ...(query.album ? { album_name: query.album } : {}),
    ...(query.durationSec > 0 ? { duration: String(Math.round(query.durationSec)) } : {})
  }
}

type Endpoint = 'get-cached' | 'search' | 'get' | 'get-id'

/** A search by title and artist, LRCLIB's own fields. */
function byFields(asked: LyricsQuery): Record<string, string> {
  return {
    track_name: asked.coreTitle,
    ...(asked.primaryArtist ? { artist_name: asked.primaryArtist } : {})
  }
}

interface Step {
  endpoint: Endpoint
  params: Record<string, string>
  /** Whether the step is still worth a request, given the best answer so far. */
  needed(best: Candidate | null): boolean
  /** What its answers are judged against, when not the query itself. */
  judgeBy?: LyricsQuery
}

const settled = (best: Candidate | null): boolean => best !== null && best.lyrics.kind !== 'plain'

/**
 * LRCLIB's own database first, where answers take well under a second: the exact record, then
 * a search by fields (which finds "街 - City" for "City", or a synced edition when the exact
 * one is plain), then free text. Last, /api/get, which also asks LRCLIB's outside sources and
 * can take seconds or fail with a 503 for that one song.
 */
/**
 * Other ways a title may be listed: "STORY / Leo/need" from a channel is "SToRY" by "Leo/need",
 * 「てらてら [VOCALOID ver.] MV」 is 「てらてら」, and syudou「アンチサイノウ」MV is 「アンチサイノウ」.
 * A bare or quoted title keeps the whole one as `title`, so its version notes ("Live") still
 * decide whether timings fit.
 */
function otherWays(query: LyricsQuery): LyricsQuery[] {
  const credited = creditedQuery(query)
  const ways: LyricsQuery[] = credited ? [credited] : []
  for (const base of [query, ...ways]) {
    const bare = bareTitle(base.coreTitle)
    if (bare !== base.coreTitle) ways.push({ ...base, coreTitle: bare })
    const quoted = quotedTitle(base.coreTitle)
    if (quoted) ways.push({ ...base, coreTitle: quoted })
  }
  const asked = new Set([`${normalize(query.coreTitle)}|${normalize(query.primaryArtist)}`])
  return ways.filter((way) => {
    const key = `${normalize(way.coreTitle)}|${normalize(way.primaryArtist)}`
    if (asked.has(key)) return false
    asked.add(key)
    return true
  })
}

/**
 * The song's title alone, judged against every artist it may be credited to. LRCLIB may name
 * the singers otherwise ("A, B" for our "A & B", or only one of them), and then every search
 * that names them finds nothing; the title alone finds the song among others called the same,
 * and the matcher tells them apart.
 */
function titleOnly(query: LyricsQuery): Step {
  const credited = creditedQuery(query)
  const core = (credited ?? query).coreTitle
  const title = quotedTitle(core) ?? bareTitle(core)
  const artist = [...new Set([query.artist, credited?.artist ?? ''].filter((name) => name))]
  return {
    endpoint: 'search',
    params: { q: title },
    needed: (best) => best === null,
    judgeBy: { ...query, coreTitle: title, artist: artist.join(', ') }
  }
}

/**
 * A cover, under the song's own title. LRCLIB lists the original, by its own artist, so only
 * the title and length can say it's the same song: within 2 s, the cover was sung over the
 * original's backing track (as 歌ってみた covers are), and the original's timing fits it.
 */
function coverStep(query: LyricsQuery, title: string): Step {
  return {
    endpoint: 'search',
    params: { q: title },
    needed: (best) => best === null,
    judgeBy: { ...query, title, coreTitle: title, artist: '', primaryArtist: '', album: '' }
  }
}

function steps(query: LyricsQuery): Step[] {
  const exact = exactParams(query)
  const always = (): boolean => true
  const nothingYet = (best: Candidate | null): boolean => best === null
  const cover = coverTitle(query.title)
  return [
    ...(query.artist ? [{ endpoint: 'get-cached' as const, params: exact, needed: always }] : []),
    // Before the searches under the cover singer's name, which LRCLIB seldom lists.
    ...(cover ? [coverStep(query, cover)] : []),
    { endpoint: 'search', params: byFields(query), needed: (best) => !settled(best) },
    ...otherWays(query).map((asked) => ({
      endpoint: 'search' as const,
      params: byFields(asked),
      needed: (best: Candidate | null) => !settled(best),
      judgeBy: asked
    })),
    ...(query.primaryArtist
      ? [
          {
            endpoint: 'search' as const,
            params: { q: `${query.primaryArtist} ${query.coreTitle}` },
            needed: nothingYet
          }
        ]
      : []),
    // Without an artist the search by fields was already by title alone; a cover's was its own.
    ...(query.artist && !cover ? [titleOnly(query)] : []),
    ...(query.artist ? [{ endpoint: 'get' as const, params: exact, needed: nothingYet }] : [])
  ]
}

const FAILED = Symbol('failed')

/**
 * LRCLIB's own database answers 503 now and then for a moment (about one request in four on a
 * bad day, sometimes three in a row), and one failed request makes a whole lookup
 * "unavailable": ask again, after these waits (or as long as LRCLIB asks), before giving up.
 */
const RETRY_DELAYS_MS = [1000, 2000, 4000]
/** All the waiting one lookup does, so a bad spell gives up in seconds rather than a minute. */
const RETRY_BUDGET_MS = 8000
/**
 * Answers are kept this long, so asking again (the retry after a lookup LRCLIB couldn't finish,
 * or the search under other names) only sends what wasn't answered yet.
 */
const ANSWER_TTL_SEC = 10 * 60
const MAX_ANSWERS = 16
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Other names for a song and its singers, from VocaDB: 「ナンセンス文学」 for "Literary Nonsense". */
export interface SongNames {
  titles: readonly string[]
  artists: readonly string[]
  /**
   * The same names, each credited artist's together, so the player's singers can be told from
   * the others: a group with a name for the player's artist is the singers, under all its names.
   */
  artistGroups?: readonly (readonly string[])[]
}

/** A song's versions on LRCLIB, best guess first, for picking one by hand. */
export type VersionsResult = { kind: 'found'; versions: LyricsVersion[] } | { kind: 'unavailable' }

/** One version fetched again by its id, for a pick whose saved lyrics are gone. */
export type VersionById =
  { kind: 'found'; version: LyricsVersion } | { kind: 'notFound' } | { kind: 'unavailable' }

export interface LrclibProvider extends LyricsProvider {
  /** Asks again under other names, after `lookup` found nothing under the player's own. */
  lookupAs(query: LyricsQuery, names: SongNames): Promise<LookupResult>
  /** Every version of the song LRCLIB lists, under the player's names and VocaDB's when given. */
  versions(query: LyricsQuery, names: SongNames | null): Promise<VersionsResult>
  /** LRCLIB searched for the words the user typed, listed the same way. */
  search(query: LyricsQuery, text: string): Promise<VersionsResult>
  /** One record by its LRCLIB id. */
  byId(id: number): Promise<VersionById>
}

/**
 * VocaDB's artist names split into the player's singers (every name of an artist the player
 * names, by any of its names) and the rest. Without groups, every name is the rest.
 */
function sortNames(query: LyricsQuery, names: SongNames): { singers: string[]; others: string[] } {
  if (!names.artistGroups) return { singers: [], others: [...names.artists] }
  const singers: string[] = []
  const others: string[] = []
  for (const group of names.artistGroups) {
    const theirs = group.some((name) => artistScore(query, name) >= MIN_ARTIST)
    ;(theirs ? singers : others).push(...group)
  }
  return { singers, others }
}

/**
 * One search each: the player's own bare title without its artist (LRCLIB may name the singers
 * otherwise), then the first couple of other names, which are what a song is mostly called.
 * `lookup` searched the player's own title just before, so that answer comes from memory.
 */
const MAX_OTHER_TITLES = 3
/** Longer typed words are no song title; the picker caps them too. */
const MAX_SEARCH_CHARS = 200

/** The player's own title, bare: a cover's is the song it sings. */
function ownTitle(query: LyricsQuery): string {
  const core = creditedQuery(query)?.coreTitle ?? query.coreTitle
  return coverTitle(query.title) ?? quotedTitle(core) ?? bareTitle(core)
}

/** Titles once each, however they're spelled, empty ones left out. */
function distinctTitles(titles: readonly string[]): string[] {
  const tried = new Set<string>()
  return titles.filter((title) => {
    const key = normalize(title)
    if (key === '' || tried.has(key)) return false
    tried.add(key)
    return true
  })
}

/** The record as LRCLIB has it, its own timings whatever its length: a pick is made knowingly. */
function listedVersion(record: LyricsRecord, credit: Credit | null): LyricsVersion | null {
  const lyrics = recordLyrics(record, true, 'lrclib')
  // Without an id it couldn't be picked, or fetched again.
  if (!lyrics || record.id <= 0) return null
  return {
    id: record.id,
    title: record.trackName,
    artist: record.artistName,
    album: record.albumName,
    durationSec: record.durationSec,
    credit,
    // Credited to neither, it still isn't the singers', which is all a re-check asks.
    lyrics: {
      ...lyrics,
      from: {
        id: record.id,
        artist: record.artistName,
        durationSec: record.durationSec,
        credit: credit ?? 'others'
      }
    }
  }
}

const CREDIT_RANK: Record<Credit | 'none', number> = { singers: 0, others: 1, none: 2 }

/**
 * The records worth listing, best guess first: the one a lookup would pick, then the singers',
 * then the original's (another name VocaDB has), then anyone's, each by how close its length is.
 * `judges` are the song as the record may be titled; with no judge it isn't the song.
 */
function listVersions(
  query: LyricsQuery,
  records: readonly LyricsRecord[],
  judgesOf: (record: LyricsRecord) => readonly LyricsQuery[]
): LyricsVersion[] {
  const ours = languageVersion(query.title, query.album)
  const listed: { version: LyricsVersion; candidate: Candidate | null }[] = []
  const ids = new Set<number>()
  for (const record of records) {
    if (ids.has(record.id)) continue
    const theirs = languageVersion(record.trackName, record.albumName)
    if (theirs && theirs !== ours) continue
    const judges = judgesOf(record).filter(
      (judge) => titleScore(judge, record.trackName) >= MIN_TITLE
    )
    if (judges.length === 0) continue
    let candidate: Candidate | null = null
    for (const judge of judges) candidate = better(candidate, evaluate(judge, record, 'lrclib'))
    const version = listedVersion(record, candidate?.credit ?? null)
    if (!version) continue
    ids.add(record.id)
    listed.push({ version, candidate })
  }
  let top: Candidate | null = null
  for (const { candidate } of listed) top = better(top, candidate)
  const gap = ({ durationSec }: LyricsVersion): number =>
    query.durationSec > 0 && durationSec > 0
      ? Math.abs(query.durationSec - durationSec)
      : Number.MAX_VALUE
  const rank = ({ version, candidate }: (typeof listed)[number]): number =>
    top !== null && candidate === top ? -1 : CREDIT_RANK[version.credit ?? 'none']
  return listed
    .sort((a, b) => rank(a) - rank(b) || gap(a.version) - gap(b.version))
    .map(({ version }) => version)
}

/**
 * LRCLIB (lrclib.net): free, keyless, and the first lyrics service Focus Screen asks (VocaDB
 * only hears about songs LRCLIB hasn't got). It receives title, artist, album and duration,
 * nothing else.
 */
export function createLrclibProvider(
  fetchJson: FetchJson,
  now: () => number = () => Date.now() / 1000,
  wait: (ms: number) => Promise<void> = sleep
): LrclibProvider {
  let pausedUntil = 0
  const answers = new Map<string, { at: number; body: unknown }>()

  function remember(target: string, body: unknown): unknown {
    answers.delete(target)
    answers.set(target, { at: now(), body })
    for (const [old] of answers) {
      if (answers.size <= MAX_ANSWERS) break
      answers.delete(old)
    }
    return body
  }

  function recalled(target: string): { body: unknown } | null {
    const kept = answers.get(target)
    if (!kept) return null
    if (now() - kept.at <= ANSWER_TTL_SEC) return kept
    answers.delete(target)
    return null
  }

  /**
   * The parsed body; null for 404 (not there); FAILED when LRCLIB couldn't answer this one.
   * `budget` is what's left of the lookup's waiting, shared by its requests.
   */
  async function request(
    endpoint: Endpoint,
    params: Record<string, string>,
    budget: { ms: number }
  ): Promise<unknown> {
    const target = url(endpoint, params)
    const kept = recalled(target)
    if (kept) return kept.body
    for (let attempt = 0; ; attempt++) {
      if (now() < pausedUntil) throw new RateLimited()
      let response: JsonResponse
      try {
        response = await fetchJson(target)
      } catch (error) {
        // The reason only: the URL would put the song in the log. Not asked again at once:
        // offline or timed out, a second later is no different.
        console.warn(`[lyrics] LRCLIB couldn't be reached (${errorName(error)}).`)
        return FAILED
      }
      if (response.status === 404) return remember(target, null)
      if (response.status === 429) {
        const pause = Math.min(response.retryAfterSec ?? DEFAULT_PAUSE_SEC, MAX_PAUSE_SEC)
        pausedUntil = now() + pause
        console.warn(`[lyrics] LRCLIB asked us to slow down; waiting ${pause} s.`)
        throw new RateLimited()
      }
      if (response.status === 200) return remember(target, response.body)
      // /api/get's outside sources fail for that one song, and asking again won't change it.
      const backoff = endpoint === 'get' ? undefined : RETRY_DELAYS_MS[attempt]
      const delay =
        backoff === undefined ? undefined : Math.max(backoff, (response.retryAfterSec ?? 0) * 1000)
      if (response.status >= 500 && delay !== undefined && delay <= budget.ms) {
        budget.ms -= delay
        await wait(delay)
        continue
      }
      // A record's id would say which song it is.
      const path = endpoint === 'get-id' ? 'get/{id}' : endpoint
      console.warn(`[lyrics] LRCLIB answered ${response.status} to /api/${path}.`)
      return FAILED
    }
  }

  /** Every record in an answer that's the song. */
  function read(query: LyricsQuery, endpoint: Endpoint, body: unknown): Candidate[] {
    const records =
      endpoint === 'search'
        ? Array.isArray(body)
          ? body.map(parseLrclibRecord)
          : []
        : [parseLrclibRecord(body)]
    return records
      .map((record) => (record ? evaluate(query, record, 'lrclib') : null))
      .filter((candidate) => candidate !== null)
  }

  async function run(query: LyricsQuery, planned: Step[]): Promise<LookupResult> {
    let best: Candidate | null = null
    const seen = new Map<string, LyricsVersion>()
    let failed = false
    const budget = { ms: RETRY_BUDGET_MS }
    try {
      for (const step of planned) {
        if (!step.needed(best)) continue
        const body = await request(step.endpoint, step.params, budget)
        if (body === FAILED) {
          // Outside sources failing doesn't make the song "unavailable": LRCLIB's own
          // database already said it hasn't got it.
          if (step.endpoint !== 'get') failed = true
          continue
        }
        for (const candidate of read(step.judgeBy ?? query, step.endpoint, body)) {
          best = better(best, candidate)
          const { record } = candidate
          const key =
            record.id > 0
              ? String(record.id)
              : `${record.artistName}|${record.trackName}|${record.durationSec}`
          if (!seen.has(key)) seen.set(key, versionOf(candidate))
        }
      }
    } catch (error) {
      if (!(error instanceof RateLimited)) throw error
      failed = true
    }
    if (best) return { kind: 'found', lyrics: best.lyrics, seen: [...seen.values()] }
    // Retried later, never cached as "not found".
    return failed ? { kind: 'unavailable' } : { kind: 'notFound' }
  }

  const lookup = (query: LyricsQuery): Promise<LookupResult> => run(query, steps(query))

  /**
   * LRCLIB by free text, without the artist (LRCLIB may name the singers otherwise): the
   * player's own bare title (a cover's, the song it sings), then the names VocaDB knows the song
   * by. Any of the singers' names counts as the artist; the player's title stays, so its version
   * notes still decide whether timings fit.
   */
  async function lookupAs(query: LyricsQuery, names: SongNames): Promise<LookupResult> {
    const titles = distinctTitles([ownTitle(query), ...names.titles])
    if (titles.length === 0) return { kind: 'notFound' }
    const judge = judgeWith(query, names)
    return run(
      query,
      titles.slice(0, MAX_OTHER_TITLES).map((title) => ({
        endpoint: 'search' as const,
        params: { q: title },
        // Another name's timed version isn't the answer yet: the singers' may be under the next title.
        needed: (best: Candidate | null) => !settled(best) || best?.credit !== 'singers',
        judgeBy: judge(title)
      }))
    )
  }

  /** The song under another title, its singers known by any of their names. */
  function judgeWith(query: LyricsQuery, names: SongNames | null): (title: string) => LyricsQuery {
    const { singers, others } = names ? sortNames(query, names) : { singers: [], others: [] }
    const artist = [...new Set([query.artist, ...singers].filter((name) => name !== ''))]
    return (title) => ({
      ...query,
      coreTitle: title,
      artist: artist.join(', '),
      otherArtists: others
    })
  }

  /** Every record in the answers to these searches, and whether any of them failed. */
  async function gather(
    searches: readonly Record<string, string>[]
  ): Promise<{ records: LyricsRecord[]; failed: boolean }> {
    const records: LyricsRecord[] = []
    let failed = false
    const budget = { ms: RETRY_BUDGET_MS }
    try {
      for (const params of searches) {
        const body = await request('search', params, budget)
        if (body === FAILED) {
          failed = true
          continue
        }
        if (!Array.isArray(body)) continue
        for (const raw of body) {
          const record = parseLrclibRecord(raw)
          if (record) records.push(record)
        }
      }
    } catch (error) {
      if (!(error instanceof RateLimited)) throw error
      failed = true
    }
    return { records, failed }
  }

  /**
   * The searches a lookup makes (by fields, the player's own title, VocaDB's names), so LRCLIB's
   * answers from minutes ago serve the list, plus a third name. Any record titled as the song is
   * listed, whoever sings it: the user chooses, seeing who and how long.
   */
  async function versions(query: LyricsQuery, names: SongNames | null): Promise<VersionsResult> {
    const own = ownTitle(query)
    const otherTitles = distinctTitles([own, ...(names?.titles ?? [])])
      .filter((title) => normalize(title) !== normalize(own))
      .slice(0, MAX_OTHER_TITLES)
    const { records, failed } = await gather([
      byFields(query),
      ...distinctTitles([own, ...otherTitles]).map((title) => ({ q: title }))
    ])
    const judge = judgeWith(query, names)
    const judges = distinctTitles([query.coreTitle, own, ...(names?.titles ?? [])]).map(judge)
    const listed = listVersions(query, records, () => judges)
    return failed && listed.length === 0
      ? { kind: 'unavailable' }
      : { kind: 'found', versions: listed }
  }

  /** The typed words alone, so LRCLIB hears nothing else; any title the search finds counts. */
  async function search(query: LyricsQuery, text: string): Promise<VersionsResult> {
    const words = text.trim().slice(0, MAX_SEARCH_CHARS)
    if (words === '') return { kind: 'found', versions: [] }
    const { records, failed } = await gather([{ q: words }])
    const listed = listVersions(query, records, (record) => [
      { ...query, coreTitle: record.trackName }
    ])
    return failed && listed.length === 0
      ? { kind: 'unavailable' }
      : { kind: 'found', versions: listed }
  }

  async function byId(id: number): Promise<VersionById> {
    let body: unknown
    try {
      body = await request('get-id', { id: String(id) }, { ms: RETRY_BUDGET_MS })
    } catch (error) {
      if (!(error instanceof RateLimited)) throw error
      return { kind: 'unavailable' }
    }
    if (body === FAILED) return { kind: 'unavailable' }
    const record = parseLrclibRecord(body)
    // Judged against nothing: whose it is was decided when it was picked.
    const version = record ? listedVersion({ ...record, id }, null) : null
    return version ? { kind: 'found', version } : { kind: 'notFound' }
  }

  return { lookup, lookupAs, versions, search, byId, cacheable: true }
}
