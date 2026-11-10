import { describe, expect, it } from 'vitest'
import {
  alignLanguage,
  companionLines,
  describeTimings,
  followLines,
  lyricLines,
  sungText,
  toSyncedLines,
  type TimedLine
} from './lines'

const span = (start: number, end = start + 2): TimedLine => ({ start, end })

describe('alignLanguage', () => {
  it('reads the script of the lyrics', () => {
    expect(alignLanguage(['夜に駆ける', 'さよなら'])).toBe('ja')
    expect(alignLanguage(['花火 Reloaded', 'もう一度'])).toBe('ja')
    expect(alignLanguage(['사랑해'])).toBe('ko')
    expect(alignLanguage(['月亮代表我的心'])).toBe('zh')
    expect(alignLanguage(['I know you feel it', 'when the night is gone'])).toBe('en')
  })

  it('leaves other languages to the aligner', () => {
    expect(alignLanguage(['Mi corazón late por ti', 'bailando en la calle'])).toBeNull()
    expect(alignLanguage(['', '123'])).toBeNull()
  })
})

describe('sungText', () => {
  it('drops alternate readings and decorations nobody sings', () => {
    expect(sungText('おとなたちの鋭利(営利)な目盛(×メモリー)')).toBe('おとなたちの鋭利 な目盛')
    expect(sungText('エビバディ→解体!')).toBe('エビバディ 解体!')
    expect(sungText('"どうして" も "ああして!" も')).toBe('どうして も ああして! も')
    expect(sungText('はい, とは言えな～い!')).toBe('はい, とは言えな い!')
    expect(sungText('「夜」に【駆ける】')).toBe('夜 に')
  })

  it('keeps a line that is nothing but an aside', () => {
    expect(sungText('(Hey!)')).toBe('(Hey!)')
  })
})

describe('describeTimings', () => {
  it('counts piled-up and unplaced lines', () => {
    expect(describeTimings([span(1), span(1), null, span(200)], 200)).toBe(
      '2 of 4 lines piled up, 1 unplaced'
    )
  })
})

