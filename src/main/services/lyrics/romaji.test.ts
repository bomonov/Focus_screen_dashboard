import { describe, expect, it } from 'vitest'
import { alignRomaji, pairRomaji, splitRomaji, wantsRomaji, type RomajiPair } from './romaji'

// Made-up lines, written for these tests.
const PAIRS: RomajiPair[] = [
  { sung: 'あさのひかりがまどをてらす', romaji: 'asa no hikari ga mado wo terasu' },
  { sung: 'きみのこえがきこえたきがした', romaji: 'kimi no koe ga kikoeta ki ga shita' },
  { sung: 'ゆめのつづきをさがしにいこう', romaji: 'yume no tsuzuki wo sagashi ni ikou' },
  { sung: 'よるがあけるまでうたっていよう', romaji: 'yoru ga akeru made utatte iyou' }
]
const SUNG = PAIRS.map((pair) => pair.sung)
const ROMAJI = PAIRS.map((pair) => pair.romaji)

describe('wantsRomaji', () => {
  it('wants Japanese lyrics, even with a few English lines', () => {
    expect(wantsRomaji(SUNG)).toBe(true)
    expect(wantsRomaji([...SUNG, 'Hello, hello', '', '♪'])).toBe(true)
  })

  it('skips English, Chinese, and lyrics that already carry their romaji', () => {
    expect(wantsRomaji(['Walking down the road', 'Under the morning sun'])).toBe(false)
    expect(wantsRomaji(['月亮代表我的心', '你问我爱你有多深'])).toBe(false)
    expect(wantsRomaji(PAIRS.flatMap((pair) => [pair.sung, pair.romaji]))).toBe(false)
    expect(wantsRomaji(['', '  '])).toBe(false)
  })
})

describe('pairRomaji', () => {
  // Four more made-up lines, for a song long enough to lose a line or two and still pair.
  const MORE: RomajiPair[] = [
    { sung: 'かぜがふいてもまえをむいて', romaji: 'kaze ga fuite mo mae wo muite' },
    { sung: 'ほしのひかりをてにとって', romaji: 'hoshi no hikari wo te ni totte' },
    { sung: 'なみだのあとにはにじがでる', romaji: 'namida no ato ni wa niji ga deru' },
    { sung: 'またあしたここであおうね', romaji: 'mata ashita koko de aou ne' }
  ]
  const SONG = [...PAIRS, ...MORE]
  const sung = SONG.map((pair) => pair.sung).join('\n')

  it('pairs VocaDB’s lines with their romanization, ignoring blank lines', () => {
    const original = `${SUNG[0]}\n${SUNG[1]}\n\n${SUNG[2]}\r\n${SUNG[3]}`
    const romanized = `${ROMAJI[0]}\n${ROMAJI[1]}\n${ROMAJI[2]}\n\n\n${ROMAJI[3]}`
    expect(pairRomaji(original, romanized)).toEqual(PAIRS)
  })

  it('pairs a line whose romaji VocaDB split in two with both halves', () => {
    const romaji = SONG.map((pair) => pair.romaji)
    romaji.splice(1, 1, 'kimi no koe ga', 'kikoeta ki ga shita')
    expect(pairRomaji(sung, romaji.join('\n'))).toEqual(SONG)
  })

  it('leaves out a line whose romaji is missing, and pairs the rest', () => {
    const romaji = SONG.map((pair) => pair.romaji)
    romaji.splice(5, 1)
    expect(pairRomaji(sung, romaji.join('\n'))).toEqual(SONG.filter((_, index) => index !== 5))
  })

  it('never pairs by position when a split and a join shift the lines between', () => {
    // Same number of lines, but line 3's romaji is split and its second half joined to line 4's.
    const romaji = SONG.map((pair) => pair.romaji)
    romaji.splice(2, 2, 'yume no tsuzuki wo', 'sagashi ni ikou yoru ga akeru made utatte iyou')
    const pairs = pairRomaji(sung, romaji.join('\n')) ?? []
    expect(pairs).not.toContainEqual({ sung: SONG[2]?.sung, romaji: 'yume no tsuzuki wo' })
    expect(pairs).toEqual(expect.arrayContaining([SONG[0], SONG[1], SONG[4], SONG[7]]))
  })

  it('gives up when the two don’t match, or one is empty', () => {
    expect(pairRomaji(sung, 'la\nla la\nla')).toBeNull()
    expect(pairRomaji('', '')).toBeNull()
  })
})

