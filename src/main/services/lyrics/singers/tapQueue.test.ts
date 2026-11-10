import { describe, expect, it, vi } from 'vitest'
import { createTapQueue, TAP_SNAP_SEC, TAP_WAIT_SEC, type TapEdit } from './tapQueue'

const PRESS = 1_800_000_000
const SONG_SEC = 20
/** 10.24 s, where the sound starts. */
const ONSET_BUCKET = 512

/** Heard quiet (1s), then loud (200) from 10.24 s. */
function heard(): Uint8Array {
  const peaks = new Uint8Array(SONG_SEC * 50).fill(1)
  peaks.fill(200, ONSET_BUCKET)
  return peaks
}

/** Nothing heard yet. */
function unheard(): Uint8Array {
  return new Uint8Array(SONG_SEC * 50)
}

function start(sec: number, word = 0): TapEdit {
  return { kind: 'tapTime', line: 0, word, start: sec, songEnd: SONG_SEC }
}

function end(sec: number, word = 0): TapEdit {
  return { kind: 'tapTime', line: 0, word, end: sec, songEnd: SONG_SEC }
}

describe('createTapQueue', () => {
  it('keeps the values the spec gives', () => {
    expect(TAP_SNAP_SEC).toBe(0.12)
    expect(TAP_WAIT_SEC).toBe(3)
  })

  it('a start waits for the outline round it, then lands on the onset', () => {
    const queue = createTapQueue()
    const apply = vi.fn()
    queue.push(start(10.2), PRESS)

    queue.flush(unheard(), PRESS + 0.5, apply)
    expect(apply).not.toHaveBeenCalled()
    expect(queue.size).toBe(1)

    queue.flush(heard(), PRESS + 2, apply)
    expect(apply).toHaveBeenCalledTimes(1)
    const landed = apply.mock.calls[0]?.[0] as TapEdit
    expect(Math.abs((landed.start ?? 0) - 10.24)).toBeLessThanOrEqual(0.02)
    expect(landed).toMatchObject({ kind: 'tapTime', line: 0, word: 0, songEnd: SONG_SEC })
    expect(queue.size).toBe(0)
  })

  it('lands where pressed with no onset within 120 ms', () => {
    const queue = createTapQueue()
    const apply = vi.fn()
    // Quiet all round 9.5 s, and loud but steady round 10.5 s: nothing starts near either.
    queue.push(start(9.5), PRESS)
    queue.push(start(10.5, 1), PRESS + 1)
    queue.flush(heard(), PRESS + 1.5, apply)
    expect(apply.mock.calls.map(([edit]) => edit)).toEqual([start(9.5), start(10.5, 1)])
  })

  it('lands where pressed after 3 s unheard', () => {
    const queue = createTapQueue()
    const apply = vi.fn()
    queue.push(start(10.2), PRESS)

    queue.flush(unheard(), PRESS + 2.9, apply)
    expect(apply).not.toHaveBeenCalled()

    queue.flush(unheard(), PRESS + TAP_WAIT_SEC, apply)
    expect(apply.mock.calls.map(([edit]) => edit)).toEqual([start(10.2)])
  })

  it('an end waits behind its start', () => {
    const queue = createTapQueue()
    const apply = vi.fn()
    queue.push(start(10.2), PRESS)
    queue.push(end(10.6), PRESS + 0.4)

    queue.flush(unheard(), PRESS + 1, apply)
    expect(apply).not.toHaveBeenCalled()
    expect(queue.size).toBe(2)

    queue.flush(heard(), PRESS + 2, apply)
    const landed = apply.mock.calls.map(([edit]) => edit as TapEdit)
    expect(landed).toHaveLength(2)
    expect(landed[0]?.start).toBeCloseTo(10.24, 5)
    // An end isn't snapped: it's where the key was let go.
    expect(landed[1]).toEqual(end(10.6))
  })

  it('a later start waits behind an earlier one, even when its own outline is heard', () => {
    const queue = createTapQueue()
    const apply = vi.fn()
    // Heard up to 12 s, so 10.2 is heard and 15 isn't.
    const peaks = heard()
    peaks.fill(0, 12 * 50)
    queue.push(start(15), PRESS)
    queue.push(start(10.2, 1), PRESS + 0.5)

    queue.flush(peaks, PRESS + 1, apply)
    expect(apply).not.toHaveBeenCalled()

    queue.flush(peaks, PRESS + TAP_WAIT_SEC, apply)
    const landed = apply.mock.calls.map(([edit]) => edit as TapEdit)
    expect(landed.map((edit) => edit.word)).toEqual([0, 1])
    expect(landed[0]?.start).toBe(15)
    expect(landed[1]?.start).toBeCloseTo(10.24, 5)
  })

  it('no outline: applies at once, unsnapped', () => {
    const queue = createTapQueue()
    const apply = vi.fn()
    queue.push(start(10.2), PRESS)
    queue.push(end(10.6), PRESS + 0.4)
    queue.flush(null, PRESS + 0.4, apply)
    expect(apply.mock.calls.map(([edit]) => edit)).toEqual([start(10.2), end(10.6)])
    expect(queue.size).toBe(0)
  })

  it('force applies everything now, snapping what’s heard', () => {
    const queue = createTapQueue()
    const apply = vi.fn()
    const peaks = heard()
    peaks.fill(0, 12 * 50)
    // The first isn't heard yet, which would hold the second back without `force`.
    queue.push(start(15), PRESS)
    queue.push(start(10.2, 1), PRESS + 0.5)
    queue.push(end(10.6, 1), PRESS + 0.9)

    queue.flush(peaks, PRESS + 1, apply, true)
    const landed = apply.mock.calls.map(([edit]) => edit as TapEdit)
    expect(landed).toHaveLength(3)
    expect(landed[0]).toEqual(start(15))
    expect(landed[1]?.start).toBeCloseTo(10.24, 5)
    expect(landed[2]).toEqual(end(10.6, 1))
    expect(queue.size).toBe(0)
  })

  it('clear drops what’s waiting', () => {
    const queue = createTapQueue()
    const apply = vi.fn()
    queue.push(start(10.2), PRESS)
    queue.clear()
    expect(queue.size).toBe(0)
    queue.flush(null, PRESS, apply, true)
    expect(apply).not.toHaveBeenCalled()
  })
})
