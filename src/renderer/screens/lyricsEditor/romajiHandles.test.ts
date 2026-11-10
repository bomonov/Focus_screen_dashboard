import { describe, expect, it } from 'vitest'
import {
  evenCuts,
  moveCut,
  pointerCut,
  romajiSpaces,
  sameCuts,
  settlePending,
  stepCut,
  type PendingCuts
} from './romajiHandles'

describe('romajiSpaces', () => {
  it('finds every space', () => {
    expect(romajiSpaces('koko kara hajimaru')).toEqual([4, 9])
    expect(romajiSpaces('hoshizora')).toEqual([])
  })
})

describe('evenCuts', () => {
  it('spreads cuts over the spaces in proportion', () => {
    // Spaces at 1, 3, 5, 7, 9 in "a b c d e f".
    expect(evenCuts('a b c d e f', 1)).toEqual([5])
    expect(evenCuts('a b c d e f', 2)).toEqual([3, 7])
  })

  it('gives each cut its own space, in order', () => {
    expect(evenCuts('ab cd', 1)).toEqual([2])
    expect(evenCuts('a b', 2)).toBeNull()
    expect(evenCuts('a b c', 2)).toEqual([1, 3])
  })

  it('is nothing to do for no cuts', () => {
    expect(evenCuts('a b', 0)).toEqual([])
  })
})

describe('moveCut', () => {
  it('moves a handle between its neighbours', () => {
    expect(moveCut([4, 9, 15], 1, 12)).toEqual([4, 12, 15])
  })

  it("won't pass or land on a neighbour", () => {
    expect(moveCut([4, 9, 15], 1, 15)).toBeNull()
    expect(moveCut([4, 9, 15], 1, 3)).toBeNull()
    expect(moveCut([4], 3, 2)).toBeNull()
  })
})

// "sabaku no kaze ga yasashiku fuita": spaces at 6, 9, 14, 17, 27, drawn at these x.
const SPACES = [
  { at: 6, x: 60 },
  { at: 9, x: 90 },
  { at: 14, x: 140 },
  { at: 17, x: 170 },
  { at: 27, x: 270 }
]

describe('pointerCut', () => {
  it('moves a handle to the space nearest the pointer, across a long word in one go', () => {
    // From before "yasashiku" to after it: the pointer is past the whole word.
    expect(pointerCut([17], 0, SPACES, 260)).toEqual([27])
    expect(pointerCut([17], 0, SPACES, 95)).toEqual([9])
  })

  it('stops against a neighbour instead of refusing', () => {
    // Handle 0 can't reach 17 or past it while handle 1 sits there: it takes the nearest it may.
    expect(pointerCut([9, 17], 0, SPACES, 300)).toEqual([14, 17])
    expect(pointerCut([9, 17], 1, SPACES, 0)).toEqual([9, 14])
  })

  it('is no change where the handle already is, or with nowhere to go', () => {
    expect(pointerCut([17], 0, SPACES, 172)).toBeNull()
    expect(pointerCut([6, 9], 1, SPACES.slice(0, 2), 300)).toBeNull()
    // No space before its neighbour at 9 (the one it was on isn't drawn).
    expect(pointerCut([6, 9], 0, SPACES.slice(1), 0)).toBeNull()
    expect(pointerCut([17], 3, SPACES, 60)).toBeNull()
  })

  it('goes as far as the pointer, back past where it started', () => {
    expect(pointerCut([9, 14], 0, SPACES, 0)).toEqual([6, 14])
  })
})

describe('stepCut', () => {
  const spaces = SPACES.map((space) => space.at)

  it('steps a handle one space either way, again from where it landed', () => {
    const once = stepCut([9], 0, spaces, 1)
    expect(once).toEqual([14])
    expect(once && stepCut(once, 0, spaces, 1)).toEqual([17])
    expect(stepCut([9], 0, spaces, -1)).toEqual([6])
  })

  it('stops at the ends and against a neighbour', () => {
    expect(stepCut([27], 0, spaces, 1)).toBeNull()
    expect(stepCut([6], 0, spaces, -1)).toBeNull()
    expect(stepCut([9, 14], 0, spaces, 1)).toBeNull()
  })
})

describe('sameCuts', () => {
  it('compares cut by cut, with none its own value', () => {
    expect(sameCuts([4, 9], [4, 9])).toBe(true)
    expect(sameCuts([4, 9], [4, 10])).toBe(false)
    expect(sameCuts([4], [4, 9])).toBe(false)
    expect(sameCuts(null, null)).toBe(true)
    expect(sameCuts(null, [])).toBe(false)
  })
})

describe('settlePending', () => {
  const moved: PendingCuts = { base: [9], cuts: [14] }

  it('keeps a move while main still has the cuts it was made from', () => {
    expect(settlePending(moved, [9])).toBe(moved)
  })

  it('forgets it once main has it, so an undo back to the old cuts shows the old cuts', () => {
    // Move 9 → 14, main pushes 14, then Undo brings back 9.
    let pending = settlePending(moved, [14])
    expect(pending).toBeNull()
    pending = settlePending(pending, [9])
    expect(pending).toBeNull()
  })

  it('forgets it when something else changes the cuts first', () => {
    expect(settlePending(moved, [6])).toBeNull()
    expect(settlePending({ base: null, cuts: [14] }, [14])).toBeNull()
  })

  it('is nothing with nothing pending', () => {
    expect(settlePending(null, [9])).toBeNull()
  })
})
