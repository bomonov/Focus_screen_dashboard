import { describe, expect, it } from 'vitest'
import { contrast } from '../../theme/color'
import { PRESETS } from '../../theme/presets'
import {
  colorParts,
  partGradient,
  partStyle,
  pieceSpan,
  romajiCuts,
  romajiMorae,
  romajiPieces,
  rowPaint,
  singerHexes,
  singerLookup,
  singersInOrder,
  wordParts,
  type ColorPart
} from './singerColors'

const NIGHT_CARD = '#191919'
const DAY_CARD = PRESETS.find((preset) => preset.id === 'day')?.colors.card ?? ''

const night = (ids: readonly string[]): string[] => singerHexes(ids, [], NIGHT_CARD)

describe('singerHexes', () => {
  it('fits pale colors to the card', () => {
    // Len's yellow is nearly invisible on Daylight's white card until it's darkened.
    const [len] = singerHexes(['len'], [], DAY_CARD)
    expect(len).toBeDefined()
    expect(contrast(len ?? '', DAY_CARD)).toBeGreaterThanOrEqual(3)
    expect(len).not.toBe('#FFEE11')
  })

  it('leaves a color that already reads exactly as it is', () => {
    expect(singerHexes(['shizuku'], [], NIGHT_CARD)).toEqual(['#99EEDD'])
  })

  it('looks ids up in the cast first, then in the song’s extra singers, and skips the unknown', () => {
    const extra = [{ id: 'x1', name: 'Guest', color: '#FF00FF' }]
    expect(singerHexes(['miku', 'x1', 'nobody'], extra, NIGHT_CARD)).toEqual(['#33CCBB', '#FF00FF'])
  })

  it('does not take Object.prototype names for singers', () => {
    expect(night(['constructor', '__proto__', 'toString'])).toEqual([])
  })

  it('fits an extra singer’s color too', () => {
    const extra = [{ id: 'x1', name: 'Guest', color: '#FFFF66' }]
    const [color] = singerHexes(['x1'], extra, DAY_CARD)
    expect(contrast(color ?? '', DAY_CARD)).toBeGreaterThanOrEqual(3)
  })
})

describe('colorParts', () => {
  it('groups runs of neighbouring words with the same singers', () => {
    const parts = colorParts([['ichika'], ['ichika'], ['ichika', 'minori'], null], night)
    expect(parts).toEqual([
      { from: 0, to: 2, colors: night(['ichika']) },
      { from: 2, to: 3, colors: night(['ichika', 'minori']) }
    ])
  })

  it('breaks a run at a word nobody sings, and gives that word no part', () => {
    const parts = colorParts([['rin'], null, ['rin']], night)
    expect(parts.map((part) => [part.from, part.to])).toEqual([
      [0, 1],
      [2, 3]
    ])
  })

  it('compares singers in order, so the same two the other way round is a new part', () => {
    const parts = colorParts(
      [
        ['rin', 'len'],
        ['len', 'rin']
      ],
      night
    )
    expect(parts.map((part) => [part.from, part.to])).toEqual([
      [0, 1],
      [1, 2]
    ])
  })

  it('gives words whose singers have no color no part', () => {
    expect(colorParts([['nobody'], ['nobody']], night)).toEqual([])
  })

  it('is empty for a line nobody sings', () => {
    expect(colorParts([], night)).toEqual([])
    expect(colorParts([null, null], night)).toEqual([])
  })
})

describe('partGradient', () => {
  it('has two equal stops for one color', () => {
    expect(partGradient(['#33AAEE'])).toBe('linear-gradient(90deg, #33AAEE 0%, #33AAEE 100%)')
  })

  it('spreads several colors evenly from 0% to 100%', () => {
    expect(partGradient(['#111111', '#222222'])).toBe(
      'linear-gradient(90deg, #111111 0%, #222222 100%)'
    )
    expect(partGradient(['#111111', '#222222', '#333333'])).toBe(
      'linear-gradient(90deg, #111111 0%, #222222 50%, #333333 100%)'
    )
    expect(partGradient(['#111111', '#222222', '#333333', '#444444'])).toBe(
      'linear-gradient(90deg, #111111 0%, #222222 33.33%, #333333 66.67%, #444444 100%)'
    )
  })

  it('is empty (no gradient) with no colors', () => {
    expect(partGradient([])).toBe('')
  })
})