describe('toSyncedLines', () => {
  const plain = ['one', 'two', '', 'three', 'four']
  /** Ten lines, so one odd line out stays under the bad-line limit. */
  const ten = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`)
  const every4s = (): TimedLine[] => ten.map((_, index) => span(10 + index * 4))

  it('times each lyric line and skips stanza breaks', () => {
    expect(lyricLines(plain)).toEqual(['one', 'two', 'three', 'four'])
    expect(toSyncedLines(plain, [span(1), span(3.5), span(6), span(8)], 200)).toEqual([
      { timeSec: 1, text: 'one' },
      { timeSec: 3.5, text: 'two' },
      { timeSec: 6, text: 'three' },
      { timeSec: 8, text: 'four' }
    ])
  })

  it('shows a break in a long instrumental gap', () => {
    const lines = toSyncedLines(plain, [span(1), span(3), span(30), span(32)], 200)
    expect(lines?.map((line) => line.text)).toEqual(['one', 'two', '', 'three', 'four'])
    expect(lines?.[2]?.timeSec).toBe(5)
  })

  it('places a missed line between its neighbours', () => {
    const timed = every4s()
    timed[1] = null
    expect(toSyncedLines(ten, timed, 200)?.[1]).toEqual({ timeSec: 14, text: 'line 2' })
    const first = every4s()
    first[0] = null
    expect(toSyncedLines(ten, first, 200)?.[0]?.timeSec).toBe(12)
  })

  it('never lets a line start before the one above it', () => {
    const timed = every4s()
    timed[1] = span(8)
    expect(toSyncedLines(ten, timed, 200)?.[1]?.timeSec).toBe(10)
  })

  it('starts a missed last line as the one before it ends', () => {
    const timed = every4s()
    timed[9] = span(900)
    expect(toSyncedLines(ten, timed, 200)?.[9]).toEqual({ timeSec: 44, text: 'line 10' })
  })

  it('gives up when too much is missing or out of order', () => {
    expect(toSyncedLines(plain, [span(1), null, null, span(9)], 200)).toBeNull()
    expect(toSyncedLines(plain, [span(10), span(5), span(4), span(22)], 200)).toBeNull()
    expect(toSyncedLines(plain, [span(1)], 200)).toBeNull()
    expect(toSyncedLines(['', ' '], [], 200)).toBeNull()
  })

  it('gives up on lines piled onto each other at the end of the song', () => {
    // What a recording missing its last seconds produced: the rest pushed to the very end.
    const timed = every4s()
    timed[7] = span(200, 200)
    timed[8] = span(200, 200)
    expect(toSyncedLines(ten, timed, 200)).toBeNull()
  })
})

describe('companionLines', () => {
  it('finds a translation under every line', () => {
    const texts = [
      '夜に駆ける',
      'Racing into the night',
      '沈むように',
      'Like sinking',
      '溶けてゆくように',
      'Like melting'
    ]
    expect(companionLines(texts)).toEqual([false, true, false, true, false, true])
  })

  it('leaves sung English alone in a song that switches now and then', () => {
    const texts = [
      '花火',
      'もう一度',
      'Hey!',
      '夜空に',
      '咲いて',
      '散って',
      'Reloaded',
      '消えないで',
      '光',
      '燃えて'
    ]
    expect(companionLines(texts).some(Boolean)).toBe(false)
  })

  it('treats a line that is all brackets as a companion', () => {
    expect(companionLines(['Hello', '(Hello)', 'World'])).toEqual([false, true, false])
  })
})

describe('toSyncedLines with companions', () => {
  it('puts each companion just after its sung line, without counting it against the timing', () => {
    const plain = ['夜に駆ける', 'Racing into the night', '', '沈むように', 'Like sinking']
    const companions = [false, true, false, true]
    expect(toSyncedLines(plain, [span(10), null, span(14), null], 200, companions)).toEqual([
      { timeSec: 10, text: '夜に駆ける' },
      { timeSec: 10.01, text: 'Racing into the night' },
      { timeSec: 14, text: '沈むように' },
      { timeSec: 14.01, text: 'Like sinking' }
    ])
  })

  it('keeps the ♪ break before a sung line, after the companion above it', () => {
    const plain = ['一', 'One', '二', 'Two']
    const lines = toSyncedLines(plain, [span(10, 12), null, span(30), null], 200, [
      false,
      true,
      false,
      true
    ])
    expect(lines?.map((line) => line.text)).toEqual(['一', 'One', '', '二', 'Two'])
  })
})

describe('followLines', () => {
  it('gives live sync the sung lines and where each sits in the plain lyrics', () => {
    const plain = ['一（いち）', 'One', '', '二 ♪', 'Two', '三', 'Three']
    expect(followLines(plain)).toEqual({ lines: ['一', '二', '三'], plainIndexes: [0, 3, 5] })
    expect(followLines(['  a  ', '', '', 'b'])).toEqual({ lines: ['a', 'b'], plainIndexes: [0, 3] })
    expect(followLines(['', ' '])).toEqual({ lines: [], plainIndexes: [] })
  })
})

describe('word timings', () => {
  const words = (start: number): TimedLine => ({
    start,
    end: start + 2,
    words: [
      { text: 'first', start, end: start + 0.6 },
      { text: ' line', start: start + 0.7, end: start + 2 }
    ]
  })

  it('keeps the aligner’s words on lines it placed', () => {
    const lines = toSyncedLines(['first line', 'second line'], [words(1), span(4)], 200)
    expect(lines?.[0]?.words).toEqual([
      { text: 'first', start: 1, end: 1.6 },
      { text: ' line', start: 1.7, end: 3 }
    ])
    expect(lines?.[1]?.words).toBeUndefined()
  })

  it('drops them from a line whose start had to be held back', () => {
    // The second line starts before the first: it's held at the first's start, so its own
    // words (timed elsewhere) would be wrong there.
    const lines = toSyncedLines(
      ['a b', 'c d', 'e f', 'g h', 'i j', 'k l', 'm n', 'o p'],
      [span(10), words(5), span(14), span(16), span(18), span(20), span(22), span(24)],
      200
    )
    expect(lines?.[1]?.timeSec).toBe(10)
    expect(lines?.[1]?.words).toBeUndefined()
  })
})

describe('parseWords', () => {
  it('takes well-formed words and nothing else', async () => {
    const { parseWords } = await import('./lines')
    expect(parseWords([{ text: 'hi', start: 1, end: 1.2 }])).toEqual([
      { text: 'hi', start: 1, end: 1.2 }
    ])
    expect(parseWords([{ text: 'hi', start: 2, end: 1 }])).toBeUndefined()
    expect(parseWords([{ text: '', start: 1, end: 2 }])).toBeUndefined()
    expect(parseWords([{ text: 'hi', start: Number.NaN, end: 2 }])).toBeUndefined()
    expect(parseWords([])).toBeUndefined()
    expect(parseWords('words')).toBeUndefined()
  })
})
