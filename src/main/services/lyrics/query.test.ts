import { describe, expect, it } from 'vitest'
import {
  bareTitle,
  coreTitle,
  coverTitle,
  creditedQuery,
  lyricsQuery,
  quotedTitle,
  songKey
} from './query'

interface PlayerSong {
  title: string
  artist: string
  album: string
  durationSec: number
}

const song = (title: string, artist = '', album = '', durationSec = 200): PlayerSong => ({
  title,
  artist,
  album,
  durationSec
})

describe('lyricsQuery', () => {
  it('passes clean metadata through', () => {
    expect(lyricsQuery(song('City', 'Vivid BAD SQUAD', 'Moonlight/City', 220))).toEqual({
      title: 'City',
      coreTitle: 'City',
      artist: 'Vivid BAD SQUAD',
      primaryArtist: 'Vivid BAD SQUAD',
      album: 'Moonlight/City',
      durationSec: 220
    })
  })

  it('drops YouTube video noise but keeps version notes', () => {
    expect(lyricsQuery(song('Song (Official Music Video)', 'A'))?.title).toBe('Song')
    expect(lyricsQuery(song('Song [Official Audio]', 'A'))?.title).toBe('Song')
    expect(lyricsQuery(song('Song (Lyrics)', 'A'))?.title).toBe('Song')
    expect(lyricsQuery(song('【MV】Song', 'A'))?.title).toBe('Song')
    expect(lyricsQuery(song('Song | Official Video', 'A'))?.title).toBe('Song')
    expect(lyricsQuery(song('Song (Live)', 'A'))?.title).toBe('Song (Live)')
    expect(lyricsQuery(song('Song (Acoustic Version)', 'A'))?.title).toBe('Song (Acoustic Version)')
  })

  it('splits "Artist - Title" when the left side is the artist or there is no artist', () => {
    expect(lyricsQuery(song('Adele - Hello (Official Video)', 'Adele'))).toMatchObject({
      title: 'Hello',
      artist: 'Adele'
    })
    expect(lyricsQuery(song('Adele - Hello', ''))).toMatchObject({
      title: 'Hello',
      artist: 'Adele'
    })
  })

  it('leaves a dash alone when the left side is not the artist', () => {
    expect(lyricsQuery(song('Here Comes the Sun - Remastered 2009', 'The Beatles'))).toMatchObject({
      title: 'Here Comes the Sun - Remastered 2009',
      coreTitle: 'Here Comes the Sun'
    })
    expect(lyricsQuery(song('Jay-Z Song', 'Someone'))?.title).toBe('Jay-Z Song')
  })

  it('cleans YouTube channel names', () => {
    expect(lyricsQuery(song('Hello', 'Adele - Topic'))?.artist).toBe('Adele')
    expect(lyricsQuery(song('Shake It Off', 'TaylorSwiftVEVO'))?.artist).toBe('TaylorSwift')
  })

  it('uses the first artist for searching', () => {
    expect(lyricsQuery(song('Song', 'A, B & C'))?.primaryArtist).toBe('A')
    expect(lyricsQuery(song('Song', 'Simon & Garfunkel'))?.artist).toBe('Simon & Garfunkel')
  })

  it('treats a missing or odd duration as unknown', () => {
    expect(lyricsQuery(song('Song', 'A', '', 0))?.durationSec).toBe(0)
    expect(lyricsQuery(song('Song', 'A', '', Number.NaN))?.durationSec).toBe(0)
  })

  it('is null without a title', () => {
    expect(lyricsQuery(song('   ', 'A'))).toBeNull()
  })
})

