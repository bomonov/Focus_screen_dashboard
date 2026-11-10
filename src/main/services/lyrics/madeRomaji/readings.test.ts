import { beforeAll, describe, expect, it } from 'vitest'
import { lineRomaji, textToRead } from './readings'
import { loadTokenizer, type Tokenize } from './tokenizer'

// Made-up phrases, written for these tests, read with kuromoji's real dictionary.
let tokenize: Tokenize
beforeAll(async () => {
  tokenize = await loadTokenizer()
})

const read = (line: string): string | null => lineRomaji(tokenize(textToRead(line)))

describe('romaji read from a line', () => {
  it('reads particles as they are sung', () => {
    expect(read('わたしは空を見る')).toBe('watashi wa sora o miru')
    expect(read('海へ行こう')).toBe('umi e ikou')
  })

  it('keeps a small tsu and a long vowel across the words they join', () => {
    expect(read('言った')).toBe('itta')
    expect(read('待ってる')).toBe('matteru')
    expect(read('ぱっかーん')).toBe('pakkaan')
  })

  it('spaces words the way VocaDB does: endings on their verb, particles apart', () => {
    expect(read('笑っていた')).toBe('waratte ita')
    expect(read('知らないふり')).toBe('shiranai furi')
  })

  it('spells katakana as written', () => {
    expect(read('メロディが好き')).toBe('merodi ga suki')
    expect(read('ダ・ヴィンチも')).toBe('da vinchi mo')
  })

  it('reads a kanji by the reading written after it, and drops the bracket', () => {
    expect(read('運命(さだめ)を知る')).toBe('sadame o shiru')
    expect(read('星（スター）になる')).toBe('sutaa ni naru')
    expect(read('如何 (どう)して')).toBe('doushite')
  })

  it('reads what a dictionary of written Japanese gets wrong in songs', () => {
    expect(read('何の話')).toBe('nan no hanashi')
    expect(read('何でもない')).toBe('nandemo nai')
    expect(read('君が良い')).toBe('kimi ga ii')
    expect(read('今絶対に')).toBe('ima zettai ni')
    expect(read('あたし側にいる')).toBe('atashi soba ni iru')
    expect(read('向こう側へ')).toBe('mukougawa e')
    expect(read('空回りして')).toBe('karamawari shite')
    expect(read('辿り着いた')).toBe('tadoritsuita')
    expect(read('千切れた')).toBe('chigireta')
    expect(read('君は征く')).toBe('kimi wa yuku')
    expect(read('謎々')).toBe('nazonazo')
    expect(read('我等の歌')).toBe('warera no uta')
  })

  it('reads numbers with their counters', () => {
    expect(read('一人で')).toBe('hitori de')
    expect(read('二人の')).toBe('futari no')
    expect(read('一歩前へ')).toBe('ippo mae e')
    expect(read('三千')).toBe('sanzen')
    expect(read('一粒の')).toBe('hitotsubu no')
    expect(read('三本')).toBe('sanbon')
    expect(read('六回')).toBe('rokkai')
  })

  it('joins a small kana the dictionary split off onto the sound before it', () => {
    expect(read('とぅるる')).toBe('tururu')
  })

  it('keeps English and quotes, and turns Japanese punctuation into ours', () => {
    expect(read('Hello世界')).toBe('Hello sekai')
    expect(read('「はい」と言った。')).toBe('"hai" to itta.')
    expect(read('本当？')).toBe('hontou?')
  })

  it("gives no romaji for a line with a kanji it can't read, rather than a guess", () => {
    expect(read('龘の歌')).toBeNull()
    // Kanji past the basic block (𠮟, 𩸽) are kanji too, not punctuation to leave out.
    expect(read('𠮟られた')).toBeNull()
  })
})
