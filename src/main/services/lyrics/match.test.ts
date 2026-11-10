import { describe, expect, it } from 'vitest'
import {
  artistScore,
  better,
  type Candidate,
  pickBest,
  titleScore,
  languageVersion,
  type LyricsRecord,
  recordLyrics,
  evaluate
} from './match'
import { lyricsQuery, type LyricsQuery } from './query'

function query(title: string, artist: string, album = '', durationSec = 220): LyricsQuery {
  const result = lyricsQuery({ title, artist, album, durationSec })
  if (!result) throw new Error('no query')
  return result
}

const SYNCED = '[00:10.00]First line\n[00:15.00]Second line'

function record(change: Partial<LyricsRecord> = {}): LyricsRecord {
  return {
    id: 0,
    trackName: 'City',
    artistName: 'Vivid BAD SQUAD',
    albumName: 'Moonlight/City',
    durationSec: 220,
    instrumental: false,
    plainLyrics: 'First line\nSecond line',
    syncedLyrics: SYNCED,
    ...change
  }
}

describe('titleScore', () => {
  it('finds a title inside a translated or credited one', () => {
    // A real LRCLIB record for what YouTube Music calls "City".
    const q = query('City', 'Vivid BAD SQUAD')
    expect(titleScore(q, '街 - City (feat. 小豆沢こはね&白石杏&東雲彰人&青柳冬弥&鏡音リン)')).toBe(
      0.95
    )
  })

  it('ignores credits, case and punctuation', () => {
    const q = query("Don't Stop Me Now", 'Queen')
    expect(titleScore(q, "Don't Stop Me Now - Remastered 2011")).toBe(1)
    expect(titleScore(q, 'dont stop me now')).toBe(1)
  })

  it('scores different songs low', () => {
    expect(titleScore(query('City', 'A'), 'Country Roads')).toBeLessThan(0.8)
  })
})

describe('artistScore', () => {
  it('knows Project SEKAI’s units by their English and Japanese names', () => {
    const asked = (artist: string): LyricsQuery => {
      const result = lyricsQuery({ title: 'Song', artist, album: '', durationSec: 200 })
      if (!result) throw new Error('no query')
      return result
    }
    expect(artistScore(asked('Wonderlands×Showtime'), 'ワンダーランズ×ショウタイム')).toBe(1)
    expect(artistScore(asked('25-ji, Nightcord de.'), '25時、ナイトコードで。')).toBe(1)
    expect(artistScore(asked('Nightcord at 25:00'), '25時、ナイトコードで。')).toBe(1)
    expect(artistScore(asked('Virtual Singer, Hatsune Miku'), 'バーチャル・シンガー')).toBe(0.9)
    expect(artistScore(asked('Wonderlands×Showtime'), 'Vivid BAD SQUAD')).toBeLessThan(0.6)
  })

  it('matches one of several credited artists', () => {
    expect(artistScore(query('Song', 'Adele'), 'Adele, Someone')).toBe(0.9)
    expect(artistScore(query('Song', 'Simon & Garfunkel'), 'Simon and Garfunkel')).toBe(1)
  })

  it('matches a channel name without spaces', () => {
    expect(artistScore(query('Song', 'TaylorSwiftVEVO'), 'Taylor Swift')).toBeGreaterThan(0.9)
  })

  it('is 0 when the player has no artist', () => {
    expect(artistScore(query('Song', ''), 'Anyone')).toBe(0)
  })
})

describe('recordLyrics', () => {
  it('prefers synced lyrics when the timing fits', () => {
    expect(recordLyrics(record(), true, 'lrclib')?.kind).toBe('synced')
  })

  it('falls back to plain text when the timing does not fit', () => {
    expect(recordLyrics(record(), false, 'lrclib')).toEqual({
      kind: 'plain',
      lines: ['First line', 'Second line'],
      source: 'lrclib'
    })
  })

  it('takes plain text from synced lyrics when there is no plain copy', () => {
    expect(recordLyrics(record({ plainLyrics: null }), false, 'lrclib')).toEqual({
      kind: 'plain',
      lines: ['First line', 'Second line'],
      source: 'lrclib'
    })
  })

  it('reports instrumentals and records without lyrics', () => {
    expect(recordLyrics(record({ instrumental: true }), true, 'lrclib')?.kind).toBe('instrumental')
    expect(
      recordLyrics(record({ plainLyrics: null, syncedLyrics: null }), true, 'lrclib')
    ).toBeNull()
  })
})

