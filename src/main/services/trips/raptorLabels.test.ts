// Frontier tests check dominance independently of scanning, especially alternatives that can
// become exact journey ties after waiting for another ride.
import { describe, expect, it } from 'vitest'
import {
  catchable,
  collectAnswers,
  insert,
  insertionIndex,
  type Answer,
  type Label
} from './raptorLabels'

function label(time: number, rangeTime: number, walkMetres = 0): Label {
  return {
    time,
    rangeTime,
    walkMetres,
    path: { run: { pattern: 0, trip: 0, midnight: 0 }, board: 0, alight: 1 }
  }
}

function permutations<T>(items: T[]): T[][] {
  if (items.length === 0) return [[]]
  return items.flatMap((item, i) =>
    permutations(items.filter((_, j) => j !== i)).map((rest) => [item, ...rest])
  )
}

describe('insert and catchable', () => {
  it('maintains the frontier for every insertion order, including equal times and range times', () => {
    const offers = [
      label(10, 1, 20),
      label(10, 2, 40),
      label(20, 2, 30),
      label(25, 2, 35),
      label(30, 3, 50),
      label(30, 3, 10)
    ]
    const expected = [offers[1], offers[2], offers[5]]
    for (const order of permutations(offers)) {
      const frontier: Label[] = []
      const prechecked: Label[] = []
      for (const offer of order) {
        insert(frontier, offer)
        const index = insertionIndex(prechecked, offer.time, offer.rangeTime, offer.walkMetres)
        if (index >= 0) insert(prechecked, offer, index)
        expect(prechecked).toEqual(frontier)
      }
      expect(frontier).toEqual(expected)
      for (const time of [0, 10, 19, 20, 25, 29, 30, 100]) {
        const feasible = offers
          .filter((offer) => offer.time <= time)
          .sort((a, b) => b.rangeTime - a.rangeTime || a.walkMetres - b.walkMetres)
        expect(catchable(frontier, time)).toBe(feasible[0])
      }
    }
  })

  it('keeps the first exact equal and replaces an equal-time label with a shorter walk', () => {
    const first = label(10, 2, 20)
    const frontier: Label[] = []
    insert(frontier, first)
    insert(frontier, label(10, 2, 20))
    expect(frontier).toEqual([first])
    const shorter = label(10, 2, 10)
    insert(frontier, shorter)
    insert(frontier, label(10, 2, 30))
    expect(frontier).toEqual([shorter])
    expect(insertionIndex(frontier, 10, 2, 10)).toBe(-1)
    expect(insertionIndex(frontier, 20, 1, 0)).toBe(-1)
    expect(insertionIndex(frontier, 20, 2, 5)).toBe(1)
  })

  it('removes several dominated successors but keeps a later, shorter walking alternative', () => {
    const frontier = [label(10, 1), label(20, 2), label(30, 3, 50), label(40, 3, 10), label(50, 4)]
    const better = label(15, 3, 30)
    insert(frontier, better)
    expect(frontier).toEqual([label(10, 1), better, label(40, 3, 10), label(50, 4)])
    insert(frontier, label(60, 2))
    expect(frontier).toHaveLength(4)
  })

  it('handles empty and negated-clock frontiers with an inclusive catch time', () => {
    expect(catchable([], 0)).toBeUndefined()
    const frontier: Label[] = []
    insert(frontier, label(-20, -50, 20))
    insert(frontier, label(-10, -50, 10))
    expect(catchable(frontier, -21)).toBeUndefined()
    expect(catchable(frontier, -20)?.walkMetres).toBe(20)
    expect(catchable(frontier, -10)?.walkMetres).toBe(10)
  })
})

describe('collectAnswers', () => {
  it('uses total walking, including the final walk, to replace exact time and ride ties', () => {
    const answers: Answer[] = []
    const first = label(90, 10, 20)
    collectAnswers(answers, [[first]], Float64Array.of(10), 1)
    expect(answers[0]?.label.walkMetres).toBe(30)
    const shorter = label(100, 10, 5)
    collectAnswers(answers, [[shorter]], Float64Array.of(0), 1)
    expect(answers).toHaveLength(1)
    expect(answers[0]?.label.path).toBe(shorter.path)
    collectAnswers(answers, [[label(100, 10, 10)]], Float64Array.of(0), 1)
    expect(answers[0]?.label.path).toBe(shorter.path)
  })

  it('does not trade a better time or fewer rides for less walking', () => {
    const answers: Answer[] = []
    collectAnswers(answers, [[label(100, 20, 50)]], Float64Array.of(0), 1)
    collectAnswers(answers, [[label(100, 20, 0)]], Float64Array.of(0), 2)
    collectAnswers(answers, [[label(101, 20, 0), label(100, 19, 0)]], Float64Array.of(0), 2)
    expect(answers).toHaveLength(1)
    expect(answers[0]?.rides).toBe(1)
    collectAnswers(answers, [[label(90, 10, 100)]], Float64Array.of(0), 2)
    expect(answers).toHaveLength(2)
  })

  it('omits sub-metre final walks and ignores stops outside walking range', () => {
    const answers: Answer[] = []
    collectAnswers(answers, [[label(100, 10)], [label(90, 20)]], Float64Array.of(0.5, Infinity), 1)
    expect(answers.map(({ label: answer }) => [answer.time, answer.walkMetres])).toEqual([[100, 0]])
  })
})
