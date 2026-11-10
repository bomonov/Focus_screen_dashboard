import { describe, expect, it } from 'vitest'
import type { CodedLine } from '../../../main/ipc'
import {
  decodePeaks,
  dragEdit,
  dragOn,
  fitView,
  hitTest,
  LANES,
  panBy,
  peakColumns,
  reveal,
  snapTime,
  stripeFrom,
  STRIPE_TAIL_PX,
  NOTHING_HEARD_NOTE,
  timeToX,
  waveNote,
  xToTime,
  zoomAt
} from './waveMath'

function line(start: number, end: number, words: [number, number][], under?: number): CodedLine {
  return {
    text: words.map((_, i) => `w${i}`).join(' '),
    start,
    end,
    words: words.map(([s, e], i) => ({ text: `w${i} `, start: s, end: e, singers: null })),
    ...(under === undefined ? {} : { under })
  }
}

const MAIN_Y = LANES.main.top + 5
const VOICE_Y = LANES.voice.top + 5
const TICK_Y = LANES.peaks.top + 20

describe('timeToX / xToTime', () => {
  it('turn seconds into pixels and back', () => {
    const view = { start: 10, secPerPx: 0.01 }
    expect(timeToX(view, 12)).toBeCloseTo(200)
    expect(xToTime(view, 200)).toBeCloseTo(12)
  })
})

describe('fitView', () => {
  it('keeps the view on the song', () => {
    expect(fitView({ start: -5, secPerPx: 0.01 }, 100, 1000)).toEqual({ start: 0, secPerPx: 0.01 })
    // 1000 px at 0.01 s shows 10 s, so the left edge goes no further than 90 s.
    expect(fitView({ start: 95, secPerPx: 0.01 }, 100, 1000).start).toBeCloseTo(90)
  })

  it('zooms out no further than the whole song, and in no further than 400 px a second', () => {
    expect(fitView({ start: 0, secPerPx: 5 }, 100, 1000).secPerPx).toBeCloseTo(0.1)
    expect(fitView({ start: 0, secPerPx: 0.0001 }, 100, 1000).secPerPx).toBeCloseTo(1 / 400)
  })
})

describe('zoomAt', () => {
  it('keeps the second under the pointer where it was', () => {
    const view = { start: 20, secPerPx: 0.02 }
    const zoomed = zoomAt(view, 300, 0.5, 200, 1000)
    expect(zoomed.secPerPx).toBeCloseTo(0.01)
    expect(xToTime(zoomed, 300)).toBeCloseTo(xToTime(view, 300))
  })

  it('ignores a factor that is no factor', () => {
    const view = { start: 20, secPerPx: 0.02 }
    expect(zoomAt(view, 300, 0, 200, 1000)).toBe(view)
    expect(zoomAt(view, 300, Number.NaN, 200, 1000)).toBe(view)
  })
})

describe('panBy', () => {
  it('moves by pixels and stops at the ends', () => {
    expect(panBy({ start: 10, secPerPx: 0.01 }, 100, 100, 1000).start).toBeCloseTo(11)
    expect(panBy({ start: 1, secPerPx: 0.01 }, -500, 100, 1000).start).toBe(0)
  })
})

describe('reveal', () => {
  const view = { start: 10, secPerPx: 0.01 } // 10 s to 20 s

  it('leaves a view that already shows the line', () => {
    expect(reveal(view, 12, 15, 100, 1000)).toBe(view)
  })

  it('centres a line that is off screen', () => {
    const moved = reveal(view, 40, 42, 100, 1000)
    expect(moved.start).toBeCloseTo(36)
  })

  it('starts a line wider than the view at its left edge, with a little room', () => {
    const moved = reveal(view, 40, 60, 100, 1000)
    expect(moved.start).toBeLessThan(40)
    expect(moved.start).toBeGreaterThan(39)
  })
})

