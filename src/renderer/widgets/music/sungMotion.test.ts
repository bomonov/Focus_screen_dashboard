import { describe, expect, it } from 'vitest'
import {
  drawnByLetter,
  graphemes,
  letterBoxes,
  holdStrength,
  isHeld,
  letterSwell,
  letterTimes,
  popGroups,
  romajiSpan,
  splitSpaces,
  wordPop
} from './sungMotion'

const word = (text: string, start = 0, end = 1): { text: string; start: number; end: number } => ({
  text,
  start,
  end
})

describe('held words', () => {
  it('holds only a word that real timings stretch over 1.2 s', () => {
    expect(isHeld(word('tonight', 0, 1.2), true)).toBe(true)
    expect(isHeld(word('tonight', 0, 1.1), true)).toBe(false)
    // A guess never knows a note is held.
    expect(isHeld(word('tonight', 0, 3), false)).toBe(false)
  })

  it('swells more the longer it’s held, up to a three-second hold', () => {
    expect(holdStrength(1)).toBe(0)
    expect(holdStrength(2)).toBe(0.5)
    expect(holdStrength(5)).toBe(1)
  })
})

describe('drawnByLetter', () => {
  it('draws held words, and Japanese words too long to wrap as one, letter by letter', () => {
    expect(drawnByLetter(word('tonight', 0, 3), true)).toBe(true)
    expect(drawnByLetter(word('Hello '), false)).toBe(false)
    expect(drawnByLetter(word('終わらない'), false)).toBe(false)
    expect(drawnByLetter(word('まだ終わらない夢の続きを'), false)).toBe(true)
  })
})

describe('splitSpaces', () => {
  it('keeps the spaces around a word out of it, so they stay between words', () => {
    expect(splitSpaces(' line')).toEqual({ before: ' ', core: 'line', after: '' })
    expect(splitSpaces('city ')).toEqual({ before: '', core: 'city', after: ' ' })
  })
})

describe('graphemes', () => {
  it('keeps accents and emoji whole', () => {
    expect(graphemes('é👍🏽a')).toEqual(['é', '👍🏽', 'a'])
  })
})

describe('letterBoxes', () => {
  it('leaves a space inside a word drawn letter by letter as plain text, so it keeps its width', () => {
    expect(letterBoxes('got 99')).toEqual([
      { text: 'g', boxed: true },
      { text: 'o', boxed: true },
      { text: 't', boxed: true },
      { text: ' ', boxed: false },
      { text: '9', boxed: true },
      { text: '9', boxed: true }
    ])
  })
})

describe('letterTimes', () => {
  it('shares a word’s time between its letters by width, one after another', () => {
    expect(letterTimes(word('ab', 2, 5), [10, 20])).toEqual([
      { start: 2, end: 3 },
      { start: 3, end: 5 }
    ])
  })

  it('shares it evenly when nothing has a width yet', () => {
    expect(letterTimes(word('ab', 2, 4), [0, 0])).toEqual([
      { start: 2, end: 3 },
      { start: 3, end: 4 }
    ])
  })
})

describe('romajiSpan', () => {
  it('runs from the line’s first word to its last', () => {
    expect(romajiSpan([word('a ', 1, 2), word('b', 2, 4.5)])).toEqual({ start: 1, end: 4.5 })
    expect(romajiSpan([])).toBeNull()
  })
})

describe('popGroups', () => {
  it('pops timed Japanese pieces together when they make one word', () => {
    const pieces = [word('待'), word('って'), word('た'), word('夢'), word('の')]
    expect(popGroups(pieces)).toEqual([0, 0, 0, 3, 3])
  })

  it('pops every other word on its own', () => {
    expect(popGroups([word('Stay '), word('with '), word('me')])).toEqual([0, 1, 2])
    expect(popGroups([word('夜の'), word('駅で '), word('君を')])).toEqual([0, 1, 2])
  })
})

describe('wordPop and letterSwell', () => {
  const glow = { peak: 'PEAK', rest: 'REST' }

  it('waits a touch small, rises to 106%, and settles with a faint glow', () => {
    const frames = wordPop(glow)
    expect(String(frames[0]?.transform)).toContain('scale(0.97)')
    expect(frames.some((frame) => String(frame.transform).includes('scale(1.06)'))).toBe(true)
    expect(String(frames.at(-1)?.transform)).toContain('scale(1)')
    expect(String(frames.at(-1)?.filter)).toContain('REST')
  })

  it('has no glow where the theme has none', () => {
    expect(wordPop(null).some((frame) => 'filter' in frame)).toBe(false)
    expect(letterSwell(1, null).some((frame) => 'filter' in frame)).toBe(false)
  })

  it('swells a held letter more the longer it’s held', () => {
    const peak = (strength: number): string =>
      String(letterSwell(strength, glow).find((frame) => frame.offset === 0.29)?.transform)
    expect(peak(0)).toContain('scale(1.08)')
    expect(peak(1)).toContain('scale(1.16)')
  })
})
