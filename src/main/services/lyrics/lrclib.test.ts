import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JsonResponse } from '../http'
import {
  createLrclibProvider,
  parseLrclibRecord,
  type FetchJson,
  type SongNames,
  type VersionsResult
} from './lrclib'
import { lyricsQuery, type LyricsQuery } from './query'
import type { LyricsVersion } from './versions'

const CITY = {
  id: 10028022,
  trackName: '街 - City (feat. 小豆沢こはね&白石杏)',
  artistName: 'Vivid BAD SQUAD',
  albumName: 'Moonlight/City',
  duration: 220.0,
  instrumental: false,
  plainLyrics: 'First\nSecond',
  syncedLyrics: '[00:10.00]First\n[00:15.00]Second'
}

function query(title = 'City', artist = 'Vivid BAD SQUAD', album = 'Moonlight/City'): LyricsQuery {
  const result = lyricsQuery({ title, artist, album, durationSec: 220 })
  if (!result) throw new Error('no query')
  return result
}

const ok = (body: unknown): JsonResponse => ({ status: 200, body, retryAfterSec: null })
const notFound: JsonResponse = { status: 404, body: { name: 'TrackNotFound' }, retryAfterSec: null }

/** Answers by endpoint; records every URL asked for. */
function fakeFetch(answer: (url: URL) => JsonResponse | Error): FetchJson & { urls: URL[] } {
  const urls: URL[] = []
  const fetch = async (raw: string): Promise<JsonResponse> => {
    const url = new URL(raw)
    urls.push(url)
    const reply = answer(url)
    if (reply instanceof Error) throw reply
    return reply
  }
  return Object.assign(fetch, { urls })
}

/** Retries happen at once in tests; the waits asked for are kept to check. */
let waits: number[]
const noWait = async (ms: number): Promise<void> => {
  waits.push(ms)
}

beforeEach(() => {
  waits = []
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseLrclibRecord', () => {
  it('reads a record and drops what does not fit', () => {
    expect(parseLrclibRecord({ ...CITY, plainLyrics: '  ', duration: 'long' })).toEqual({
      id: 10028022,
      trackName: CITY.trackName,
      artistName: 'Vivid BAD SQUAD',
      albumName: 'Moonlight/City',
      durationSec: 0,
      instrumental: false,
      plainLyrics: null,
      syncedLyrics: CITY.syncedLyrics
    })
    expect(parseLrclibRecord({ trackName: '' })).toBeNull()
    expect(parseLrclibRecord([])).toBeNull()
  })

  it("reads a record's id", () => {
    expect(parseLrclibRecord({ ...CITY, id: 38885746 })?.id).toBe(38885746)
    expect(parseLrclibRecord({ ...CITY, id: 1.5 })?.id).toBe(0)
    expect(parseLrclibRecord({ ...CITY, id: -3 })?.id).toBe(0)
    expect(parseLrclibRecord({ ...CITY, id: '12' })?.id).toBe(0)
  })
})

