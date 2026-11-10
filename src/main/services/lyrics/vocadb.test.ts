import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JsonResponse } from '../http'
import type { FetchJson } from './lrclib'
import { lyricsQuery, type LyricsQuery } from './query'
import {
  baseTitle,
  createVocadbProvider,
  parseVocadbLyrics,
  parseVocadbSong,
  scoreSong,
  type VocadbSong
} from './vocadb'

/** How a Project SEKAI release can show up in a player: the singers credited in the title. */
const SEKAI = 'プロジェクトセカイ カラフルステージ！'
const SEKAI_TITLES = [
  'アンチサイノウ (桃井愛莉×東雲彰人×草薙寧々×東雲絵名×MEIKO)',
  'アンチサイノウ（桃井愛莉×東雲彰人×草薙寧々×東雲絵名×MEIKO）',
  'アンチサイノウ / 桃井愛莉 × 東雲彰人 × 草薙寧々 × 東雲絵名 × MEIKO'
]

// Song names and credits as VocaDB lists them; the lyric text is made up.
const SYUDOU = {
  name: 'syudou',
  categories: 'Producer',
  artist: { name: 'syudou', additionalNames: 'しゅどう, シャノワール, Chat noir' }
}
const MIKU = {
  name: '初音ミク NT (Original＋)',
  categories: 'Vocalist',
  artist: { name: '初音ミク NT (Original＋)', additionalNames: 'Hatsune Miku NT' }
}
const ANIMATOR = { name: 'tete', categories: 'Animator', artist: { name: 'tete' } }
const NAMES = [
  { value: 'アンチサイノウ', language: 'Japanese' },
  { value: 'Antisainou', language: 'Romaji' },
  { value: 'Anti Talent', language: 'English' }
]

const ORIGINAL = {
  id: 1025419,
  name: 'アンチサイノウ',
  defaultName: 'アンチサイノウ',
  artistString: 'syudou feat. 初音ミク NT (Original＋)',
  songType: 'Original',
  lengthSeconds: 203,
  names: NAMES,
  artists: [SYUDOU, MIKU]
}
const COVER = {
  ...ORIGINAL,
  id: 1025415,
  artistString: 'syudou feat. various',
  songType: 'Cover',
  originalVersionId: 1025419,
  artists: [SYUDOU, ANIMATOR]
}
const INSTRUMENTAL = {
  ...ORIGINAL,
  id: 1038484,
  artistString: 'syudou',
  songType: 'Instrumental',
  lengthSeconds: 199,
  originalVersionId: 1025419
}

const SUNG = 'ひとつめの行\nふたつめの行\n\nみっつめの行'
const lyricsOf = (id: number, lyrics: unknown[], originalVersionId?: number): unknown => ({
  id,
  lyrics,
  ...(originalVersionId ? { originalVersionId } : {})
})
const entry = (translationType: string, value: string): unknown => ({
  translationType,
  cultureCodes: [translationType === 'Original' ? 'ja' : 'ha'],
  source: 'Somewhere',
  value
})

function query(title = 'アンチサイノウ', artist = 'syudou', durationSec = 203): LyricsQuery {
  const result = lyricsQuery({ title, artist, album: '', durationSec })
  if (!result) throw new Error('no query')
  return result
}

function song(raw: unknown): VocadbSong {
  const parsed = parseVocadbSong(raw)
  if (!parsed) throw new Error('unparsed song')
  return parsed
}

const ok = (body: unknown): JsonResponse => ({ status: 200, body, retryAfterSec: null })
const status = (code: number): JsonResponse => ({ status: code, body: null, retryAfterSec: null })

/** Answers by path; records every URL asked for. */
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

/** A small VocaDB: search results, and each song's lyrics by id. */
function vocadb(items: unknown[], songs: Record<number, unknown>): ReturnType<typeof fakeFetch> {
  return fakeFetch((url) => {
    if (url.pathname === '/api/songs') return ok({ items, term: '', totalCount: items.length })
    const id = Number(url.pathname.split('/').pop())
    return id in songs ? ok(songs[id]) : status(404)
  })
}

const paths = (fetch: { urls: URL[] }): string[] => fetch.urls.map((url) => url.pathname)

/** "Exact FavoritedTimes": how a search matched names and ordered songs. */
const searchKind = (url: URL): string =>
  `${url.searchParams.get('nameMatchMode')} ${url.searchParams.get('sort')}`