describe('peakColumns', () => {
  it('takes the loudest bucket under each column', () => {
    // 0.02 s a bucket; at 0.04 s a pixel each column holds two.
    const peaks = Uint8Array.from([10, 50, 0, 0, 200, 30])
    const columns = peakColumns(peaks, { start: 0, secPerPx: 0.04 }, 4)
    expect([...columns]).toEqual([50, 0, 200, 0])
  })

  it('gives every column a bucket when zoomed in past one a pixel', () => {
    const peaks = Uint8Array.from([10, 90])
    const columns = peakColumns(peaks, { start: 0, secPerPx: 0.005 }, 8)
    expect([...columns]).toEqual([10, 10, 10, 10, 90, 90, 90, 90])
  })

  it('is empty with no peaks', () => {
    expect([...peakColumns(new Uint8Array(0), { start: 0, secPerPx: 0.01 }, 3)]).toEqual([0, 0, 0])
  })
})

describe('decodePeaks', () => {
  it('reads base64 bytes', () => {
    expect([...(decodePeaks(btoa(String.fromCharCode(1, 2, 255))) ?? [])]).toEqual([1, 2, 255])
  })

  it('is no waveform for none or for junk', () => {
    expect(decodePeaks(null)).toBeNull()
    expect(decodePeaks('not base64!')).toBeNull()
  })
})

describe('waveNote', () => {
  it("gives main's words when there's no waveform at all", () => {
    expect(waveNote(null, 'Recording isn’t allowed.')).toBe('Recording isn’t allowed.')
    expect(waveNote(null, null)).toBeNull()
  })

  it('says the waveform fills in while nothing has been heard', () => {
    expect(waveNote(new Uint8Array(10), null)).toBe(NOTHING_HEARD_NOTE)
  })

  it('says nothing once some of the song has been heard', () => {
    expect(waveNote(Uint8Array.from([0, 0, 12]), null)).toBeNull()
  })
})

describe('snapTime', () => {
  // Quiet, then a sudden rise at bucket 50 (1.00 s).
  const peaks = new Uint8Array(100).fill(10)
  peaks.fill(200, 50)

  it('lands on a loud onset within reach', () => {
    expect(snapTime(peaks, 1.05, false)).toBeCloseTo(1)
  })

  it('stays put with Option held, out of reach, or with no waveform', () => {
    expect(snapTime(peaks, 1.05, true)).toBe(1.05)
    expect(snapTime(peaks, 1.5, false)).toBe(1.5)
    expect(snapTime(null, 1.05, false)).toBe(1.05)
  })
})

describe('hitTest', () => {
  const view = { start: 0, secPerPx: 0.01 } // 100 px a second
  const lines = [
    line(1, 3, [
      [1, 2],
      [2, 3]
    ]),
    line(2.5, 3, [[2.5, 3]], 0),
    line(3, 5, [[3, 5]])
  ]

  it('takes hold of a line edge in its lane', () => {
    expect(hitTest(lines, null, view, 102, MAIN_Y)).toEqual({ kind: 'start', line: 0 })
    expect(hitTest(lines, null, view, 497, MAIN_Y)).toEqual({ kind: 'end', line: 2 })
  })

  it('gives the selected line the edge where two lines meet', () => {
    // Line 0 ends where line 2 starts (3 s).
    expect(hitTest(lines, 0, view, 300, MAIN_Y)).toEqual({ kind: 'end', line: 0 })
    expect(hitTest(lines, 2, view, 300, MAIN_Y)).toEqual({ kind: 'start', line: 2 })
  })

  it('finds second voices in their own lane', () => {
    expect(hitTest(lines, null, view, 252, VOICE_Y)).toEqual({ kind: 'start', line: 1 })
    expect(hitTest(lines, null, view, 252, MAIN_Y)).toEqual({ kind: 'block', line: 0 })
  })

  it('selects a line pressed away from its edges', () => {
    expect(hitTest(lines, null, view, 400, MAIN_Y)).toEqual({ kind: 'block', line: 2 })
    expect(hitTest(lines, null, view, 50, MAIN_Y)).toBeNull()
  })

  it("takes the selected line's ticks below the lanes, and nothing else", () => {
    expect(hitTest(lines, 0, view, 203, TICK_Y)).toEqual({ kind: 'tick', line: 0, word: 1 })
    expect(hitTest(lines, 0, view, 400, TICK_Y)).toBeNull()
    expect(hitTest(lines, null, view, 203, TICK_Y)).toBeNull()
  })
})

