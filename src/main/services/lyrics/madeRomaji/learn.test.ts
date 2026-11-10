import { beforeAll, describe, expect, it } from 'vitest'
import { learnReadings, type LearningExample } from './learn'
import { lineRomaji, textToRead } from './readings'
import { loadTokenizer, type Tokenize } from './tokenizer'

// Made-up lines and romaji, written for these tests.
let tokenize: Tokenize
beforeAll(async () => {
  tokenize = await loadTokenizer()
})

const example = (song: string, line: string, romaji: string): LearningExample => ({
  song,
  tokens: tokenize(textToRead(line)),
  romaji
})

describe('readings learned from VocaDB romaji', () => {
  it('learns a reading VocaDB writes across songs, and reads other lines with it', () => {
    const learned = learnReadings([
      example('a', '明日へ', 'asu e'),
      example('b', '明日が来る', 'asu ga kuru')
    ])
    expect(lineRomaji(tokenize('明日を待つ'), learned)).toBe('asu o matsu')
  })

  it('needs the reading in more than one song', () => {
    const learned = learnReadings([
      example('a', '明日へ', 'asu e'),
      example('a', '明日が来る', 'asu ga kuru')
    ])
    expect(lineRomaji(tokenize('明日を待つ'), learned)).toBe('ashita o matsu')
  })

  it('keeps the dictionary reading when most songs agree with it', () => {
    const learned = learnReadings([
      example('a', '明日へ', 'asu e'),
      example('b', '明日が来る', 'asu ga kuru'),
      example('c', '明日へ', 'ashita e'),
      example('d', '明日が来る', 'ashita ga kuru'),
      example('e', '明日の歌', 'ashita no uta')
    ])
    expect(lineRomaji(tokenize('明日を待つ'), learned)).toBe('ashita o matsu')
  })

  it('learns nothing from a line where other words differ too', () => {
    const learned = learnReadings([
      example('a', '明日へ行く', 'asu e yuku'),
      example('b', '明日へ行く', 'asu e yuku')
    ])
    expect(learned.size).toBe(0)
  })

  it('reads macrons and "wo" the way the rest of the romaji is spelled', () => {
    const learned = learnReadings([
      example('a', '明日を', 'asu wo'),
      example('b', '明日へと', 'asu e to'),
      example('c', '東京', 'tōkyō')
    ])
    expect(lineRomaji(tokenize('明日を待つ'), learned)).toBe('asu o matsu')
    expect(learned.size).toBe(1)
  })
})