/** Search results by kind of search (none for a kind not listed); every song has lyrics. */
function searches(
  answers: Record<string, unknown[] | JsonResponse | Error>
): ReturnType<typeof fakeFetch> {
  return fakeFetch((url) => {
    if (url.pathname !== '/api/songs') return ok(lyricsOf(1025419, [entry('Original', SUNG)]))
    const answer = answers[searchKind(url)] ?? []
    if (answer instanceof Error) return answer
    return Array.isArray(answer) ? ok({ items: answer }) : answer
  })
}

const searchesAsked = (fetch: { urls: URL[] }): string[] =>
  fetch.urls.filter((url) => url.pathname === '/api/songs').map(searchKind)

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseVocadbSong', () => {
  it('collects every name of the song and of the people who make or sing it', () => {
    expect(parseVocadbSong(COVER)).toEqual({
      id: 1025415,
      names: ['アンチサイノウ', 'Antisainou', 'Anti Talent'],
      artists: ['syudou feat. various', 'syudou', 'しゅどう', 'シャノワール', 'Chat noir'],
      // シャノワール (Chat noir) is syudou too: one artist, every name of his together.
      artistGroups: [['syudou', 'しゅどう', 'シャノワール', 'Chat noir']],
      songType: 'Cover',
      lengthSec: 203
    })
  })

  it('drops what does not fit', () => {
    expect(
      parseVocadbSong({ ...ORIGINAL, lengthSeconds: 'long', names: 'x', artists: [1] })
    ).toEqual(
      expect.objectContaining({
        names: ['アンチサイノウ'],
        artists: [ORIGINAL.artistString],
        lengthSec: 0
      })
    )
    expect(parseVocadbSong({ ...ORIGINAL, id: -1 })).toBeNull()
    expect(parseVocadbSong({ ...ORIGINAL, id: '1025419' })).toBeNull()
    expect(parseVocadbSong({ ...ORIGINAL, name: '' })).toBeNull()
    expect(parseVocadbSong([])).toBeNull()
  })
})

describe('parseVocadbLyrics', () => {
  it('takes the lyrics as sung and their romanization, never a translation', () => {
    const raw = lyricsOf(1, [
      entry('Romanized', 'hitotsume'),
      entry('Original', SUNG),
      entry('Translation', 'one')
    ])
    expect(parseVocadbLyrics(raw)).toEqual({
      original: SUNG,
      romanized: 'hitotsume',
      basedOn: null
    })
    expect(parseVocadbLyrics(lyricsOf(2, [entry('Translation', 'x')], 1))).toEqual({
      original: null,
      romanized: null,
      basedOn: 1
    })
    expect(parseVocadbLyrics(lyricsOf(3, [entry('Original', '   ')]))).toEqual({
      original: null,
      romanized: null,
      basedOn: null
    })
    expect(parseVocadbLyrics('garbage')).toEqual({ original: null, romanized: null, basedOn: null })
  })
})

describe('scoreSong', () => {
  it('matches a romanized title and an artist known by another name', () => {
    expect(scoreSong(query('Antisainou', 'しゅどう'), song(ORIGINAL))).not.toBeNull()
  })

  it('accepts the same title and length when the player credits someone VocaDB does not list', () => {
    expect(scoreSong(query('アンチサイノウ', 'Vivid BAD SQUAD', 204), song(COVER))).not.toBeNull()
    expect(scoreSong(query('アンチサイノウ', 'Vivid BAD SQUAD', 230), song(COVER))).toBeNull()
  })

  it('turns down another title, and instrumentals unless that is what plays', () => {
    expect(scoreSong(query('ハロー、プラネット。'), song(ORIGINAL))).toBeNull()
    expect(scoreSong(query(), song(INSTRUMENTAL))).toBeNull()
    expect(
      scoreSong(query('アンチサイノウ (Instrumental)', 'syudou', 199), song(INSTRUMENTAL))
    ).not.toBeNull()
  })

  it('prefers the song as first released when a cover matches as well', () => {
    expect(scoreSong(query(), song(ORIGINAL))).toBeGreaterThan(scoreSong(query(), song(COVER)) ?? 0)
  })

  it('matches a title that credits its singers, on the song’s own name and length', () => {
    for (const title of SEKAI_TITLES) {
      expect(scoreSong(query(title, SEKAI, 202), song(COVER))).not.toBeNull()
      expect(scoreSong(query(title, SEKAI, 240), song(COVER))).toBeNull()
    }
  })
})