describe('romajiCuts', () => {
  const part = (from: number, to: number): ColorPart => ({ from, to, colors: ['#FFFFFF'] })
  // Two parts: ああ | いい, two beats each, so the boundary is halfway through the sounds.
  const twoParts = [part(0, 1), part(1, 2)]
  const words = ['ああ', 'いい']
  const line = 'ああいい'

  it('takes the user’s cuts as they are, even none', () => {
    expect(romajiCuts('aaaaaaaa', line, twoParts, words, [3, 5])).toEqual([3, 5])
    expect(romajiCuts('aa ii', line, twoParts, words, [])).toEqual([])
  })

  it('cuts at the space where the romaji’s sounds are shared as the Japanese’s are', () => {
    expect(romajiCuts('aa ii', line, twoParts, words, null)).toEqual([2])
  })

  it('cuts the demo’s duet line after “arigatou” and after “ni”', () => {
    // ありがとう | 永遠に | 星空の下で: a kanji sounds about two beats, so counting characters
    // put the cuts after "ni" and "hoshizora" instead.
    const duet = ['ありがとう ', '永遠に ', '星空の下で']
    const threeParts = [part(0, 1), part(1, 2), part(2, 3)]
    const romaji = 'arigatou eien ni hoshizora no shita de'
    expect(romajiCuts(romaji, duet.join(''), threeParts, duet, null)).toEqual([8, 16])
  })

  it('takes the earlier space when two are as near', () => {
    // 2.5 of 5 morae, with "aa" ending at 2 and "a" at 3, each half a mora off.
    expect(romajiCuts('aa a aa', line, twoParts, words, null)).toEqual([2])
  })

  it('is not sure when no space is within a mora, so the romaji gets a gradient', () => {
    expect(romajiCuts('aaaaaaaaaaaa', line, twoParts, words, null)).toBeNull()
    // Halfway is 3 of 6 morae; the only space comes after 5.
    expect(romajiCuts('aaaaa i', line, twoParts, words, null)).toBeNull()
  })

  it('has nothing to cut with fewer than two parts', () => {
    expect(romajiCuts('aa ii', line, [], words, null)).toEqual([])
    expect(romajiCuts('aa ii', line, [part(0, 2)], words, null)).toEqual([])
  })

  it('is not sure when two boundaries would land on the same space', () => {
    const threeParts = [part(0, 1), part(1, 2), part(2, 3)]
    const jp = ['あああああああああ', 'あ', 'ああああああああああ']
    // The boundaries fall at 1.8 and 2.0 of 4 morae: both nearest the one space.
    expect(romajiCuts('aa aa', jp.join(''), threeParts, jp, null)).toBeNull()
  })

  it('is not sure for a line with no characters to weigh', () => {
    expect(romajiCuts('aa ii', '', twoParts, ['', ''], null)).toBeNull()
  })

  it('is not sure when the words don’t spell the line', () => {
    expect(romajiCuts('aa ii', 'べつのうた', twoParts, words, null)).toBeNull()
  })
})

describe('romajiMorae', () => {
  it('counts a mora for each vowel, so long vowels and pairs count twice', () => {
    expect(romajiMorae('arigatou')).toBe(5)
    expect(romajiMorae('eien')).toBe(4)
    expect(romajiMorae('ai')).toBe(2)
  })

  it('counts a syllabic n and a doubled consonant (っ) as morae', () => {
    expect(romajiMorae('hon')).toBe(2)
    expect(romajiMorae('konnichiwa')).toBe(5)
    expect(romajiMorae('kitte')).toBe(3)
    expect(romajiMorae('matcha')).toBe(3)
    expect(romajiMorae('icchi')).toBe(3)
    expect(romajiMorae("shin'you")).toBe(4)
    expect(romajiMorae('nyan')).toBe(2)
  })

  it('counts nothing for punctuation', () => {
    expect(romajiMorae('—')).toBe(0)
  })
})