describe('evaluate', () => {
  it('accepts the same recording with synced lyrics', () => {
    const candidate = evaluate(
      query('City', 'Vivid BAD SQUAD', 'Moonlight/City'),
      record(),
      'lrclib'
    )
    expect(candidate?.lyrics.kind).toBe('synced')
  })

  it('rejects another artist', () => {
    expect(evaluate(query('City', 'Someone Else'), record(), 'lrclib')).toBeNull()
  })

  it('keeps only the words from a recording of another length', () => {
    const candidate = evaluate(query('City', 'Vivid BAD SQUAD', '', 260), record(), 'lrclib')
    expect(candidate?.lyrics.kind).toBe('plain')
  })

  it('keeps only the words from a live or remixed version', () => {
    const live = evaluate(
      query('City', 'Vivid BAD SQUAD'),
      record({ trackName: 'City (Live)' }),
      'lrclib'
    )
    expect(live?.lyrics.kind).toBe('plain')
  })

  it('never takes an instrumental version for a sung one', () => {
    const karaoke = record({ trackName: 'City (Instrumental)', instrumental: true })
    expect(evaluate(query('City', 'Vivid BAD SQUAD'), karaoke, 'lrclib')).toBeNull()
  })

  it('needs a close duration when the player has no artist', () => {
    expect(evaluate(query('City', '', '', 221), record(), 'lrclib')?.lyrics.kind).toBe('synced')
    expect(evaluate(query('City', '', '', 240), record(), 'lrclib')).toBeNull()
    expect(evaluate(query('City', '', '', 0), record(), 'lrclib')).toBeNull()
  })

  it('needs the same title, not just a similar one, when the player has no artist', () => {
    const greens = record({ trackName: 'Greens' })
    expect(evaluate(query('Green', 'Vivid BAD SQUAD', '', 220), greens, 'lrclib')).not.toBeNull()
    expect(evaluate(query('Green', '', '', 220), greens, 'lrclib')).toBeNull()
    expect(
      evaluate(query('Green', '', '', 220), record({ trackName: 'Green' }), 'lrclib')
    ).not.toBeNull()
  })
})

describe('better and pickBest', () => {
  const by = { credit: 'singers' as const, record: record() }
  const synced: Candidate = {
    lyrics: { kind: 'synced', lines: [], source: 'lrclib' },
    score: 50,
    ...by
  }
  const plain: Candidate = {
    lyrics: { kind: 'plain', lines: ['a'], source: 'lrclib' },
    score: 99,
    ...by
  }
  const instrumental: Candidate = {
    lyrics: { kind: 'instrumental', source: 'lrclib' },
    score: 99,
    ...by
  }

  it('ranks synced over plain over instrumental, then by score', () => {
    expect(better(plain, synced)).toBe(synced)
    expect(better(instrumental, plain)).toBe(plain)
    expect(better(null, plain)).toBe(plain)
    expect(better({ ...synced, score: 60 }, synced)?.score).toBe(60)
  })

  it('picks the closest synced match from search results', () => {
    const q = query('City', 'Vivid BAD SQUAD', 'Moonlight/City')
    const results = [
      record({ trackName: 'City Lights', artistName: 'Other' }),
      record({ syncedLyrics: null, plainLyrics: 'Plain' }),
      record({ durationSec: 221 }),
      record()
    ]
    const best = pickBest(q, results, 'lrclib')
    expect(best?.lyrics.kind).toBe('synced')
    expect(best?.score).toBe(evaluate(q, record(), 'lrclib')?.score)
  })

  it('is null when nothing matches', () => {
    expect(pickBest(query('Nope', 'Nobody'), [record()], 'lrclib')).toBeNull()
  })
})

describe('another language’s version', () => {
  it('names the language a title or album marks', () => {
    expect(languageVersion('CYBERPUNK DEAD BOY - English Ver.')).toBe('english')
    expect(languageVersion('Cyberpunk Dead Boy  [English Ver.]')).toBe('english')
    expect(languageVersion('Song (Eng cover)')).toBe('english')
    expect(languageVersion('Canción', 'Versión Español')).toBe('espanol')
    expect(languageVersion('Song (Romanized)')).toBe('romanized')
    expect(languageVersion('夜に駆ける 英語版')).toBe('英語')
    expect(languageVersion('CYBER PUNK DEAD BOY')).toBeNull()
    expect(languageVersion('Englishman in New York')).toBeNull()
  })

  it('never takes another language’s words, however well the rest fits', () => {
    // An English cover over the same backing track: same title, producer and length.
    const english = record({
      trackName: 'CYBERPUNK DEAD BOY - English Ver.',
      artistName: 'MAIKI P',
      albumName: 'CYBERPUNK DEAD BOY (feat. Mizzy Licias) [English Ver.]',
      durationSec: 226
    })
    const ours = query('CYBERPUNK DEAD BOY', 'MAIKI P', '', 227)
    expect(evaluate(ours, english, 'lrclib')).toBeNull()
    // Unless that version is the one playing.
    const theirs = query('CYBERPUNK DEAD BOY (English Ver.)', 'MAIKI P', '', 227)
    expect(evaluate(theirs, english, 'lrclib')).not.toBeNull()
  })
})