describe('LRCLIB provider', () => {
  const endpoint = (url: URL): string => url.pathname.replace('/api/', '')
  const paths = (fetch: { urls: URL[] }): string[] =>
    fetch.urls.map((url) => endpoint(url) + (url.searchParams.has('q') ? '?q' : ''))

  it("asks LRCLIB's own database for the exact record first", async () => {
    const fetch = fakeFetch(() => ok({ ...CITY, trackName: 'City' }))
    const result = await createLrclibProvider(fetch).lookup(query())
    expect(result).toMatchObject({ kind: 'found', lyrics: { kind: 'synced' } })
    expect(paths(fetch)).toEqual(['get-cached'])
    const url = fetch.urls[0]
    expect(`${url?.origin}${url?.pathname}`).toBe('https://lrclib.net/api/get-cached')
    expect(Object.fromEntries(url?.searchParams ?? [])).toEqual({
      track_name: 'City',
      artist_name: 'Vivid BAD SQUAD',
      album_name: 'Moonlight/City',
      duration: '220'
    })
  })

  it('searches when there is no exact record, and finds the credited title', async () => {
    const fetch = fakeFetch((url) => (endpoint(url) === 'get-cached' ? notFound : ok([CITY])))
    const result = await createLrclibProvider(fetch).lookup(query())
    expect(result).toMatchObject({ kind: 'found', lyrics: { kind: 'synced' } })
    expect(paths(fetch)).toEqual(['get-cached', 'search'])
    expect(fetch.urls[1]?.searchParams.get('track_name')).toBe('City')
    expect(fetch.urls[1]?.searchParams.get('artist_name')).toBe('Vivid BAD SQUAD')
  })

  it('tries free text, the title alone, then outside sources through /api/get, before giving up', async () => {
    const fetch = fakeFetch((url) => (endpoint(url) === 'search' ? ok([]) : notFound))
    expect(await createLrclibProvider(fetch).lookup(query())).toEqual({ kind: 'notFound' })
    expect(paths(fetch)).toEqual(['get-cached', 'search', 'search?q', 'search?q', 'get'])
    expect(fetch.urls[2]?.searchParams.get('q')).toBe('Vivid BAD SQUAD City')
    expect(fetch.urls[3]?.searchParams.get('q')).toBe('City')
  })

  it('finds a song by its title alone when LRCLIB names the singers otherwise', async () => {
    const others = Array.from({ length: 19 }, (_, i) => ({
      ...CITY,
      trackName: 'Green',
      artistName: `Band ${i}`
    }))
    const ours = { ...CITY, trackName: 'Green', artistName: 'Second Singer', albumName: '' }
    const fetch = fakeFetch((url) =>
      url.searchParams.get('q') === 'Green'
        ? ok([...others, ours])
        : endpoint(url) === 'search'
          ? ok([])
          : notFound
    )
    const asked = query('Green', 'First Singer & Second Singer', '')
    const result = await createLrclibProvider(fetch).lookup(asked)
    expect(result).toMatchObject({ kind: 'found', lyrics: { kind: 'synced' } })
    // Found there, so the outside sources aren't asked.
    expect(paths(fetch)).toEqual(['get-cached', 'search', 'search?q', 'search?q'])
  })

  it('never takes a song of the same title by someone else', async () => {
    const other = { ...CITY, trackName: 'Green', artistName: 'Someone Else' }
    const fetch = fakeFetch((url) => (url.searchParams.get('q') === 'Green' ? ok([other]) : ok([])))
    const asked = query('Green', 'First Singer & Second Singer', '')
    expect(await createLrclibProvider(fetch).lookup(asked)).toEqual({ kind: 'notFound' })
  })

  it('uses what /api/get finds from outside sources', async () => {
    const fetch = fakeFetch((url) =>
      endpoint(url) === 'get'
        ? ok({ ...CITY, trackName: 'City' })
        : endpoint(url) === 'search'
          ? ok([])
          : notFound
    )
    const result = await createLrclibProvider(fetch).lookup(query())
    expect(result).toMatchObject({ kind: 'found', lyrics: { kind: 'synced' } })
  })

  it('says "not found" when only the outside sources fail (LRCLIB answers 503 for those)', async () => {
    const fetch = fakeFetch((url) =>
      endpoint(url) === 'get'
        ? { status: 503, body: null, retryAfterSec: null }
        : endpoint(url) === 'search'
          ? ok([])
          : notFound
    )
    expect(await createLrclibProvider(fetch, undefined, noWait).lookup(query())).toEqual({
      kind: 'notFound'
    })
    // Their failure is about that one song: asking again wouldn't help.
    expect(fetch.urls.filter((url) => endpoint(url) === 'get')).toHaveLength(1)
    expect(waits).toEqual([])
  })

  it('upgrades a plain exact record to a synced edition found by search', async () => {
    const fetch = fakeFetch((url) =>
      endpoint(url) === 'get-cached'
        ? ok({ ...CITY, trackName: 'City', syncedLyrics: null })
        : ok([{ ...CITY, albumName: 'Single' }])
    )
    const result = await createLrclibProvider(fetch).lookup(query())
    expect(result).toMatchObject({ kind: 'found', lyrics: { kind: 'synced' } })
    expect(paths(fetch)).toEqual(['get-cached', 'search'])
  })

  it('skips the exact lookups when the player has no artist', async () => {
    const fetch = fakeFetch(() => ok([]))
    const result = await createLrclibProvider(fetch).lookup(query('City', '', ''))
    expect(result).toEqual({ kind: 'notFound' })
    expect(paths(fetch)).toEqual(['search'])
  })

  it('is unavailable when the network fails, and never claims "not found"', async () => {
    const fetch = fakeFetch(() => new Error('offline'))
    expect(await createLrclibProvider(fetch).lookup(query())).toEqual({ kind: 'unavailable' })
  })

  it('finds a channel upload that credits its singers in the title', async () => {
    const story = {
      ...CITY,
      trackName: 'SToRY',
      artistName: 'Leo/need',
      albumName: 'SToRY - Single'
    }
    const fetch = fakeFetch((url) =>
      endpoint(url) === 'search' &&
      url.searchParams.get('track_name') === 'STORY' &&
      url.searchParams.get('artist_name') === 'Leo/need'
        ? ok([story])
        : endpoint(url) === 'search'
          ? ok([])
          : notFound
    )
    const asked = query('STORY / Leo/need', 'プロジェクトセカイ カラフルステージ！', '')
    const result = await createLrclibProvider(fetch, undefined, noWait).lookup(asked)
    expect(result).toMatchObject({ kind: 'found', lyrics: { kind: 'synced', source: 'lrclib' } })
    // Found by the credited search, so the free-text search and outside sources aren't asked.
    expect(fetch.urls.map((url) => endpoint(url))).toEqual(['get-cached', 'search', 'search'])
  })

  it('finds a title dressed up with version tags and video words, by its bare name', async () => {
    const tera = { ...CITY, trackName: 'てらてら', artistName: '和田たけあき', albumName: '' }
    const fetch = fakeFetch((url) =>
      endpoint(url) === 'search' && url.searchParams.get('track_name') === 'てらてら'
        ? ok([tera])
        : endpoint(url) === 'search'
          ? ok([])
          : notFound
    )
    const asked = query('てらてら [VOCALOID ver.] MV', '和田たけあき', '')
    const result = await createLrclibProvider(fetch, undefined, noWait).lookup(asked)
    expect(result).toMatchObject({ kind: 'found', lyrics: { kind: 'synced' } })
  })

  it('finds a song named in corner brackets, by that name', async () => {
    const anti = { ...CITY, trackName: 'アンチサイノウ', artistName: 'syudou', albumName: '' }
    const fetch = fakeFetch((url) =>
      endpoint(url) === 'search' &&
      url.searchParams.get('track_name') === 'アンチサイノウ' &&
      url.searchParams.get('artist_name') === 'syudou'
        ? ok([anti])
        : endpoint(url) === 'search'
          ? ok([])
          : notFound
    )
    const asked = query('syudou「アンチサイノウ」MV', 'syudou', '')
    const result = await createLrclibProvider(fetch, undefined, noWait).lookup(asked)
    expect(result).toMatchObject({ kind: 'found', lyrics: { kind: 'synced' } })
  })

  it('searches a channel’s 「Song」/ Singers by the song alone, judged by its singers', async () => {
    const anti = { ...CITY, trackName: 'アンチサイノウ', artistName: '桃井愛莉', albumName: '' }
    const fetch = fakeFetch((url) =>
      url.searchParams.get('q') === 'アンチサイノウ' ? ok([anti]) : ok([])
    )
    const asked = query('「アンチサイノウ」/ 桃井愛莉 × 東雲彰人', 'プロジェクトセカイ', '')
    const result = await createLrclibProvider(fetch, undefined, noWait).lookup(asked)
    expect(result).toMatchObject({ kind: 'found', lyrics: { kind: 'synced' } })
  })

  it('never lends a studio take’s timing to a live one found by its bare name', async () => {
    const studio = { ...CITY, trackName: 'City', albumName: '' }
    const fetch = fakeFetch((url) =>
      endpoint(url) === 'search' && url.searchParams.get('track_name') === 'City'
        ? ok([studio])
        : endpoint(url) === 'search'
          ? ok([])
          : notFound
    )
    const result = await createLrclibProvider(fetch, undefined, noWait).lookup(
      query('City (Live at Budokan) MV', 'Vivid BAD SQUAD', '')
    )
    expect(result).toMatchObject({ kind: 'found', lyrics: { kind: 'plain' } })
  })

  it('finds the song a cover sings, with its timing when the cover is as long', async () => {
    const phony = (duration: number): Record<string, unknown> => ({
      ...CITY,
      trackName: 'フォニイ',
      artistName: 'ツミキ',
      albumName: '',
      duration
    })
    const fetch = fakeFetch((url) =>
      url.searchParams.get('q') === 'フォニイ'
        ? ok([phony(191), phony(189)])
        : endpoint(url) === 'search'
          ? ok([])
          : notFound
    )
    const cover = (durationSec: number): LyricsQuery => {
      const made = lyricsQuery({
        title: 'フォニイ 歌ってみた 七海うらら',
        artist: 'Urara Nanami',
        album: '',
        durationSec
      })
      if (!made) throw new Error('no query')
      return made
    }
    const provider = createLrclibProvider(fetch, undefined, noWait)
    expect(await provider.lookup(cover(188))).toMatchObject({
      kind: 'found',
      lyrics: { kind: 'synced' }
    })
    // A cover of another length could be any song called that: nothing.
    expect(await provider.lookup(cover(240))).toEqual({ kind: 'notFound' })
  })

  it('asks again under other names, taking the singers by any of theirs', async () => {
    const japanese = {
      ...CITY,
      trackName: 'ナンセンス文学',
      artistName: 'ワンダーランズ×ショウタイム',
      albumName: ''
    }
    const fetch = fakeFetch((url) =>
      url.searchParams.get('q') === 'ナンセンス文学'
        ? ok([{ ...CITY, artistName: 'Eve' }, japanese])
        : ok([])
    )
    const provider = createLrclibProvider(fetch, undefined, noWait)
    const asked = query('Literary Nonsense', 'Wonderlands×Showtime', '')
    const result = await provider.lookupAs(asked, {
      titles: ['Literary Nonsense', 'ナンセンス文学', 'Nonsense Bungaku', 'Nonsense Literature'],
      artists: ['ワンダーランズ×ショウタイム', 'Wonderlands×Showtime']
    })
    expect(result).toMatchObject({ kind: 'found', lyrics: { kind: 'synced' } })
    // Its own title first, then the next name, where it's found: no more asked.
    expect(fetch.urls.map((url) => url.searchParams.get('q'))).toEqual([
      'Literary Nonsense',
      'ナンセンス文学'
    ])
  })

  it("counts the singers' names VocaDB knows as the singers, ahead of the original's timing", async () => {
    // LRCLIB lists the singers only under their Japanese name, with plain words; the original
    // (by its producer) is timed. The singers' own words win.
    const theirs = {
      ...CITY,
      trackName: 'ナンセンス文学',
      artistName: 'ワンダーランズ×ショウタイム',
      albumName: '',
      syncedLyrics: null,
      plainLyrics: 'First line'
    }
    const original = { ...CITY, trackName: 'ナンセンス文学', artistName: 'Eve', albumName: '' }
    const fetch = fakeFetch((url) =>
      url.searchParams.get('q') === 'ナンセンス文学' ? ok([original, theirs]) : ok([])
    )
    const provider = createLrclibProvider(fetch, undefined, noWait)
    const result = await provider.lookupAs(query('Literary Nonsense', 'Wonderlands×Showtime', ''), {
      titles: ['ナンセンス文学'],
      artists: ['ワンダーランズ×ショウタイム', 'Wonderlands×Showtime', 'Eve'],
      artistGroups: [['ワンダーランズ×ショウタイム', 'Wonderlands×Showtime'], ['Eve']]
    })
    expect(result).toMatchObject({ kind: 'found', lyrics: { kind: 'plain' } })
  })

  it("takes irony's Nightcord version, not scop's original, whichever LRCLIB lists first", async () => {
    const scop = {
      id: 20951492,
      trackName: 'アイロニ',
      artistName: 'すこっぷ feat. Rid',
      albumName: 'VOCAROCK collection Utattemita',
      duration: 253,
      instrumental: false,
      plainLyrics: null,
      syncedLyrics: '[00:05.44] 少し歩き疲れたんだ 少し歩き疲れたんだ'
    }
    const nightcord = {
      id: 10604292,
      trackName: 'アイロニ',
      artistName: '25時、ナイトコードで。 feat. 宵崎奏&朝比奈まふゆ&東雲絵名&暁山瑞希&鏡音レン',
      albumName: '25時、ナイトコードで。 SEKAI ALBUM vol.2',
      duration: 251,
      instrumental: false,
      plainLyrics: null,
      syncedLyrics: '[00:00.55] 少し歩き疲れたんだ\n[00:03.38] 少し歩き疲れたんだ'
    }
    const fetch = fakeFetch((url) =>
      url.searchParams.get('q') === 'アイロニ'
        ? ok([scop, nightcord, { ...scop, id: 4155154, duration: 250 }])
        : ok([])
    )
    const provider = createLrclibProvider(fetch, undefined, noWait)
    const asked = { ...query('irony', 'Nightcord at 25:00', ''), durationSec: 251 }
    const result = await provider.lookupAs(asked, {
      titles: ['アイロニ'],
      artists: ['すこっぷ', 'Rid'],
      artistGroups: [['すこっぷ'], ['Rid']]
    })
    expect(result).toMatchObject({
      kind: 'found',
      lyrics: {
        kind: 'synced',
        lines: [{ timeSec: 0.55 }, { timeSec: 3.38 }],
        from: { id: 10604292, artist: nightcord.artistName, durationSec: 251, credit: 'singers' }
      }
    })
    // Every version it took for the song, for a later re-check to place what was shown.
    const seen = result.kind === 'found' ? (result.seen ?? []) : []
    expect(seen.map((version) => [version.id, version.credit])).toEqual([
      [20951492, 'others'],
      [10604292, 'singers'],
      [4155154, 'others']
    ])
  })

  it("keeps asking VocaDB's other titles while only another name's version is found", async () => {
    // LRCLIB lists the original under the player's own title, timed and within 3 s; the singers'
    // own is only under the song's Japanese name.
    const original = {
      id: 1,
      trackName: 'Irony',
      artistName: 'すこっぷ',
      albumName: '',
      duration: 251,
      instrumental: false,
      plainLyrics: null,
      syncedLyrics: '[00:05.44] 少し歩き疲れたんだ'
    }
    const theirs = {
      id: 10604292,
      trackName: 'アイロニ',
      artistName: '25時、ナイトコードで。',
      albumName: '',
      duration: 251,
      instrumental: false,
      plainLyrics: null,
      syncedLyrics: '[00:00.55] 少し歩き疲れたんだ'
    }
    const fetch = fakeFetch((url) => {
      const q = url.searchParams.get('q')
      return ok(q === 'irony' ? [original] : q === 'アイロニ' ? [theirs] : [])
    })
    const provider = createLrclibProvider(fetch, undefined, noWait)
    const asked = { ...query('irony', 'Nightcord at 25:00', ''), durationSec: 251 }
    const result = await provider.lookupAs(asked, {
      titles: ['アイロニ'],
      artists: ['すこっぷ'],
      artistGroups: [['すこっぷ']]
    })
    expect(fetch.urls.map((url) => url.searchParams.get('q'))).toEqual(['irony', 'アイロニ'])
    expect(result).toMatchObject({
      kind: 'found',
      lyrics: { from: { id: 10604292, credit: 'singers' } }
    })
  })

  it('asks its own bare title and two other names at most, each once', async () => {
    const fetch = fakeFetch(() => ok([]))
    const provider = createLrclibProvider(fetch, undefined, noWait)
    const asked = query('Literary Nonsense MV', 'Wonderlands×Showtime', '')
    const names = { titles: ['literary nonsense', 'One', 'Two', 'Three'], artists: [] }
    expect(await provider.lookupAs(asked, names)).toEqual({ kind: 'notFound' })
    expect(fetch.urls.map((url) => url.searchParams.get('q'))).toEqual([
      'Literary Nonsense',
      'One',
      'Two'
    ])
  })

  it('carries on past one failed request', async () => {
    const fetch = fakeFetch((url) =>
      endpoint(url) === 'get-cached' ? { status: 503, body: null, retryAfterSec: null } : ok([CITY])
    )
    const result = await createLrclibProvider(fetch, undefined, noWait).lookup(query())
    expect(result).toMatchObject({ kind: 'found', lyrics: { kind: 'synced' } })
  })

  it('asks LRCLIB’s database again when it stumbles for a moment', async () => {
    let searches = 0
    const fetch = fakeFetch((url) => {
      if (endpoint(url) !== 'search') return notFound
      searches += 1
      return searches === 1 ? { status: 503, body: null, retryAfterSec: null } : ok([])
    })
    const result = await createLrclibProvider(fetch, undefined, noWait).lookup(query())
    expect(result).toEqual({ kind: 'notFound' })
    expect(waits).toEqual([1000])
  })

  it('gives a request four tries, waiting no more than 8 s in a whole lookup', async () => {
    const fetch = fakeFetch((url) =>
      endpoint(url) === 'search' ? { status: 503, body: null, retryAfterSec: null } : notFound
    )
    const result = await createLrclibProvider(fetch, undefined, noWait).lookup(query())
    expect(result).toEqual({ kind: 'unavailable' })
    // The first search tried four times; the next once more with what's left; the last once.
    expect(fetch.urls.filter((url) => endpoint(url) === 'search')).toHaveLength(7)
    expect(waits).toEqual([1000, 2000, 4000, 1000])
  })

  it('waits as long as LRCLIB asks after a 503, when that fits', async () => {
    let searches = 0
    const fetch = fakeFetch((url) => {
      if (endpoint(url) !== 'search') return notFound
      searches += 1
      return searches === 1 ? { status: 503, body: null, retryAfterSec: 3 } : ok([CITY])
    })
    const result = await createLrclibProvider(fetch, undefined, noWait).lookup(query())
    expect(result).toMatchObject({ kind: 'found' })
    expect(waits).toEqual([3000])
  })

  it('asks again only what LRCLIB couldn’t answer the last time', async () => {
    let down = true
    const fetch = fakeFetch((url) => {
      if (endpoint(url) === 'get-cached') return notFound
      if (url.searchParams.get('q') === 'City') {
        return down ? { status: 503, body: null, retryAfterSec: null } : ok([CITY])
      }
      return endpoint(url) === 'search' ? ok([]) : notFound
    })
    const provider = createLrclibProvider(fetch, undefined, noWait)
    expect(await provider.lookup(query())).toEqual({ kind: 'unavailable' })
    const before = fetch.urls.length
    down = false
    expect(await provider.lookup(query())).toMatchObject({ kind: 'found' })
    expect(fetch.urls.slice(before).map((url) => url.searchParams.get('q'))).toEqual(['City'])
  })

  it('asks again after a while, in case LRCLIB has the song by then', async () => {
    let clock = 1000
    const fetch = fakeFetch((url) => (endpoint(url) === 'search' ? ok([]) : notFound))
    const provider = createLrclibProvider(fetch, () => clock, noWait)
    await provider.lookup(query())
    const once = fetch.urls.length
    await provider.lookup(query())
    expect(fetch.urls).toHaveLength(once)
    clock += 11 * 60
    await provider.lookup(query())
    expect(fetch.urls).toHaveLength(once * 2)
  })

  it('keeps what it found before LRCLIB went quiet', async () => {
    const fetch = fakeFetch((url) =>
      endpoint(url) === 'get-cached'
        ? ok({ ...CITY, trackName: 'City', syncedLyrics: null })
        : new Error('offline')
    )
    const result = await createLrclibProvider(fetch).lookup(query())
    expect(result).toMatchObject({ kind: 'found', lyrics: { kind: 'plain' } })
  })

  it('backs off after a 429 for as long as LRCLIB asks', async () => {
    let clock = 1000
    const fetch = fakeFetch(() => ({ status: 429, body: null, retryAfterSec: 30 }))
    const provider = createLrclibProvider(fetch, () => clock)
    expect(await provider.lookup(query())).toEqual({ kind: 'unavailable' })
    expect(await provider.lookup(query())).toEqual({ kind: 'unavailable' })
    expect(fetch.urls).toHaveLength(1)
    clock += 31
    await provider.lookup(query())
    expect(fetch.urls).toHaveLength(2)
  })

  it('treats an off-shape answer as nothing', async () => {
    const fetch = fakeFetch((url) =>
      endpoint(url) === 'search' ? ok({ not: 'a list' }) : ok('garbage')
    )
    expect(await createLrclibProvider(fetch).lookup(query())).toEqual({ kind: 'notFound' })
  })
})

