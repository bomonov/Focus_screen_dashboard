import { describe, expect, it } from 'vitest'
import type { Lyrics } from './types'
import { sameLyrics } from './versions'

const scop: Lyrics = {
  kind: 'synced',
  lines: [
    { timeSec: 5.44, text: '少し歩き疲れたんだ 少し歩き疲れたんだ' },
    { timeSec: 7.47, text: '月並みな表現だけど 人生とかいう長い道を' }
  ],
  source: 'lrclib'
}
const nightcord: Lyrics = {
  kind: 'synced',
  lines: [
    { timeSec: 0.55, text: '少し歩き疲れたんだ' },
    { timeSec: 3.38, text: '少し歩き疲れたんだ' }
  ],
  source: 'lrclib'
}

describe('sameLyrics', () => {
  it('knows the same version again', () => expect(sameLyrics(scop, { ...scop })).toBe(true))

  it('tells two versions apart', () => expect(sameLyrics(scop, nightcord)).toBe(false))

  it('allows timings a hair apart', () => {
    const nudged: Lyrics = {
      ...scop,
      lines: scop.lines.map((line) => ({ ...line, timeSec: line.timeSec + 0.02 }))
    }
    expect(sameLyrics(scop, nudged)).toBe(true)
  })

  it('tells timed lines from plain words', () => {
    const plain: Lyrics = { kind: 'plain', lines: scop.lines.map((l) => l.text), source: 'lrclib' }
    expect(sameLyrics(scop, plain)).toBe(false)
    expect(sameLyrics(plain, { ...plain })).toBe(true)
  })
})
