import { parseLrc, parsePlainLyrics } from './lrc'
import { coreTitle, type LyricsQuery } from './query'
import { normalize, similarity, splitArtists } from './text'
import type { Lyrics, LyricsSource } from './types'

/** One song's lyrics as a lyrics service lists them (LRCLIB's record, provider-neutral). */
export interface LyricsRecord {
  /** LRCLIB's own id for the record; 0 when it gave none. */
  id: number
  trackName: string
  artistName: string
  albumName: string
  /** 0 when unknown. */
  durationSec: number
  instrumental: boolean
  plainLyrics: string | null
  syncedLyrics: string | null
}

/**
 * Whom a record is credited to: the singers the player names (under any name the player or
 * VocaDB knows them by), or only other names VocaDB has for the song (its producer, the original
 * singers). irony by Nightcord at 25:00 is 「アイロニ」 by 25時、ナイトコードで。, and also by
 * すこっぷ, whose original is timed for another arrangement.
 */
export type Credit = 'singers' | 'others'

export interface Candidate {
  lyrics: Lyrics
  score: number
  credit: Credit
  record: LyricsRecord
}

/** Synced lines from a recording this much longer or shorter would drift out of step. */
const TIMING_TOLERANCE_SEC = 3
export const MIN_TITLE = 0.8
export const MIN_ARTIST = 0.6
/**
 * With no artist to compare, only the duration backs the title up: it has to be the same title
 * (or "街 - City" for "City", or the same apart from brackets), not merely a similar one.
 */
const MIN_TITLE_ALONE = 0.9

/**
 * Words that mean a different recording. Lyrics from another one may still be the right words,
 * but their timing isn't ours. Remasters, clean and explicit edits keep the timing.
 */
const VERSION_FLAGS = [
  'live',
  'remix',
  'acoustic',
  'instrumental',
  'karaoke',
  'cover',
  'demo',
  'extended',
  'stripped',
  'unplugged',
  'radio edit',
  'sped up',
  'slowed',
  'nightcore'
] as const

function versionFlags(...texts: string[]): Set<string> {
  const value = normalize(texts.join(' '))
  return new Set(VERSION_FLAGS.filter((flag) => new RegExp(`\\b${flag}\\b`).test(value)))
}

function sameFlags(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((flag) => b.has(flag))
}

const LANGUAGES =
  'english|eng|japanese|jp|korean|kor|chinese|mandarin|cantonese|spanish|espanol|french|german|' +
  'italian|portuguese|russian|indonesian|thai|vietnamese|tagalog|filipino'
/**
 * A version in another language: "English Ver.", "[English cover]", "Ver. Español", a
 * translation or romanization. Its words aren't the song's, whatever its title and length say
 * (an English cover is often sung over the very same backing track).
 */
const LANGUAGE_VERSION = new RegExp(
  `\\b(?:(${LANGUAGES})\\s+(?:ver|version|cover|lyrics|dub|translation)|(?:ver|version)\\s+(${LANGUAGES})|(translation|translated|romanized|romaji|romanization))\\b|(英語|英訳|中文|한국어)(?:版|ver|バージョン)?`
)

/** Which language version a title or album names ("english"), or null when it names none. */
export function languageVersion(...texts: string[]): string | null {
  const value = normalize(texts.join(' '))
  const found = LANGUAGE_VERSION.exec(value)
  if (!found) return null
  const named = found.slice(1).find((part) => part !== undefined) ?? ''
  // "eng" and "english" are one language; a translation is any other one.
  return named === 'eng' ? 'english' : named === 'jp' ? 'japanese' : named
}

/** "街 - City" holds "City"; so does "Moonlight / City". */
function segments(title: string): string[] {
  return title
    .split(/\s+[-–—]\s+|\s*\/\s*|・/)
    .map(normalize)
    .filter((part) => part !== '')
}

export function titleScore(query: LyricsQuery, candidateTitle: string): number {
  const candidateCore = coreTitle(candidateTitle)
  const ours = [normalize(query.coreTitle), normalize(query.title)]
  const theirs = [normalize(candidateCore), normalize(candidateTitle)]
  if (ours.some((title) => theirs.includes(title))) return 1
  const ourCore = ours[0] ?? ''
  const theirCore = theirs[0] ?? ''
  if (segments(candidateCore).includes(ourCore) || segments(query.coreTitle).includes(theirCore)) {
    return 0.95
  }
  // "Song (Live)" is still "Song"; the version check decides whether its timing is any use.
  if (normalize(withoutBrackets(candidateCore)) === normalize(withoutBrackets(query.coreTitle))) {
    return 0.9
  }
  return Math.max(...ours.flatMap((a) => theirs.map((b) => similarity(a, b))))
}

function withoutBrackets(title: string): string {
  return title.replace(/\s*[([][^)\]]*[)\]]/g, '').trim() || title
}

/**
 * Singers some players name in English and LRCLIB in Japanese: Project SEKAI's units, which
 * YouTube Music romanizes. Only the ones whose names differ by more than width or punctuation.
 */
const ARTIST_ALIASES: readonly (readonly string[])[] = [
  ['ワンダーランズ×ショウタイム', 'Wonderlands×Showtime', 'Wonderlands x Showtime'],
  ['25時、ナイトコードで。', '25-ji, Nightcord de.', 'Nightcord at 25:00'],
  ['バーチャル・シンガー', 'Virtual Singer']
]
const ALIAS_OF = new Map(
  ARTIST_ALIASES.flatMap((names) =>
    names.map((name) => [normalize(name), normalize(names[0] ?? name)])
  )
)
/** One spelling per artist, so its English and Japanese names compare equal. */
const canonical = (name: string): string => ALIAS_OF.get(name) ?? name