describe('coreTitle', () => {
  it('drops featuring credits and remaster notes', () => {
    expect(coreTitle('Song (feat. Someone)')).toBe('Song')
    expect(coreTitle('Song [ft. Someone]')).toBe('Song')
    expect(coreTitle('Song feat. Someone')).toBe('Song')
    expect(coreTitle('Song (with Someone)')).toBe('Song')
    expect(coreTitle('Song - 2011 Remaster')).toBe('Song')
    expect(coreTitle('Song (Remastered 2015)')).toBe('Song')
    expect(coreTitle('街 - City (feat. 小豆沢こはね&白石杏)')).toBe('街 - City')
  })

  it('drops credits however a title writes them', () => {
    // Full-width brackets, as Japanese labels write them.
    expect(coreTitle('The Name of Painting（feat. Yoisaki Kanade & Hatsune Miku）')).toBe(
      'The Name of Painting'
    )
    expect(coreTitle('Song 【feat. Someone】')).toBe('Song')
    // No space after "feat.".
    expect(coreTitle('熱異常 (feat.足立レイ)')).toBe('熱異常')
    expect(coreTitle('熱異常 feat.足立レイ')).toBe('熱異常')
    // A bracket left open at the end.
    expect(coreTitle('The Name of Painting (feat. Yoisaki Kanade & Hatsune Miku')).toBe(
      'The Name of Painting'
    )
    // "feat" inside a word is no credit.
    expect(coreTitle('Feather')).toBe('Feather')
    expect(coreTitle('Defeat.Me')).toBe('Defeat.Me')
  })

  it('never returns an empty title', () => {
    expect(coreTitle('(feat. Someone)')).toBe('(feat. Someone)')
    expect(coreTitle('（feat.Someone）')).toBe('（feat.Someone）')
  })
})

describe('songKey', () => {
  it('matches across players that format the same song differently', () => {
    const fromMusic = lyricsQuery(song('Hello (feat. X)', 'Adele, X', 'Album', 295.4))
    const fromYouTube = lyricsQuery(song('Adele - Hello (Official Video)', 'Adele', '', 295.2))
    expect(fromMusic && songKey(fromMusic)).toBe(fromYouTube && songKey(fromYouTube))
  })

  it('tells recordings of different lengths apart', () => {
    const album = lyricsQuery(song('Hello', 'Adele', '', 295))
    const video = lyricsQuery(song('Hello', 'Adele', '', 367))
    expect(album && songKey(album)).not.toBe(video && songKey(video))
  })
})

describe('titles that credit their singers', () => {
  const SEKAI = 'プロジェクトセカイ カラフルステージ！'
  const query = (title: string): ReturnType<typeof lyricsQuery> =>
    lyricsQuery({ title, artist: SEKAI, album: '', durationSec: 217 })

  it('splits "Title / Singers" at a spaced slash of either width', () => {
    expect(query('STORY / Leo/need')?.credits).toEqual({ title: 'STORY', artist: 'Leo/need' })
    expect(query('世界の歩き方 ／ 星乃一歌 × 初音ミク')?.credits).toEqual({
      title: '世界の歩き方',
      artist: '星乃一歌 × 初音ミク'
    })
  })

  it('leaves titles alone that only have a slash inside a name, or more than one', () => {
    expect(query('Leo/need Medley')?.credits).toBeUndefined()
    expect(query('A / B / C')?.credits).toBeUndefined()
    expect(query(' / Leo/need')?.credits).toBeUndefined()
  })

  it('searches as the credits say, while the song keeps its own key', () => {
    const asked = query('STORY / Leo/need')
    if (!asked) throw new Error('no query')
    expect(creditedQuery(asked)).toMatchObject({
      title: 'STORY',
      coreTitle: 'STORY',
      artist: 'Leo/need',
      primaryArtist: 'Leo/need',
      durationSec: 217
    })
    expect(creditedQuery(asked)?.credits).toBeUndefined()
    const plain = { ...asked }
    delete plain.credits
    expect(songKey(asked)).toBe(songKey(plain))
    expect(creditedQuery(plain)).toBeNull()
  })
})

