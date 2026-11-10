import { beforeAll, describe, expect, it } from 'vitest'
import { createMaker, type Maker } from './maker'
import { loadTokenizer } from './tokenizer'

// Made-up lines and romaji, written for these tests.
let maker: Maker
beforeAll(async () => {
  maker = createMaker(await loadTokenizer())
})

describe('the romaji maker', () => {
  it('makes romaji for Japanese lines only, and none for a line it cannot read', () => {
    expect(maker.make(['空を見る', 'Hello world', '', '龘の歌'])).toEqual([
      'sora o miru',
      '',
      '',
      null
    ])
  })

  it('reads with what it learned from VocaDB romaji saved for other songs', () => {
    maker.learn([
      {
        original: '明日がきっと来るから\nふたりでいこう\nずっとそばにいて',
        romanized: 'asu ga kitto kuru kara\nfutari de ikou\nzutto soba ni ite'
      },
      {
        original: '明日もまた会えるかな\nいつまでもここで\nわらっていよう',
        romanized: 'asu mo mata aeru kana\nitsumademo koko de\nwaratte iyou'
      }
    ])
    expect(maker.make(['明日を待つ'])).toEqual(['asu o matsu'])
  })

  it('learns nothing from romaji that does not pair up with its lines', () => {
    const fresh = createMaker(maker.tokenize)
    fresh.learn([
      { original: '明日へ', romanized: '' },
      { original: '', romanized: 'asu e' }
    ])
    expect(fresh.make(['明日を待つ'])).toEqual(['ashita o matsu'])
  })

  it('counts a song saved twice once, so one song cannot teach a reading alone', () => {
    const fresh = createMaker(maker.tokenize)
    const song = {
      original: '明日がきっと来るから\nふたりでいこう\nずっとそばにいて',
      romanized: 'asu ga kitto kuru kara\nfutari de ikou\nzutto soba ni ite'
    }
    expect(fresh.learn([song, { ...song }])).toEqual([])
    expect(fresh.make(['明日を待つ'])).toEqual(['ashita o matsu'])
  })
})
