import { describe, expect, it } from 'vitest'
import { keepOrReplace } from './recheck'
import type { Lyrics, LyricsFrom } from './types'
import type { LyricsVersion } from './versions'

// irony as the user's cache had it (scop's original), and as LRCLIB has Nightcord's own.
const scopLines: Lyrics = {
  kind: 'synced',
  lines: [
    { timeSec: 5.44, text: '少し歩き疲れたんだ 少し歩き疲れたんだ' },
    { timeSec: 7.47, text: '月並みな表現だけど 人生とかいう長い道を' }
  ],
  source: 'lrclib'
}
const nightcordFrom: LyricsFrom = {
  id: 10604292,
  artist: '25時、ナイトコードで。 feat. 宵崎奏',
  durationSec: 251,
  credit: 'singers'
}
const nightcord: Lyrics = {
  kind: 'synced',
  lines: [
    { timeSec: 0.55, text: '少し歩き疲れたんだ' },
    { timeSec: 3.38, text: '少し歩き疲れたんだ' }
  ],
  source: 'lrclib',
  from: nightcordFrom
}

function version(id: number, credit: LyricsVersion['credit'], lyrics: Lyrics): LyricsVersion {
  return { id, title: 'アイロニ', artist: '', album: '', durationSec: 251, credit, lyrics }
}

const seen = [
  version(20951492, 'others', {
    ...scopLines,
    from: { ...nightcordFrom, id: 20951492, credit: 'others' }
  }),
  version(10604292, 'singers', nightcord)
]

describe('a re-check of saved lyrics', () => {
  it("swaps irony's saved original for the singers' own", () => {
    expect(keepOrReplace(scopLines, { lyrics: nightcord, seen }, false)).toBe('replace')
  })

  it("keeps lyrics that were already the singers'", () => {
    const theirs: Lyrics = { ...scopLines, from: { ...nightcordFrom, id: 11170932 } }
    expect(keepOrReplace(theirs, { lyrics: nightcord, seen }, false)).toBe('keep')
  })

  it("keeps what it can't place", () => {
    const unknown: Lyrics = { ...scopLines, lines: [{ timeSec: 1, text: 'something else' }] }
    expect(keepOrReplace(unknown, { lyrics: nightcord, seen }, false)).toBe('keep')
    expect(keepOrReplace(scopLines, { lyrics: nightcord }, false)).toBe('keep')
  })

  it("never replaces with another name's version", () => {
    const original: Lyrics = { ...nightcord, from: { ...nightcordFrom, credit: 'others' } }
    expect(keepOrReplace(scopLines, { lyrics: original, seen }, false)).toBe('keep')
  })

  it('leaves songs auto-sync has timed alone', () => {
    expect(keepOrReplace(scopLines, { lyrics: nightcord, seen }, true)).toBe('keep')
  })

  it('only re-checks LRCLIB finds', () => {
    for (const source of ['vocadb', 'ytmusic'] as const) {
      const words: Lyrics = { kind: 'plain', lines: ['少し歩き疲れたんだ'], source }
      expect(keepOrReplace(words, { lyrics: nightcord, seen }, false)).toBe('keep')
    }
  })

  it('keeps the same lyrics', () => {
    const saved: Lyrics = { ...nightcord, from: { ...nightcordFrom, credit: 'others' } }
    expect(keepOrReplace(saved, { lyrics: nightcord, seen }, false)).toBe('keep')
  })
})