describe('bareTitle', () => {
  it('drops every bracketed note and trailing video word', () => {
    expect(bareTitle('てらてら [VOCALOID ver.] MV')).toBe('てらてら')
    expect(bareTitle('【MV】アンチサイノウ（Full ver.）')).toBe('アンチサイノウ')
    expect(bareTitle('Song (Live) - Official Music Video')).toBe('Song')
    expect(bareTitle('Song PV')).toBe('Song')
  })

  it('drops a bracket left open at the end', () => {
    // What a credit with a singer before "feat." leaves of a title: 「命の轍 (Sabio feat.重音テト)」.
    expect(bareTitle('命の轍 (Sabio')).toBe('命の轍')
    expect(bareTitle('Song（Someone')).toBe('Song')
  })

  it('leaves a title alone when that would leave nothing, or nothing is there to drop', () => {
    expect(bareTitle('Video')).toBe('Video')
    expect(bareTitle('【Lyrics】')).toBe('【Lyrics】')
    expect(bareTitle('てらてら')).toBe('てらてら')
  })
})

describe('coverTitle', () => {
  it('finds the song a cover sings, without the cover note or the singer', () => {
    expect(coverTitle('フォニイ 歌ってみた 七海うらら')).toBe('フォニイ')
    expect(coverTitle('【歌ってみた】エンヴィーベイビー covered by 獅子神レオナ【kanaria】')).toBe(
      'エンヴィーベイビー'
    )
    expect(coverTitle('フォニイ / 七海うらら(cover)')).toBe('フォニイ')
    expect(coverTitle('フォニイ／七海うらら【歌ってみた】')).toBe('フォニイ')
    expect(coverTitle('歌ってみた フォニイ / 七海うらら')).toBe('フォニイ')
    expect(coverTitle('【MV】『フォニイ』を歌ってみた')).toBe('フォニイ')
    expect(coverTitle('Hello - Adele (Acoustic Cover)')).toBe('Hello')
    expect(coverTitle('Hello | cover by Someone')).toBe('Hello')
  })

  it('leaves songs alone that only have “cover” in their name', () => {
    expect(coverTitle('Cover Me')).toBeNull()
    expect(coverTitle('Under Cover of Darkness')).toBeNull()
    expect(coverTitle('Discover')).toBeNull()
    expect(coverTitle('フォニイ')).toBeNull()
  })

  it('gives nothing when no song is left', () => {
    expect(coverTitle('【歌ってみた】')).toBeNull()
  })
})

describe('quotedTitle', () => {
  it('takes the song’s name out of corner brackets, single or double', () => {
    expect(quotedTitle('syudou「アンチサイノウ」MV')).toBe('アンチサイノウ')
    expect(quotedTitle('【MV】『フォニイ』/ ツミキ')).toBe('フォニイ')
    expect(quotedTitle('「アンチサイノウ」')).toBe('アンチサイノウ')
    expect(quotedTitle('『 フォニイ 』 full ver.')).toBe('フォニイ')
  })

  it('gives nothing without corner brackets, or with nothing in them', () => {
    expect(quotedTitle('アンチサイノウ')).toBeNull()
    expect(quotedTitle('【アンチサイノウ】')).toBeNull()
    expect(quotedTitle('「」 empty')).toBeNull()
  })

  it('reads 「Song」/ Singers as the song and who sings it, with no space before the slash', () => {
    const query = lyricsQuery(song('「アンチサイノウ」/ 桃井愛莉 × 東雲彰人', 'プロジェクトセカイ'))
    expect(query?.credits).toEqual({ title: 'アンチサイノウ', artist: '桃井愛莉 × 東雲彰人' })
    expect(lyricsQuery(song('『フォニイ』／ツミキ', 'Channel'))?.credits).toEqual({
      title: 'フォニイ',
      artist: 'ツミキ'
    })
    // The usual spaced slash still wins.
    expect(lyricsQuery(song('STORY / Leo/need', 'Channel'))?.credits?.title).toBe('STORY')
  })
})