describe('singerLookup', () => {
  it('gives singerHexes’ colors, worked out once per set of singers', () => {
    const lookup = singerLookup([], NIGHT_CARD)
    expect(lookup(['miku', 'ichika'])).toEqual(night(['miku', 'ichika']))
    expect(lookup(['miku', 'ichika'])).toBe(lookup(['miku', 'ichika']))
  })
})

describe('singersInOrder', () => {
  it('lists each singer once, in the order they first sing', () => {
    expect(singersInOrder([['miku'], ['ichika', 'miku'], null, ['luka']])).toEqual([
      'miku',
      'ichika',
      'luka'
    ])
    expect(singersInOrder([null, null])).toEqual([])
  })
})

describe('wordParts', () => {
  it('colors word by word when the singers line up with the words', () => {
    const singers = [['ichika'], ['ichika'], ['miku']]
    expect(wordParts(singers, 3, true, night)).toEqual(colorParts(singers, night))
  })

  it('gives words it can’t line up (plain lyrics, guessed words) one part in the line’s singers', () => {
    const singers = [['miku'], ['ichika', 'miku'], null]
    const whole = [{ from: 0, to: 2, colors: night(['miku', 'ichika']) }]
    expect(wordParts(singers, 2, true, night)).toEqual(whole)
    expect(wordParts(singers.slice(0, 2), 2, false, night)).toEqual(whole)
    // Plain text has no words at all: the part spans none, its colors are what count.
    expect(wordParts(singers, 0, false, night)).toEqual([
      { from: 0, to: 0, colors: whole[0]?.colors }
    ])
  })

  it('is null for a line nobody colored', () => {
    expect(wordParts(undefined, 2, true, night)).toBeNull()
    expect(wordParts([null, null], 2, true, night)).toBeNull()
    expect(wordParts([['nobody']], 1, true, night)).toBeNull()
  })
})

describe('romajiPieces', () => {
  const line = {
    text: 'ありがとう 永遠に 星空の下で',
    words: ['ありがとう ', '永遠に ', '星空の下で']
  }
  const romaji = 'arigatou eien ni hoshizora no shita de'
  const both = night(['ichika', 'miku'])
  const ichika = night(['ichika'])
  const miku = night(['miku'])
  const parts: ColorPart[] = [
    { from: 0, to: 1, colors: both },
    { from: 1, to: 2, colors: ichika },
    { from: 2, to: 3, colors: miku }
  ]

  it('cuts the romaji where the singers change, each piece in its part’s colors', () => {
    const duet = {
      text: 'もう一度 歌おう',
      words: ['もう一度 ', '歌おう'],
      parts: [
        { from: 0, to: 1, colors: ichika },
        { from: 1, to: 2, colors: miku }
      ],
      colors: both
    }
    expect(romajiPieces('mou ichido utaou', duet, null)).toEqual([
      { text: 'mou ichido', colors: ichika, from: 0, to: 1 },
      { text: ' utaou', colors: miku, from: 1, to: 2 }
    ])
  })

  it('takes the user’s cuts', () => {
    expect(romajiPieces(romaji, { ...line, parts, colors: both }, [8, 16])).toEqual([
      { text: 'arigatou', colors: both, from: 0, to: 1 },
      { text: ' eien ni', colors: ichika, from: 1, to: 2 },
      { text: ' hoshizora no shita de', colors: miku, from: 2, to: 3 }
    ])
  })

  it('gives a line it can’t cut surely one piece in the line’s singers, in order', () => {
    const unsure = romajiPieces('arigatoueienni', { ...line, parts, colors: both }, null)
    expect(unsure).toEqual([{ text: 'arigatoueienni', colors: both, from: 0, to: 3 }])
    // The user's cuts no longer fit the parts (the line was colored again since).
    const stale = romajiPieces(romaji, { ...line, parts, colors: both }, [8])
    expect(stale).toEqual([{ text: romaji, colors: both, from: 0, to: 3 }])
  })

  it('gives one singer’s line one piece in their color', () => {
    const solo = [{ from: 0, to: 3, colors: ichika }]
    expect(romajiPieces(romaji, { ...line, parts: solo, colors: ichika }, null)).toEqual([
      { text: romaji, colors: ichika, from: 0, to: 3 }
    ])
  })

  it('is null for a line with no colors', () => {
    expect(romajiPieces(romaji, { ...line, parts: [], colors: [] }, null)).toBeNull()
  })
})

