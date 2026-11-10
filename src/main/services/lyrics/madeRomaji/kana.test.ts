import { describe, expect, it } from 'vitest'
import { fixedRomaji, kanaToRomaji, type SpellState } from './kana'

describe('kana as romaji', () => {
  it('spells hiragana and katakana the way VocaDB writes romaji', () => {
    expect(kanaToRomaji('さくら')).toBe('sakura')
    expect(kanaToRomaji('シャシン')).toBe('shashin')
    expect(kanaToRomaji('ちゃんと')).toBe('chanto')
    expect(kanaToRomaji('じゃあ')).toBe('jaa')
  })

  it('doubles the consonant after a small tsu, with cch for っち', () => {
    expect(kanaToRomaji('きっと')).toBe('kitto')
    expect(kanaToRomaji('こっち')).toBe('kocchi')
    expect(kanaToRomaji('ちっちゃな')).toBe('chicchana')
  })

  it('doubles the vowel before a long-vowel mark', () => {
    expect(kanaToRomaji('ゲーム')).toBe('geemu')
    expect(kanaToRomaji('ぱっかーん')).toBe('pakkaan')
    expect(kanaToRomaji('ねぇ')).toBe('nee')
  })

  it('spells loanword sounds whole', () => {
    expect(kanaToRomaji('ヴァンパイア')).toBe('vanpaia')
    expect(kanaToRomaji('メロディ')).toBe('merodi')
    expect(kanaToRomaji('ティー')).toBe('tii')
    expect(kanaToRomaji('ファンタジー')).toBe('fantajii')
    expect(kanaToRomaji('ウィンター')).toBe('wintaa')
  })

  it('carries a small tsu and the last vowel over to the next word', () => {
    const state: SpellState = { double: false, last: '' }
    expect(kanaToRomaji('イッ', state)).toBe('i')
    expect(kanaToRomaji('タ', state)).toBe('tta')
    expect(kanaToRomaji('ー', state)).toBe('a')
  })

  it("doubles a fixed reading's first consonant after a small tsu", () => {
    const state: SpellState = { double: false, last: '' }
    kanaToRomaji('ヤッ', state)
    expect(fixedRomaji('pari', state)).toBe('ppari')
    kanaToRomaji('マッ', state)
    expect(fixedRomaji('chiru', state)).toBe('cchiru')
  })

  it('leaves out a small tsu at the end of a line', () => {
    expect(kanaToRomaji('あっ')).toBe('a')
  })
})
