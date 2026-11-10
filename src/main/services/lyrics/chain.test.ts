import { describe, expect, it } from 'vitest'
import { createSongLyrics } from './chain'
import type { LrclibProvider, SongNames, VersionsResult } from './lrclib'
import type { LookupResult } from './provider'
import { lyricsQuery, type LyricsQuery } from './query'
import type { Vocadb, VocadbMatch, VocadbSong } from './vocadb'

function query(): LyricsQuery {
  const result = lyricsQuery({
    title: 'Literary Nonsense',
    artist: 'Wonderlands×Showtime',
    album: '',
    durationSec: 206
  })
  if (!result) throw new Error('no query')
  return result
}

const SONG: VocadbSong = {
  id: 1,
  names: ['ナンセンス文学', 'Nonsense Bungaku', 'Literary Nonsense'],
  artists: ['ワンダーランズ×ショウタイム', 'Wonderlands×Showtime'],
  songType: 'Cover',
  lengthSec: 206
}

const found = (kind: 'synced' | 'plain', source: 'lrclib' | 'vocadb'): LookupResult => ({
  kind: 'found',
  lyrics:
    kind === 'synced'
      ? { kind: 'synced', lines: [{ timeSec: 1, text: 'a' }], source }
      : { kind: 'plain', lines: ['a'], source }
})
const NOT_FOUND: LookupResult = { kind: 'notFound' }
const UNAVAILABLE: LookupResult = { kind: 'unavailable' }
const LISTED: VersionsResult = {
  kind: 'found',
  versions: [
    {
      id: 7,
      title: 'ナンセンス文学',
      artist: 'ワンダーランズ×ショウタイム',
      album: '',
      durationSec: 206,
      credit: 'singers',
      lyrics: { kind: 'plain', lines: ['a'], source: 'lrclib' }
    }
  ]
}

interface Answers {
  lrclib: LookupResult
  renamed?: LookupResult
  match?: VocadbMatch
  words?: LookupResult
  versions?: VersionsResult
}

/** Both services with set answers; records what was asked. */
function services(answers: Answers): {
  lrclib: LrclibProvider
  vocadb: Vocadb
  asked: string[]
  names: (SongNames | null)[]
} {
  const asked: string[] = []
  const names: (SongNames | null)[] = []
  const lrclib: LrclibProvider = {
    cacheable: true,
    async lookup() {
      asked.push('lrclib')
      return answers.lrclib
    },
    async lookupAs(_query, given) {
      asked.push('lrclib under other names')
      names.push(given)
      return answers.renamed ?? NOT_FOUND
    },
    async versions(_query, given) {
      asked.push('lrclib versions')
      names.push(given)
      return answers.versions ?? LISTED
    },
    async search(_query, text) {
      asked.push(`lrclib search ${text}`)
      return answers.versions ?? LISTED
    },
    async byId(id) {
      asked.push(`lrclib record ${id}`)
      return { kind: 'notFound' }
    }
  }
  const vocadb: Vocadb = {
    lyrics: { cacheable: true, lookup: async () => NOT_FOUND },
    async match() {
      asked.push('vocadb match')
      return answers.match ?? { kind: 'found', song: SONG }
    },
    async wordsOf() {
      asked.push('vocadb words')
      return answers.words ?? found('plain', 'vocadb')
    },
    romaji: async () => ({ kind: 'notFound' })
  }
  return { lrclib, vocadb, asked, names }
}

