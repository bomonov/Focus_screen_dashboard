import { describe, expect, it } from 'vitest'
import { beats, japaneseWords, soundWeight, syllables } from './wordWeights'

describe('syllables', () => {
  it('counts an English word’s vowel sounds, not its letters', () => {
    expect(syllables('through')).toBe(1)
    expect(syllables('city')).toBe(2)
    expect(syllables('rhythm')).toBe(1)
  })

  it('doesn’t count a silent final e, unless it’s the only vowel', () => {
    expect(syllables('time')).toBe(1)
    expect(syllables('the')).toBe(1)
  })
})

describe('beats', () => {
  it('counts a kana as one beat and a kanji as two', () => {
    expect(beats('ありがとう')).toBe(5)
    expect(beats('永遠に')).toBe(5)
  })

  it('counts small kana as half a beat, and the long-vowel mark as one', () => {
    expect(beats('ちょっと')).toBe(3)
    expect(beats('ラーメン')).toBe(4)
  })
})

describe('soundWeight', () => {
  it('weighs each script by how long it sounds', () => {
    expect(soundWeight('星空の下で')).toBe(8)
    expect(soundWeight('city ')).toBe(2)
    expect(soundWeight('사랑')).toBe(2)
  })

  it('weighs a contraction as the one word it is', () => {
    expect(soundWeight("don't")).toBe(1)
    expect(soundWeight('I’m')).toBe(1)
    expect(soundWeight("you're")).toBe(1)
    expect(soundWeight("'cause")).toBe(1)
  })

  it('gives punctuation no weight, but every piece at least one', () => {
    expect(soundWeight('rock&roll')).toBe(2)
    expect(soundWeight('—')).toBe(1)
  })
})

describe('japaneseWords', () => {
  it('splits a line without spaces into words, endings and particles joined to the word before', () => {
    expect(japaneseWords('まだ終わらない夢の続きを')).toEqual([
      'まだ',
      '終わらない',
      '夢の',
      '続きを'
    ])
    expect(japaneseWords('星空の下で君を待ってた')).toEqual(['星空の', '下で', '君を', '待ってた'])
    expect(japaneseWords('ずっとそばにいるよ')).toEqual(['ずっと', 'そばに', 'いるよ'])
    expect(japaneseWords('終わらないアニメ')).toEqual(['終わらない', 'アニメ'])
  })

  it('always gives back every character, punctuation included', () => {
    expect(japaneseWords('夢、まだ。').join('')).toBe('夢、まだ。')
    expect(japaneseWords('')).toEqual([])
  })

  it('keeps verb endings, lone kana and long vowels with their word, so it pops once', () => {
    expect(japaneseWords('忘れられない')).toEqual(['忘れられない'])
    expect(japaneseWords('あいしてる')).toEqual(['あいしてる'])
    expect(japaneseWords('泣いちゃう')).toEqual(['泣いちゃう'])
    expect(japaneseWords('にゃーん')).toEqual(['にゃーん'])
    expect(japaneseWords('ふぁんふぁーれ')).toEqual(['ふぁんふぁーれ'])
    expect(japaneseWords('ららら')).toEqual(['ららら'])
  })

  it('keeps an opening bracket with the word it opens', () => {
    expect(japaneseWords('「夢だ」')).toEqual(['「夢だ」'])
  })
})