describe('pieceSpan', () => {
  const words = [
    { text: 'a ', start: 1, end: 1.5 },
    { text: 'b ', start: 2, end: 2.5 },
    { text: 'c', start: 3, end: 4 }
  ]

  it('runs from its first word’s start to the next piece’s, the last to the line’s end', () => {
    expect(pieceSpan(words, 0, 1)).toEqual({ start: 1, end: 2 })
    expect(pieceSpan(words, 1, 3)).toEqual({ start: 2, end: 4 })
  })

  it('is null without words', () => {
    expect(pieceSpan([], 0, 0)).toBeNull()
  })
})

describe('rowPaint', () => {
  const words = [
    { text: 'もう一度 ', start: 48, end: 49.5 },
    { text: '歌おう', start: 49.5, end: 51 }
  ]
  const echo = { words: [{ text: '歌おう', start: 51, end: 52 }], singers: [['ichika']] }
  const row = {
    text: 'もう一度 歌おう',
    romaji: 'mou ichido utaou',
    timeSec: 48,
    words,
    singers: [['ichika'], ['miku']],
    voices: [echo]
  }

  it('colors the words, their romaji and the second voices', () => {
    expect(rowPaint(row, { words, timed: true }, night)).toEqual({
      parts: [
        { from: 0, to: 1, colors: night(['ichika']) },
        { from: 1, to: 2, colors: night(['miku']) }
      ],
      romaji: [
        { text: 'mou ichido', colors: night(['ichika']), from: 0, to: 1 },
        { text: ' utaou', colors: night(['miku']), from: 1, to: 2 }
      ],
      voices: [[{ from: 0, to: 1, colors: night(['ichika']) }]]
    })
  })

  it('gives guessed words one part in the line’s singers', () => {
    const guessed = [{ text: 'もう一度 歌おう', start: 48, end: 51 }]
    expect(rowPaint(row, { words: guessed, timed: false }, night)?.parts).toEqual([
      { from: 0, to: 1, colors: night(['ichika', 'miku']) }
    ])
  })

  it('is null for a row nobody colored', () => {
    const plain = { text: 'もう一度 歌おう', romaji: null, timeSec: 48, words }
    expect(rowPaint(plain, { words, timed: true }, night)).toBeNull()
  })
})

describe('partStyle', () => {
  it('gives one singer a plain color, which the light needs only one layer for', () => {
    expect(partStyle(['#33AAEE'])).toEqual({ blend: false, style: { '--part-color': '#33AAEE' } })
  })

  it('gives several singers their gradient across the part', () => {
    expect(partStyle(['#33AAEE', '#33CCBB'])).toEqual({
      blend: true,
      style: { '--part-gradient': partGradient(['#33AAEE', '#33CCBB']) }
    })
  })

  it('gives a word nobody sings, in a colored line, the text color', () => {
    expect(partStyle([])).toEqual({ blend: false, style: { '--part-color': 'var(--text)' } })
  })
})