describe('song lyrics', () => {
  it('takes LRCLIB’s answer when it has the song, asking nobody else', async () => {
    const answer = found('synced', 'lrclib')
    const { lrclib, vocadb, asked } = services({ lrclib: answer })
    expect(await createSongLyrics(lrclib, vocadb).lookup(query())).toEqual(answer)
    expect(asked).toEqual(['lrclib'])
  })

  it('stands VocaDB’s words in while LRCLIB can’t be reached, asking VocaDB once a while', async () => {
    let clock = 0
    const { lrclib, vocadb, asked } = services({ lrclib: UNAVAILABLE })
    const chain = createSongLyrics(lrclib, vocadb, () => clock)
    const words = found('plain', 'vocadb')
    const interim = { kind: 'interim', lyrics: words.kind === 'found' ? words.lyrics : null }
    expect(await chain.lookup(query())).toEqual(interim)
    expect(asked).toEqual(['lrclib', 'vocadb match', 'vocadb words'])
    // LRCLIB is asked again soon; VocaDB's answer is kept meanwhile.
    clock += 60_000
    expect(await chain.lookup(query())).toEqual(interim)
    expect(asked.slice(3)).toEqual(['lrclib'])
    clock += 31 * 60_000
    await chain.lookup(query())
    expect(asked.slice(4)).toEqual(['lrclib', 'vocadb match', 'vocadb words'])
  })

  it('stays unavailable when VocaDB hasn’t the words, or can’t be reached either', async () => {
    const cases: Answers[] = [
      { lrclib: UNAVAILABLE, match: { kind: 'notFound' } },
      { lrclib: UNAVAILABLE, words: NOT_FOUND },
      { lrclib: UNAVAILABLE, match: { kind: 'unavailable' } }
    ]
    for (const answers of cases) {
      const { lrclib, vocadb } = services(answers)
      expect(await createSongLyrics(lrclib, vocadb).lookup(query())).toEqual(UNAVAILABLE)
    }
  })

  it('asks LRCLIB again under the names VocaDB knows, and takes timed lyrics found that way', async () => {
    const timed = found('synced', 'lrclib')
    const { lrclib, vocadb, asked, names } = services({ lrclib: NOT_FOUND, renamed: timed })
    expect(await createSongLyrics(lrclib, vocadb).lookup(query())).toEqual(timed)
    expect(asked).toEqual(['lrclib', 'vocadb match', 'lrclib under other names'])
    expect(names).toEqual([{ titles: SONG.names, artists: SONG.artists }])
  })

  it("takes the singers' own plain words found under another name over VocaDB's", async () => {
    const theirs: LookupResult = {
      kind: 'found',
      lyrics: {
        kind: 'plain',
        lines: ['a'],
        source: 'lrclib',
        from: { id: 7, artist: 'ワンダーランズ×ショウタイム', durationSec: 206, credit: 'singers' }
      }
    }
    const { lrclib, vocadb } = services({ lrclib: NOT_FOUND, renamed: theirs })
    expect(await createSongLyrics(lrclib, vocadb).lookup(query())).toEqual(theirs)
  })

  it('prefers VocaDB’s words to plain ones from LRCLIB under another name', async () => {
    const { lrclib, vocadb } = services({ lrclib: NOT_FOUND, renamed: found('plain', 'lrclib') })
    expect(await createSongLyrics(lrclib, vocadb).lookup(query())).toEqual(found('plain', 'vocadb'))
  })

  it('falls back to LRCLIB’s plain words when VocaDB has none of its own', async () => {
    const plain = found('plain', 'lrclib')
    for (const words of [NOT_FOUND, UNAVAILABLE]) {
      const { lrclib, vocadb } = services({ lrclib: NOT_FOUND, renamed: plain, words })
      expect(await createSongLyrics(lrclib, vocadb).lookup(query())).toEqual(plain)
    }
  })

  it('says what VocaDB says when it doesn’t know the song, or can’t be reached', async () => {
    for (const match of [{ kind: 'notFound' }, { kind: 'unavailable' }] as const) {
      const { lrclib, vocadb, asked } = services({ lrclib: NOT_FOUND, match })
      expect(await createSongLyrics(lrclib, vocadb).lookup(query())).toEqual(match)
      expect(asked).toEqual(['lrclib', 'vocadb match'])
    }
  })

  it('asks VocaDB for the names when listing versions', async () => {
    const song = {
      ...SONG,
      artistGroups: [['ワンダーランズ×ショウタイム', 'Wonderlands×Showtime']]
    }
    const { lrclib, vocadb, asked, names } = services({
      lrclib: NOT_FOUND,
      match: { kind: 'found', song }
    })
    expect(await createSongLyrics(lrclib, vocadb).versions(query())).toEqual(LISTED)
    expect(asked).toEqual(['vocadb match', 'lrclib versions'])
    expect(names).toEqual([
      { titles: SONG.names, artists: SONG.artists, artistGroups: song.artistGroups }
    ])
  })

  it('lists without the names when VocaDB is down, or doesn’t know the song', async () => {
    for (const match of [{ kind: 'unavailable' }, { kind: 'notFound' }] as const) {
      const { lrclib, vocadb, asked, names } = services({ lrclib: NOT_FOUND, match })
      expect(await createSongLyrics(lrclib, vocadb).versions(query())).toEqual(LISTED)
      expect(asked).toEqual(['vocadb match', 'lrclib versions'])
      expect(names).toEqual([null])
    }
  })

  it('searches and fetches a version at LRCLIB alone', async () => {
    const { lrclib, vocadb, asked } = services({ lrclib: NOT_FOUND })
    const chain = createSongLyrics(lrclib, vocadb)
    expect(await chain.search(query(), 'ナンセンス')).toEqual(LISTED)
    expect(await chain.byId(7)).toEqual({ kind: 'notFound' })
    expect(asked).toEqual(['lrclib search ナンセンス', 'lrclib record 7'])
  })
})
