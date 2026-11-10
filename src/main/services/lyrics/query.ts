import { normalize, splitArtists } from './text'

/** What we ask LRCLIB for. This is all it ever gets: song metadata, nothing about the user. */
export interface LyricsQuery {
  /** As the player shows it, minus YouTube video noise like "(Official Video)". */
  title: string
  /** Also without "feat." and remaster notes, for searching. */
  coreTitle: string
  artist: string
  /** The first artist, for searching. */
  primaryArtist: string
  album: string
  /** 0 when the player doesn't know. */
  durationSec: number
  /**
   * Names VocaDB has for the song's other artists (its producer, the original's singers), judged
   * apart from the player's own: a record credited only to them is "others" (`Credit`).
   */
  otherArtists?: readonly string[]
  /**
   * "STORY / Leo/need": a title that credits its singers after a spaced slash, as channel
   * uploads do (the player's artist is then the channel). Searched for as well, never instead.
   */
  credits?: { title: string; artist: string }
}

/** Bracketed or trailing notes that YouTube uploads add to song titles. */
const VIDEO_NOISE =
  /\b(?:official|lyrics?|audio|video|visuali[sz]er|mv|m\/v|hd|hq|4k|explicit|color coded)\b/i
/** Notes that mean a different recording; never strip these. */
const VERSION_WORDS =
  /\b(?:live|remix|mix|acoustic|cover|instrumental|karaoke|demo|edit|version|session|unplugged|sped|slowed|nightcore)\b/i
const BRACKETED = /\s*(?:\(([^()]*)\)|\[([^[\]]*)\]|【([^】]*)】)/g
/**
 * "(feat. Someone)", in any bracket (Japanese labels use full-width ones), "feat." with or
 * without a space before the name ("feat.足立レイ"), and a bracket left open at the end; or
 * trailing "feat. Someone".
 */
const FEATURING =
  /\s*[([（［【〔]\s*(?:(?:feat|ft)\.\s*|(?:feat|ft|featuring|with)\s+)[^)\]）］】〕]*(?:[)\]）］】〕]|$)|\s+(?:(?:feat|ft)\.\s*|(?:feat|ft)\s+)\S.*$/gi
const REMASTER =
  /\s*(?:[([][^)\]]*remaster[^)\]]*[)\]]|-\s*(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?)\s*$/gi
/** "Artist - Title" uses a spaced dash; "Jay-Z" doesn't. */
const SPACED_DASH = /\s+[-–—]\s+/
/** "Title / Singers" uses a spaced slash, of either width; "Leo/need" doesn't. */
const SPACED_SLASH = /\s+[/／]\s+/

function withoutVideoNoise(title: string): string {
  const cleaned = title.replace(
    BRACKETED,
    (whole, round?: string, square?: string, lenticular?: string) => {
      const inside = round ?? square ?? lenticular ?? ''
      return VIDEO_NOISE.test(inside) && !VERSION_WORDS.test(inside) ? '' : whole
    }
  )
  // "Song | Official Video"
  const [first = cleaned] = cleaned.split(/\s+\|\s+/)
  return first.trim() || title.trim()
}

/** A title without video noise, "feat." credits or remaster notes: the part every edition shares. */
export function coreTitle(title: string): string {
  const plain = withoutVideoNoise(title)
  return plain.replace(FEATURING, '').replace(REMASTER, '').trim() || plain
}

/** A song's name in Japanese quotes, in a longer title: 「アンチサイノウ」, 『フォニイ』. */
const JAPANESE_QUOTES = /[「『]([^「」『』]+)[」』]/
/** 「Song」/ Singers: quotes end the title, so the slash needs no space before it. */
const QUOTED_CREDITS = /^[^「『]*[「『]([^「」『』]+)[」』]\s*[/／]\s*(\S.*)$/

/**
 * The song's name when a title puts it in corner brackets: 「アンチサイノウ」/ 桃井愛莉 and
 * syudou『アンチサイノウ』MV are 「アンチサイノウ」. Null when there are none (or nothing else).
 */
export function quotedTitle(title: string): string | null {
  const inside = JAPANESE_QUOTES.exec(title)?.[1]?.trim() ?? ''
  return inside !== '' && inside !== title.trim() ? inside : null
}

/** "TaylorSwiftVEVO" and "Taylor Swift - Topic" are YouTube channel names for "Taylor Swift". */
function cleanArtist(artist: string): string {
  return artist
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/(?<=\S)VEVO$/, '')
    .trim()
}

/**
 * What to look up for a song, from the player's metadata. Null when there's nothing to ask for
 * (no title). YouTube videos often put "Artist - Title" in the title; that gets split when the
 * left side is the artist, or when the player has no artist at all.
 */
export function lyricsQuery(track: {
  title: string
  artist: string
  album: string
  durationSec: number
}): LyricsQuery | null {
  let artist = cleanArtist(track.artist)
  let title = withoutVideoNoise(track.title)

  const parts = title.split(SPACED_DASH)
  if (parts.length === 2) {
    const [left = '', right = ''] = parts
    const leftIsArtist =
      artist === '' ||
      normalize(left) === normalize(artist) ||
      splitArtists(left).some((name) => normalize(name) === normalize(artist))
    if (leftIsArtist && right !== '') {
      if (artist === '') artist = left.trim()
      title = right.trim()
    }
  }

  if (title === '') return null
  const core = coreTitle(title)
  const [song = '', singers = '', ...rest] = core.split(SPACED_SLASH)
  const quoted = QUOTED_CREDITS.exec(core)
  const credits =
    rest.length === 0 && song.trim() !== '' && singers.trim() !== ''
      ? { credits: { title: song.trim(), artist: singers.trim() } }
      : quoted?.[1] && quoted[2]
        ? { credits: { title: quoted[1].trim(), artist: quoted[2].trim() } }
        : {}
  return {
    title,
    coreTitle: core,
    artist,
    primaryArtist: splitArtists(artist)[0] ?? artist,
    album: track.album.trim(),
    durationSec:
      Number.isFinite(track.durationSec) && track.durationSec > 0 ? track.durationSec : 0,
    ...credits
  }
}