describe('alignRomaji', () => {
  it('puts each romaji line under its own line', () => {
    expect(alignRomaji(SUNG, PAIRS)).toEqual(ROMAJI)
  })

  it('leaves breaks, extra lines and lines VocaDB lacks without romaji', () => {
    const shown = [
      '',
      SUNG[0] ?? '',
      'Music: Someone',
      SUNG[1] ?? '',
      'まったくちがうことばのならび',
      ''
    ]
    expect(alignRomaji(shown, PAIRS)).toEqual(['', ROMAJI[0], '', ROMAJI[1], '', ''])
  })

  it('lines a repeated chorus up with its own repeat', () => {
    const pairs = [...PAIRS.slice(0, 2), ...PAIRS.slice(0, 2)].map((pair, index) => ({
      ...pair,
      romaji: `${pair.romaji} (${index})`
    }))
    const shown = [SUNG[0] ?? '', SUNG[1] ?? '', SUNG[0] ?? '', SUNG[1] ?? '']
    expect(alignRomaji(shown, pairs)).toEqual(pairs.map((pair) => pair.romaji))
  })

  it('matches lines that differ a little, but not half a line', () => {
    // A word in kanji instead of kana, punctuation, and a reading in brackets.
    const shown = ['朝のひかりがまどをてらす！', 'きみの声(こえ)がきこえたきがした', 'ゆめのつづき']
    expect(alignRomaji(shown, PAIRS)).toEqual([ROMAJI[0], ROMAJI[1], ''])
  })

  it('joins the romaji of two lines the shown lyrics put on one', () => {
    const shown = [`${SUNG[0]} ${SUNG[1]}`, SUNG[2] ?? '']
    expect(alignRomaji(shown, PAIRS)).toEqual([`${ROMAJI[0]} ${ROMAJI[1]}`, ROMAJI[2]])
  })

  it('is null when no line matches', () => {
    expect(alignRomaji(['まったくちがうことばのならび'], PAIRS)).toBeNull()
    expect(alignRomaji([], PAIRS)).toBeNull()
  })

  it('cuts the romaji of one of VocaDB’s lines the shown lyrics split in two or three', () => {
    const pairs = [
      { sung: 'あさのひかりが　まどをてらす', romaji: 'asa no hikari ga mado wo terasu' },
      {
        sung: 'きみのこえが きこえた きがした',
        romaji: 'kimi no koe ga kikoeta ki ga shita'
      },
      ...PAIRS.slice(2)
    ]
    const shown = [
      'あさのひかりが',
      'まどをてらす',
      'きみのこえが',
      'きこえた',
      'きがした',
      SUNG[2] ?? ''
    ]
    expect(alignRomaji(shown, pairs)).toEqual([
      'asa no hikari ga',
      'mado wo terasu',
      'kimi no koe ga',
      'kikoeta',
      'ki ga shita',
      ROMAJI[2]
    ])
  })

  it('cuts a line one copy writes a word of in kanji and the other in kana (達, たち)', () => {
    const pairs = [
      {
        sung: 'ぼくらのゆめはいつまでも君達のものだったんだよ',
        romaji: 'bokura no yume wa itsumademo kimitachi no mono dattan da yo'
      }
    ]
    expect(alignRomaji(['ぼくらのゆめはいつまでも', '君たちのものだったんだよ'], pairs)).toEqual([
      'bokura no yume wa itsumademo',
      'kimitachi no mono dattan da yo'
    ])
  })

  it('gives a stanza gap no piece of a line split around it', () => {
    const pairs = [
      { sung: '※ あさのひかりが まどをてらす', romaji: '※ asa no hikari ga mado wo terasu' }
    ]
    expect(alignRomaji(['', '※ あさのひかりが', 'まどをてらす'], pairs)).toEqual([
      '',
      '※ asa no hikari ga',
      'mado wo terasu'
    ])
  })

  it('never cuts across lines that only look like VocaDB’s', () => {
    // Together the shown lines are VocaDB's line and more: its romaji isn't spread over them.
    const pairs = [{ sung: 'ゆめのつづきをさがしに', romaji: 'yume no tsuzuki wo sagashi ni' }]
    expect(alignRomaji(['ゆめのつづき', 'をさがしにいくよ'], pairs)).toBeNull()
  })
})

describe('splitRomaji', () => {
  const shown = ['あさのひかりが', 'まどをてらす']

  it('cuts where each piece fits its line, in length and sound', () => {
    expect(splitRomaji(shown, 'asa no hikari ga mado wo terasu', 1)).toEqual([
      'asa no hikari ga',
      'mado wo terasu'
    ])
    // Shi, chi and ji with a small ya, yu or yo are spelled as romaji has them.
    expect(
      splitRomaji(['きみがいなくちゃ', 'まどをてらす'], 'kimi ga inakucha mado wo terasu', 1)
    ).toEqual(['kimi ga inakucha', 'mado wo terasu'])
  })

  it('knows a line ending on the particle は is sung "wa"', () => {
    expect(splitRomaji(['きのうのそらは', 'あおかった'], 'kinou no sora wa aokatta', 1)).toEqual([
      'kinou no sora wa',
      'aokatta'
    ])
  })

  it('hears a small vowel after its own as a long one, written out or with a macron', () => {
    const shown = ['もういいかいねぇ', 'まだだよ']
    expect(splitRomaji(shown, 'mou ii kai nee mada da yo', 1)).toEqual([
      'mou ii kai nee',
      'mada da yo'
    ])
    expect(splitRomaji(shown, 'mō ii kai nē mada da yo', 1)).toEqual(['mō ii kai nē', 'mada da yo'])
  })

  it('gives nothing when the romaji has lost part of the line', () => {
    expect(splitRomaji(shown, 'asa no hikari ga mado', 1)).toBeNull()
  })

  it('gives nothing for a cut between two kanji, where nothing says where it goes', () => {
    expect(splitRomaji(['朝光照', '窓辺夢'], 'asahi teru madobe yume', 1)).toBeNull()
  })

  it('lets a line’s English words say where it ends', () => {
    expect(
      splitRomaji(['Go round and round', '窓辺の夢'], 'Go round and round madobe no yume', 1)
    ).toEqual(['Go round and round', 'madobe no yume'])
  })
})
