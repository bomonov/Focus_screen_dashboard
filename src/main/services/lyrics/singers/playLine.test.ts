import { describe, expect, it } from 'vitest'
import { REPLAY_LEAD_SEC, replaySpan } from './playLine'
import type { CodedLine, SongColors } from './types'

function line(start: number, end: number, extra: Partial<CodedLine> = {}): CodedLine {
  return { text: 'la', start, end, words: [{ text: 'la', start, end, singers: null }], ...extra }
}

function coding(lines: CodedLine[]): SongColors {
  return { version: 1, lines, cast: [], extra: [] }
}

describe('replaySpan', () => {
  it('replays from the line before’s start to the line’s end', () => {
    const colors = coding([line(10, 14), line(20, 25), line(30, 36)])
    expect(replaySpan(colors, 2)).toEqual({ start: 20, end: 36 })
  })

  it('skips second voices to the main line before', () => {
    const colors = coding([line(10, 14), line(20, 25), line(21, 23, { under: 1 }), line(30, 36)])
    expect(replaySpan(colors, 3)).toEqual({ start: 20, end: 36 })
  })

  it('starts 3 s early with no line before, or one out of order', () => {
    expect(REPLAY_LEAD_SEC).toBe(3)
    expect(replaySpan(coding([line(10, 14)]), 0)).toEqual({ start: 7, end: 14 })
    expect(replaySpan(coding([line(1, 4)]), 0)).toEqual({ start: 0, end: 4 })
    expect(replaySpan(coding([line(30, 36), line(20, 25)]), 1)).toEqual({ start: 17, end: 25 })
  })

  it('null for a line that isn’t there', () => {
    expect(replaySpan(coding([line(10, 14)]), 1)).toBeNull()
    expect(replaySpan(coding([line(10, 14)]), -1)).toBeNull()
  })
})