/** Any bracketed part, in the brackets Western and Japanese titles use. */
const ANY_BRACKETS = /\s*[([（［【〔〈《][^)\]）］】〕〉》]*[)\]）］】〕〉》]/g
/**
 * A bracket left open at the end: what dropping "feat." leaves of 「命の轍 (Sabio feat.重音テト)」,
 * or a title cut off inside its credits.
 */
export const OPEN_BRACKET = /\s*[([（［【〔〈《][^)\]）］】〕〉》]*$/
/** Video words left outside brackets at the end: "てらてら MV", "Song - Official Video". */
const TRAILING_DECORATION =
  /(?:\s+[-–—|｜]?\s*(?:official\s+)?(?:mv|pv|m\/v|music\s+video|video|lyric\s+video|lyrics?|audio|full\s+ver(?:sion|\.)?|tv\s*size|short\s+ver(?:sion|\.)?))+\s*$/i

/**
 * The title with every bracketed note and trailing video word gone: 「てらてら [VOCALOID ver.] MV」
 * is 「てらてら」. Only to search with: whether timings fit is still judged on the whole title, so a
 * "(Live)" never borrows the studio take's. The title itself when that would leave nothing.
 */
export function bareTitle(title: string): string {
  const bare = title
    .replace(ANY_BRACKETS, ' ')
    .replace(OPEN_BRACKET, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(TRAILING_DECORATION, '')
    .trim()
  return bare || title.trim()
}

/** 「歌ってみた」 ("I tried singing it") and its kin mark a cover wherever they are. */
const COVER_WORDS = '歌ってみた|うたってみた|歌わせていただきました|カバー'
/** In brackets, "cover" alone is enough: 【歌ってみた】, (Cover), [covered by 某]. */
const COVER_IN_BRACKETS = new RegExp(`${COVER_WORDS}|\\bcover(?:ed)?\\b`, 'i')
/**
 * Outside brackets, "cover" needs "by" or a separator before it, so "Cover Me" stays a song.
 * The singer's name follows it.
 */
const COVER_OUTSIDE = new RegExp(
  `${COVER_WORDS}|\\bcover(?:ed)?\\s+by\\b|\\s[-–—|｜/／]\\s*cover\\b`,
  'i'
)
/** "Song / Singer", "Song／Singer", "Song - Original Artist": the song comes first. */
const COVER_CREDITS = /\s+[-–—/／|｜]\s+|[／｜]/

/**
 * The song a cover sings: 「フォニイ 歌ってみた 七海うらら」 and 「【歌ってみた】エンヴィーベイビー
 * covered by 獅子神レオナ」 are 「フォニイ」 and 「エンヴィーベイビー」. LRCLIB lists the original under
 * its own title and artist, never the cover singer's. Null when the title isn't a cover's.
 */
export function coverTitle(title: string): string | null {
  let found = false
  let song = title.replace(ANY_BRACKETS, (whole) => {
    if (!COVER_IN_BRACKETS.test(whole)) return whole
    found = true
    return ' '
  })
  const at = song.search(COVER_OUTSIDE)
  if (at >= 0) {
    found = true
    // 「歌ってみた フォニイ」: the word comes first, so only it goes.
    song = at === 0 ? song.replace(COVER_OUTSIDE, ' ') : song.slice(0, at)
  }
  if (!found) return null
  const [first = ''] = song.trim().split(COVER_CREDITS)
  song = bareTitle(first)
  song = quotedTitle(song) ?? song
  song = coreTitle(song).trim()
  return song !== '' && normalize(song) !== normalize(title) ? song : null
}

/** The song as its title credits it ("STORY" by "Leo/need"), to search and match that way too. */
export function creditedQuery(query: LyricsQuery): LyricsQuery | null {
  const { credits, ...rest } = query
  if (!credits) return null
  return {
    ...rest,
    title: credits.title,
    coreTitle: credits.title,
    artist: credits.artist,
    primaryArtist: splitArtists(credits.artist)[0] ?? credits.artist
  }
}

/**
 * The song under its key and a second either side. A song's key ends in its length, and players
 * report the same song a second apart from one play to the next (the queue in whole seconds, the
 * player to the millisecond): the lyrics cache allows for that, and anything else kept per song
 * (timing fixes, picks) has to as well, or it's lost on the next play and back on the one after.
 */
export function nearSongKeys(key: string): string[] {
  const cut = key.lastIndexOf('|')
  const seconds = Number(key.slice(cut + 1))
  if (cut < 0 || !Number.isInteger(seconds)) return [key]
  const song = key.slice(0, cut)
  return [key, `${song}|${seconds - 1}`, `${song}|${seconds + 1}`]
}

/**
 * Names one recording across players, for the cache and saved offsets. Duration is part of it:
 * a music video with a long intro needs different timing than the album track.
 */
export function songKey(query: LyricsQuery): string {
  return [
    normalize(query.primaryArtist),
    normalize(query.coreTitle),
    String(Math.round(query.durationSec))
  ].join('|')
}