describe('LRCLIB versions of a song', () => {
  // irony by Nightcord at 25:00 is a cover of scop's アイロニ; LRCLIB has both, and other covers.
  const NIGHTCORD = {
    id: 10604292,
    trackName: 'アイロニ',
    artistName: '25時、ナイトコードで。 feat. 宵崎奏&朝比奈まふゆ&東雲絵名&暁山瑞希&鏡音レン',
    albumName: '25時、ナイトコードで。 SEKAI ALBUM vol.2',
    duration: 251,
    instrumental: false,
    plainLyrics: null,
    syncedLyrics: '[00:00.55] 少し歩き疲れたんだ\n[00:03.38] 少し歩き疲れたんだ'
  }
  const SCOP_253 = {
    ...NIGHTCORD,
    id: 20951492,
    artistName: 'すこっぷ feat. Rid',
    albumName: 'VOCAROCK collection Utattemita',
    duration: 253,
    syncedLyrics: '[00:05.44] 少し歩き疲れたんだ 少し歩き疲れたんだ'
  }
  const SCOP_250 = { ...SCOP_253, id: 4155154, duration: 250 }
  const KANO = { ...NIGHTCORD, id: 11173622, artistName: '鹿乃', albumName: '', duration: 252 }
  const MAJIKO = {
    ...NIGHTCORD,
    id: 10022160,
    artistName: 'majiko',
    albumName: '',
    duration: 246,
    syncedLyrics: '[00:01.20] 少し歩き疲れたんだ\n[00:04.00] 少し歩き疲れたんだ'
  }
  const ENGLISH = { ...KANO, id: 999, trackName: 'Irony (English Ver.)', artistName: 'Someone' }
  const NAMES: SongNames = {
    titles: ['アイロニ', 'Irony', 'Aironi'],
    artists: ['すこっぷ', 'Rid'],
    artistGroups: [['すこっぷ'], ['Rid']]
  }
  const irony = (): LyricsQuery => ({
    ...query('irony', 'Nightcord at 25:00', ''),
    durationSec: 251
  })
  const listed = (result: VersionsResult): LyricsVersion[] =>
    result.kind === 'found' ? result.versions : []
  const asked = (fetch: { urls: URL[] }): string[] =>
    fetch.urls.map((url) => `${url.pathname}?${url.searchParams.toString()}`)

  /** LRCLIB's answers by what's searched for. */
  const byWords = (answers: Record<string, unknown[]>): ((url: URL) => JsonResponse) => {
    return (url) => ok(answers[url.searchParams.get('q') ?? ''] ?? [])
  }

  it("lists irony's versions, the singers' first, then the original, then other singers, closer length first", async () => {
    const fetch = fakeFetch(
      byWords({ irony: [NIGHTCORD, MAJIKO], アイロニ: [SCOP_253, KANO, NIGHTCORD, SCOP_250] })
    )
    const result = await createLrclibProvider(fetch, undefined, noWait).versions(irony(), NAMES)
    expect(listed(result).map((version) => version.id)).toEqual([
      10604292, 4155154, 20951492, 11173622, 10022160
    ])
    expect(listed(result).map((version) => version.credit)).toEqual([
      'singers',
      'others',
      'others',
      null,
      null
    ])
    expect(listed(result)[0]).toMatchObject({
      title: 'アイロニ',
      artist: NIGHTCORD.artistName,
      album: NIGHTCORD.albumName,
      durationSec: 251,
      lyrics: {
        kind: 'synced',
        source: 'lrclib',
        lines: [{ timeSec: 0.55 }, { timeSec: 3.38 }],
        from: { id: 10604292, artist: NIGHTCORD.artistName, durationSec: 251, credit: 'singers' }
      }
    })
  })

  it('asks by fields, then its own title, then three of the names VocaDB knows at most', async () => {
    const fetch = fakeFetch(() => ok([]))
    const provider = createLrclibProvider(fetch, undefined, noWait)
    const names = { ...NAMES, titles: ['Irony', 'アイロニ', 'Aironi', 'Ironi', 'Fourth'] }
    expect(await provider.versions(irony(), names)).toEqual({ kind: 'found', versions: [] })
    expect(asked(fetch)).toEqual([
      `/api/search?${new URLSearchParams({ track_name: 'irony', artist_name: 'Nightcord at 25:00' })}`,
      `/api/search?${new URLSearchParams({ q: 'irony' })}`,
      `/api/search?${new URLSearchParams({ q: 'アイロニ' })}`,
      `/api/search?${new URLSearchParams({ q: 'Aironi' })}`,
      `/api/search?${new URLSearchParams({ q: 'Ironi' })}`
    ])
  })

  it('lists by its own title alone without the names, and asks LRCLIB again only after a while', async () => {
    const english = (record: typeof NIGHTCORD): typeof NIGHTCORD => ({
      ...record,
      trackName: 'Irony'
    })
    // Without VocaDB, nothing says アイロニ is irony.
    const fetch = fakeFetch(byWords({ irony: [english(NIGHTCORD), KANO, english(SCOP_250)] }))
    const provider = createLrclibProvider(fetch, undefined, noWait)
    const result = await provider.versions(irony(), null)
    expect(listed(result).map((version) => [version.id, version.credit])).toEqual([
      [10604292, 'singers'],
      [4155154, null]
    ])
    expect(fetch.urls).toHaveLength(2)
    // Opening the list again within minutes comes from LRCLIB's answers already given.
    await provider.versions(irony(), null)
    expect(fetch.urls).toHaveLength(2)
  })

  it('leaves out versions in another language, other songs, and records without words', async () => {
    const other = { ...KANO, id: 5, trackName: 'ロウワー' }
    const empty = { ...KANO, id: 6, plainLyrics: null, syncedLyrics: null }
    const fetch = fakeFetch(byWords({ アイロニ: [ENGLISH, NIGHTCORD, other, empty] }))
    const result = await createLrclibProvider(fetch, undefined, noWait).versions(irony(), NAMES)
    expect(listed(result).map((version) => version.id)).toEqual([10604292])
  })

  it("lists a version as LRCLIB has it, timed even when its length is further off than a lookup's", async () => {
    const fetch = fakeFetch(byWords({ アイロニ: [MAJIKO] }))
    const result = await createLrclibProvider(fetch, undefined, noWait).versions(irony(), NAMES)
    expect(listed(result)[0]).toMatchObject({
      id: 10022160,
      durationSec: 246,
      credit: null,
      lyrics: {
        kind: 'synced',
        lines: [{ timeSec: 1.2 }, { timeSec: 4 }],
        from: { id: 10022160, artist: 'majiko', durationSec: 246 }
      }
    })
  })

  it('is unavailable when LRCLIB can’t be reached, and lists what it heard when only some fail', async () => {
    const offline = fakeFetch(() => new Error('offline'))
    expect(await createLrclibProvider(offline, undefined, noWait).versions(irony(), NAMES)).toEqual(
      {
        kind: 'unavailable'
      }
    )
    const some = fakeFetch((url) =>
      url.searchParams.get('q') === 'アイロニ' ? ok([NIGHTCORD]) : new Error('offline')
    )
    const result = await createLrclibProvider(some, undefined, noWait).versions(irony(), NAMES)
    expect(listed(result).map((version) => version.id)).toEqual([10604292])
  })

  it('searches the typed words alone, and lists what it finds the same way', async () => {
    const lower = { ...NIGHTCORD, id: 7, trackName: 'ロウワー', duration: 220 }
    const fetch = fakeFetch(
      byWords({ 'アイロニ nightcord': [SCOP_253, KANO, ENGLISH, lower, NIGHTCORD] })
    )
    const result = await createLrclibProvider(fetch, undefined, noWait).search(
      irony(),
      'アイロニ nightcord'
    )
    expect(asked(fetch)).toEqual([
      `/api/search?${new URLSearchParams({ q: 'アイロニ nightcord' })}`
    ])
    // Whatever its title: the user asked for these words. The singers' first, then by length.
    expect(listed(result).map((version) => [version.id, version.credit])).toEqual([
      [10604292, 'singers'],
      [7, 'singers'],
      [11173622, null],
      [20951492, null]
    ])
  })

  it('searches nothing for words that are only spaces', async () => {
    const fetch = fakeFetch(() => ok([NIGHTCORD]))
    const provider = createLrclibProvider(fetch, undefined, noWait)
    expect(await provider.search(irony(), '   ')).toEqual({ kind: 'found', versions: [] })
    expect(fetch.urls).toHaveLength(0)
  })

  it('fetches a picked version by its id', async () => {
    const fetch = fakeFetch(() => ok(NIGHTCORD))
    const result = await createLrclibProvider(fetch, undefined, noWait).byId(10604292)
    expect(asked(fetch)).toEqual(['/api/get/10604292?'])
    expect(result).toMatchObject({
      kind: 'found',
      version: {
        id: 10604292,
        artist: NIGHTCORD.artistName,
        durationSec: 251,
        lyrics: {
          kind: 'synced',
          lines: [{ timeSec: 0.55 }, { timeSec: 3.38 }],
          from: { id: 10604292 }
        }
      }
    })
  })

  it('says a version is gone when LRCLIB has no such record, or no words in it', async () => {
    const gone = fakeFetch(() => notFound)
    expect(await createLrclibProvider(gone, undefined, noWait).byId(10604292)).toEqual({
      kind: 'notFound'
    })
    const empty = fakeFetch(() => ok({ ...NIGHTCORD, syncedLyrics: null }))
    expect(await createLrclibProvider(empty, undefined, noWait).byId(10604292)).toEqual({
      kind: 'notFound'
    })
  })

  it('is unavailable when LRCLIB keeps stumbling over a version, after its retries', async () => {
    const fetch = fakeFetch(() => ({ status: 503, body: null, retryAfterSec: null }))
    expect(await createLrclibProvider(fetch, undefined, noWait).byId(10604292)).toEqual({
      kind: 'unavailable'
    })
    expect(fetch.urls).toHaveLength(4)
    expect(waits).toEqual([1000, 2000, 4000])
  })
})