describe('dragEdit', () => {
  const coded = line(10, 14, [
    [10, 11],
    [11, 12.5],
    [12.5, 14]
  ])

  it('moves a start and pulls words left outside to it', () => {
    const result = dragEdit(coded, { kind: 'start', line: 4 }, 11.5, 60)
    expect(result?.edit).toEqual({ kind: 'lineTime', line: 4, start: 11.5 })
    expect(result?.preview.start).toBe(11.5)
    expect(result?.preview.words[0]).toMatchObject({ start: 11.5, end: 11.5 })
  })

  it('never drags a start onto or past the end', () => {
    const result = dragEdit(coded, { kind: 'start', line: 0 }, 20, 60)
    expect(result?.preview.start).toBeLessThan(14)
    expect(result?.edit).toMatchObject({ kind: 'lineTime', start: result?.preview.start })
  })

  it('keeps an end after the start and inside the song', () => {
    expect(dragEdit(coded, { kind: 'end', line: 0 }, 5, 60)?.preview.end).toBeGreaterThan(10)
    expect(dragEdit(coded, { kind: 'end', line: 0 }, 99, 60)?.edit).toEqual({
      kind: 'lineTime',
      line: 0,
      end: 60
    })
  })

  it('keeps a tick between the ticks either side, as wordTime does', () => {
    const early = dragEdit(coded, { kind: 'tick', line: 2, word: 1 }, 9, 60)
    expect(early?.edit).toEqual({ kind: 'wordTime', line: 2, word: 1, start: 10 })
    const late = dragEdit(coded, { kind: 'tick', line: 2, word: 1 }, 13, 60)
    expect(late?.edit).toEqual({ kind: 'wordTime', line: 2, word: 1, start: 12.5 })
    expect(late?.preview.words[1]).toMatchObject({ start: 12.5, end: 12.5 })
  })

  it("doesn't drag a block's body", () => {
    expect(dragEdit(coded, { kind: 'block', line: 0 }, 12, 60)).toBeNull()
  })
})

describe('dragOn', () => {
  it('sends the edit only when the button is let go over the waveform', () => {
    expect(dragOn({ kind: 'up' })).toBe('send')
  })

  it('keeps going while the button is held', () => {
    expect(dragOn({ kind: 'move', buttons: 1 })).toBe('keep')
    // Another button held as well doesn't end it.
    expect(dragOn({ kind: 'move', buttons: 3 })).toBe('keep')
  })

  it('drops it, sending nothing, when the release was missed or the pointer was taken', () => {
    // Let go outside the window, say: the next move comes with no button down.
    expect(dragOn({ kind: 'move', buttons: 0 })).toBe('drop')
    expect(dragOn({ kind: 'move', buttons: 2 })).toBe('drop')
    expect(dragOn({ kind: 'lostCapture' })).toBe('drop')
    expect(dragOn({ kind: 'cancel' })).toBe('drop')
  })
})

describe('stripeFrom: an added block’s stripes stop short of its words', () => {
  it('starts after the words when they fit, so the words sit on the plain fill', () => {
    expect(stripeFrom(100, 400, 180)).toBe(180)
  })

  it('keeps a striped tail on a block too short for its words', () => {
    expect(stripeFrom(100, 150, 180)).toBe(150 - STRIPE_TAIL_PX)
  })

  it('stripes all of a block narrower than the tail', () => {
    expect(stripeFrom(100, 105, 180)).toBe(100)
  })

  it('never starts before the block', () => {
    expect(stripeFrom(100, 400, 40)).toBe(100)
  })
})
