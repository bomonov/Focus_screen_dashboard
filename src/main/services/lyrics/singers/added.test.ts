import { describe, expect, it } from 'vitest'
import { standIns } from './added'
import type { CodedLine, SongColors } from './types'

function line(text: string, over: Partial<CodedLine> = {}): CodedLine {
  return { text, start: 0, end: 1, words: [], ...over }
}

const coding = (lines: CodedLine[]): SongColors => ({ version: 1, lines, cast: [], extra: [] })

const VERSE = '夜空に浮かぶ 小さな灯り'

describe('standIns', () => {
  it('an added line stands in for a like shown line between the same matched lines', () => {
    const colors = coding([line('A'), line(VERSE, { added: true }), line('C')])
    const shown = ['A', '夜空に浮かぶ　小さな灯り', 'C']
    expect(standIns(shown, colors, [0, undefined, 2])).toEqual(new Map([[1, 1]]))
  })

  it('never across a matched line', () => {
    const colors = coding([line('A'), line(VERSE, { added: true }), line('C')])
    const shown = ['夜空に浮かぶ　小さな灯り', 'A', 'C']
    expect(standIns(shown, colors, [undefined, 0, 2]).size).toBe(0)
  })

  it('each shown line once: the more alike added line wins', () => {
    const colors = coding([
      line('A'),
      line('夜空に浮かぶ 小さな', { added: true }),
      line(VERSE, { added: true }),
      line('C')
    ])
    const shown = ['A', '夜空に浮かぶ　小さな灯り', 'C']
    expect(standIns(shown, colors, [0, undefined, 3])).toEqual(new Map([[2, 1]]))
  })

  it("an exact match isn't a stand-in", () => {
    const colors = coding([line('A'), line(VERSE, { added: true })])
    expect(standIns(['A', VERSE], colors, [0, 1]).size).toBe(0)
  })

  it("the lyrics' own changed lines never stand in", () => {
    const colors = coding([line('A'), line('のばした'), line('C')])
    expect(standIns(['A', '伸ばした', 'C'], colors, [0, undefined, 2]).size).toBe(0)
  })
})