describe('baseTitle', () => {
  it('drops the singers a title credits, whatever the brackets or separator', () => {
    for (const title of SEKAI_TITLES) expect(baseTitle(title)).toBe('アンチサイノウ')
    expect(baseTitle('アンチサイノウ')).toBe('アンチサイノウ')
    expect(baseTitle('【アンチサイノウ】')).toBe('【アンチサイノウ】')
  })

  it('drops a bracket left open at the end', () => {
    expect(baseTitle('命の轍 (Sabio')).toBe('命の轍')
    expect(baseTitle('The Name of Painting（Yoisaki Kanade & Hatsune Miku')).toBe(
      'The Name of Painting'
    )
    expect(baseTitle('(Untitled')).toBe('(Untitled')
  })

  it('takes the name out of corner brackets', () => {
    expect(baseTitle('syudou「アンチサイノウ」MV')).toBe('アンチサイノウ')
    expect(baseTitle('『アンチサイノウ』/ 桃井愛莉 × 東雲彰人')).toBe('アンチサイノウ')
  })
})

describe('VocaDB provider', () => {
  it('searches for the song’s own name when the title credits its singers', async () => {
    const fetch = vocadb([COVER], {
      1025415: lyricsOf(1025415, [], 1025419),
      1025419: lyricsOf(1025419, [entry('Original', SUNG)])
    })
    const [title = ''] = SEKAI_TITLES
    const result = await createVocadbProvider(fetch).lookup(query(title, SEKAI, 202))
    expect(result).toMatchObject({ kind: 'found', lyrics: { source: 'vocadb' } })
    expect(fetch.urls[0]?.searchParams.get('query')).toBe('アンチサイノウ')
  })

  it('sends only the title, then reads the matching song’s lyrics', async () => {
    const fetch = vocadb([COVER, ORIGINAL, INSTRUMENTAL], {
      1025419: lyricsOf(1025419, [entry('Original', SUNG)])
    })
    const result = await createVocadbProvider(fetch).lookup(query())
    expect(result).toEqual({
      kind: 'found',
      lyrics: {
        kind: 'plain',
        lines: ['ひとつめの行', 'ふたつめの行', '', 'みっつめの行'],
        source: 'vocadb'
      }
    })
    expect(paths(fetch)).toEqual(['/api/songs', '/api/songs/1025419'])
    const search = fetch.urls[0]
    expect(search?.origin).toBe('https://vocadb.net')
    expect(search?.searchParams.get('query')).toBe('アンチサイノウ')
    const sent = [...(search?.searchParams.values() ?? [])].join(' ')
    expect(sent).not.toContain('syudou')
    expect(sent).not.toContain('203')
    expect(fetch.urls[1]?.searchParams.get('fields')).toBe('Lyrics')
  })

  it('asks for the exact name first, and stops there when a song matches', async () => {
    const fetch = searches({ 'Exact FavoritedTimes': [ORIGINAL] })
    const result = await createVocadbProvider(fetch).lookup(query())
    expect(result).toMatchObject({ kind: 'found', lyrics: { source: 'vocadb' } })
    expect(searchesAsked(fetch)).toEqual(['Exact FavoritedTimes'])
  })

  it('searches by words, most favourited first, when the exact name finds no match', async () => {
    const someoneElse = { ...ORIGINAL, artists: [], artistString: 'Someone', lengthSeconds: 90 }
    for (const exact of [[], [someoneElse], new Error('offline')]) {
      const fetch = searches({ 'Exact FavoritedTimes': exact, 'Auto FavoritedTimes': [ORIGINAL] })
      const result = await createVocadbProvider(fetch).lookup(query())
      expect(result).toMatchObject({ kind: 'found', lyrics: { source: 'vocadb' } })
      expect(searchesAsked(fetch)).toEqual(['Exact FavoritedTimes', 'Auto FavoritedTimes'])
    }
  })

  it('searches unsorted, reading further, when sorting by favourites fails', async () => {
    for (const sorted of [new Error('TimeoutError'), status(500)]) {
      const fetch = searches({ 'Auto FavoritedTimes': sorted, 'Auto None': [ORIGINAL] })
      const result = await createVocadbProvider(fetch).lookup(query())
      expect(result).toMatchObject({ kind: 'found', lyrics: { source: 'vocadb' } })
      expect(searchesAsked(fetch)).toEqual([
        'Exact FavoritedTimes',
        'Auto FavoritedTimes',
        'Auto None'
      ])
      expect(fetch.urls[2]?.searchParams.get('maxResults')).toBe('50')
    }

    const nothing = searches({ 'Auto FavoritedTimes': status(500), 'Auto None': [] })
    expect(await createVocadbProvider(nothing).lookup(query())).toEqual({ kind: 'notFound' })

    const bothFail = searches({ 'Auto FavoritedTimes': status(500), 'Auto None': status(500) })
    expect(await createVocadbProvider(bothFail).lookup(query())).toEqual({ kind: 'unavailable' })
  })

  it('follows a cover without lyrics to the song it is based on', async () => {
    const fetch = vocadb([COVER], {
      1025415: lyricsOf(1025415, [], 1025419),
      1025419: lyricsOf(1025419, [entry('Original', SUNG)])
    })
    const result = await createVocadbProvider(fetch).lookup(query())
    expect(result).toMatchObject({ kind: 'found', lyrics: { source: 'vocadb' } })
    expect(paths(fetch)).toEqual(['/api/songs', '/api/songs/1025415', '/api/songs/1025419'])
  })

  it('follows at most two links', async () => {
    const fetch = vocadb([{ ...COVER, id: 1 }], {
      1: lyricsOf(1, [], 2),
      2: lyricsOf(2, [], 3),
      3: lyricsOf(3, [], 4),
      4: lyricsOf(4, [entry('Original', SUNG)])
    })
    expect(await createVocadbProvider(fetch).lookup(query())).toEqual({ kind: 'notFound' })
    expect(paths(fetch)).toEqual(['/api/songs', '/api/songs/1', '/api/songs/2', '/api/songs/3'])
  })

  it('says "not found" with no matching song, or no lyrics as sung', async () => {
    const none = vocadb(
      [{ ...ORIGINAL, artists: [], artistString: 'Someone', lengthSeconds: 90 }],
      {}
    )
    expect(await createVocadbProvider(none).lookup(query())).toEqual({ kind: 'notFound' })
    expect(paths(none)).toEqual(['/api/songs', '/api/songs'])

    const romajiOnly = vocadb([ORIGINAL], { 1025419: lyricsOf(1025419, [entry('Romanized', 'x')]) })
    expect(await createVocadbProvider(romajiOnly).lookup(query())).toEqual({ kind: 'notFound' })

    const offShape = fakeFetch(() => ok({ items: 'none' }))
    expect(await createVocadbProvider(offShape).lookup(query())).toEqual({ kind: 'notFound' })
  })

  it('is unavailable when VocaDB fails, and never claims "not found"', async () => {
    const offline = fakeFetch(() => new Error('offline'))
    expect(await createVocadbProvider(offline).lookup(query())).toEqual({ kind: 'unavailable' })

    const broken = fakeFetch(() => status(500))
    expect(await createVocadbProvider(broken).lookup(query())).toEqual({ kind: 'unavailable' })

    const lyricsFail = fakeFetch((url) =>
      url.pathname === '/api/songs' ? ok({ items: [ORIGINAL] }) : status(503)
    )
    expect(await createVocadbProvider(lyricsFail).lookup(query())).toEqual({ kind: 'unavailable' })
  })

  it('backs off after a 429 for as long as VocaDB asks', async () => {
    let clock = 1000
    const fetch = fakeFetch(() => ({ status: 429, body: null, retryAfterSec: 30 }))
    const provider = createVocadbProvider(fetch, () => clock)
    expect(await provider.lookup(query())).toEqual({ kind: 'unavailable' })
    expect(await provider.lookup(query())).toEqual({ kind: 'unavailable' })
    expect(fetch.urls).toHaveLength(1)
    clock += 31
    await provider.lookup(query())
    expect(fetch.urls).toHaveLength(2)
  })

  it('keeps the song out of its warnings', async () => {
    const warn = vi.mocked(console.warn)
    await createVocadbProvider(
      fakeFetch(() => new Error('failed: https://vocadb.net/api/songs?query=x'))
    ).lookup(query())
    const logged = warn.mock.calls.flat().join(' ')
    expect(logged).not.toContain('アンチサイノウ')
    expect(logged).not.toContain('vocadb.net/api')
  })
})