export function artistScore(query: LyricsQuery, candidateArtist: string): number {
  if (query.artist === '') return 0
  const ours = canonical(normalize(query.artist))
  const theirs = canonical(normalize(candidateArtist))
  if (ours === theirs) return 1
  // Each name whole as well as split: "Wonderlands x Showtime" is one unit, not two singers.
  const names = (artist: string): string[] => [
    ...new Set(
      [...splitArtists(artist), ...artist.split(/\s*[,;、]\s*/)].map((name) =>
        canonical(normalize(name))
      )
    )
  ]
  const ourNames = names(query.artist)
  const theirNames = names(candidateArtist)
  if (ourNames.some((name) => theirNames.includes(name))) return 0.9
  const pairs = [ours, ...ourNames].flatMap((a) => [theirs, ...theirNames].map((b) => [a, b]))
  return Math.max(...pairs.map(([a = '', b = '']) => similarity(a, b)))
}

/** The lyrics a record holds, synced only when its timing fits our recording. Null when it has none. */
export function recordLyrics(
  record: LyricsRecord,
  timingFits: boolean,
  source: LyricsSource
): Lyrics | null {
  if (record.instrumental) return { kind: 'instrumental', source }
  const synced = record.syncedLyrics ? parseLrc(record.syncedLyrics) : null
  if (synced && timingFits) return { kind: 'synced', lines: synced, source }
  const plain = record.plainLyrics
    ? parsePlainLyrics(record.plainLyrics)
    : synced
      ? parsePlainLyrics(synced.map((line) => line.text).join('\n'))
      : null
  return plain ? { kind: 'plain', lines: plain, source } : null
}

/**
 * Whether a record is our song, and how good a match it is. Null when it isn't (or has no
 * lyrics). Title and artist must both agree; with no artist to compare, the duration has to,
 * and the title more closely.
 */
export function evaluate(
  query: LyricsQuery,
  record: LyricsRecord,
  source: LyricsSource
): Candidate | null {
  const title = titleScore(query, record.trackName)
  if (title < MIN_TITLE) return null
  const own = artistScore(query, record.artistName)
  const otherArtists = query.otherArtists ?? []
  const others =
    otherArtists.length > 0
      ? artistScore({ ...query, artist: otherArtists.join(', ') }, record.artistName)
      : 0
  const named = query.artist !== '' || otherArtists.length > 0
  const durationGap =
    query.durationSec > 0 && record.durationSec > 0
      ? Math.abs(query.durationSec - record.durationSec)
      : null
  if (
    named
      ? own < MIN_ARTIST && others < MIN_ARTIST
      : title < MIN_TITLE_ALONE || durationGap === null || durationGap > 2
  ) {
    return null
  }
  const credit: Credit = named && own >= MIN_ARTIST ? 'singers' : 'others'

  // Another language's words are never ours: an English cover of a Japanese song can have
  // the same title, producer and length, and lyrics nobody here is singing.
  const theirLanguage = languageVersion(record.trackName, record.albumName)
  if (theirLanguage && theirLanguage !== languageVersion(query.title, query.album)) return null

  const ourFlags = versionFlags(query.title, query.album)
  const theirFlags = versionFlags(record.trackName, record.albumName)
  // An instrumental take of a song with vocals isn't "no lyrics" for ours.
  if (theirFlags.has('instrumental') && !ourFlags.has('instrumental')) return null
  const sameVersion = sameFlags(ourFlags, theirFlags)
  const timingFits = sameVersion && (durationGap === null || durationGap <= TIMING_TOLERANCE_SEC)

  const found = recordLyrics(record, timingFits, source)
  if (!found) return null
  // LRCLIB's lyrics say which record they are, so a re-check can tell the singers' own later.
  const lyrics: Lyrics =
    source === 'lrclib' && record.id > 0
      ? {
          ...found,
          from: {
            id: record.id,
            artist: record.artistName,
            durationSec: record.durationSec,
            credit
          }
        }
      : found

  const albumMatches = query.album !== '' && normalize(query.album) === normalize(record.albumName)
  // By the second, so 251 s beats 253 s for a 251 s song (the old 0–2 s step called them equal).
  const durationPoints = durationGap === null ? 0 : Math.max(0, 10 - 2 * durationGap)
  const artist = credit === 'singers' ? own : 0.7 * others
  const score =
    50 * title + 30 * artist + (albumMatches ? 10 : 0) + durationPoints + (sameVersion ? 0 : -20)
  return { lyrics, score, credit, record }
}

const KIND_RANK: Record<Lyrics['kind'], number> = { synced: 2, plain: 1, instrumental: 0 }

/**
 * Any words beat an "instrumental" entry for the same title (they prove it has vocals); then the
 * singers' own version beats another name's, even untimed (the user's call: an original's timing
 * can be completely off for a cover of the same length, and auto-sync times the words); then
 * timed lyrics beat plain text. Between equals, the closer match wins.
 */
export function better(a: Candidate | null, b: Candidate | null): Candidate | null {
  if (!a || !b) return a ?? b
  const wordsA = a.lyrics.kind !== 'instrumental'
  if (wordsA !== (b.lyrics.kind !== 'instrumental')) return wordsA ? a : b
  if (a.credit !== b.credit) return a.credit === 'singers' ? a : b
  const rankA = KIND_RANK[a.lyrics.kind]
  const rankB = KIND_RANK[b.lyrics.kind]
  if (rankA !== rankB) return rankA > rankB ? a : b
  return b.score > a.score ? b : a
}

export function pickBest(
  query: LyricsQuery,
  records: readonly LyricsRecord[],
  source: LyricsSource
): Candidate | null {
  let best: Candidate | null = null
  for (const record of records) best = better(best, evaluate(query, record, source))
  return best
}