describe('a unit named with an x', () => {
  it('matches its other spelling inside a list of artists, too', () => {
    const ours = query('サイバーパンクデッドボーイ', 'Wonderlands x Showtime, マイキP', '', 227)
    expect(artistScore(ours, 'ワンダーランズ×ショウタイム')).toBeGreaterThanOrEqual(0.9)
    expect(artistScore(query('Song', 'MAIKI P'), 'MAIKI P; Mizzy Licias')).toBeGreaterThanOrEqual(
      0.9
    )
  })
})

describe("versions of the same song (irony: Nightcord at 25:00 sings scop's アイロニ)", () => {
  // LRCLIB's records as its search for アイロニ lists them (2026-10-22), lines cut short.
  const scop253 = record({
    id: 20951492,
    trackName: 'アイロニ',
    artistName: 'すこっぷ feat. Rid',
    albumName: 'VOCAROCK collection Utattemita',
    durationSec: 253,
    plainLyrics: null,
    syncedLyrics:
      '[00:05.44] 少し歩き疲れたんだ 少し歩き疲れたんだ\n[00:07.47] 月並みな表現だけど 人生とかいう長い道を'
  })
  const nightcord251 = record({
    id: 10604292,
    trackName: 'アイロニ',
    artistName: '25時、ナイトコードで。 feat. 宵崎奏&朝比奈まふゆ&東雲絵名&暁山瑞希&鏡音レン',
    albumName: '25時、ナイトコードで。 SEKAI ALBUM vol.2',
    durationSec: 251,
    plainLyrics: null,
    syncedLyrics:
      '[00:00.55] 少し歩き疲れたんだ\n[00:03.38] 少し歩き疲れたんだ\n[00:06.05] 月並みな表現だけど'
  })
  const scop250 = record({
    id: 4155154,
    trackName: 'アイロニ',
    artistName: 'すこっぷ feat. Rid',
    albumName: 'EXIT TUNES PRESENTS START',
    durationSec: 250,
    plainLyrics: null,
    syncedLyrics:
      '[00:05.44] 少し歩き疲れたんだ 少し歩き疲れたんだ\n[00:07.47] 月並みな表現だけど 人生とかいう長い道を'
  })
  // What lookupAs judges by: the player's title and singers, VocaDB's names apart.
  const irony: LyricsQuery = {
    ...query('irony', 'Nightcord at 25:00', '', 251),
    coreTitle: 'アイロニ',
    otherArtists: ['すこっぷ', 'Rid']
  }

  it("prefers the singers' own version over the original's, in the search's order", () => {
    const best = pickBest(irony, [scop253, nightcord251, scop250], 'lrclib')
    expect(best?.record.id).toBe(10604292)
    expect(best?.credit).toBe('singers')
  })

  it("takes the singers' plain words over another version's timed lines", () => {
    const plainNightcord = {
      ...nightcord251,
      syncedLyrics: null,
      plainLyrics: '少し歩き疲れたんだ'
    }
    const best = pickBest(irony, [scop250, plainNightcord], 'lrclib')
    expect(best?.lyrics.kind).toBe('plain')
    expect(best?.credit).toBe('singers')
  })

  it('between equals, the closer length wins', () => {
    // Same singer, both synced: 1 s off beats 2 s off (both scored 10 before).
    const best = pickBest(
      query('City', 'Vivid BAD SQUAD', '', 200),
      [record({ id: 1, durationSec: 202 }), record({ id: 2, durationSec: 201 })],
      'lrclib'
    )
    expect(best?.record.id).toBe(2)
  })

  it('still takes a name VocaDB knows when no version by the singers exists', () => {
    expect(pickBest(irony, [scop250], 'lrclib')?.credit).toBe('others')
  })

  it('any words still beat an instrumental entry, even one credited to the singers', () => {
    const best = pickBest(irony, [{ ...nightcord251, instrumental: true }, scop250], 'lrclib')
    expect(best?.record.id).toBe(4155154)
  })
})
