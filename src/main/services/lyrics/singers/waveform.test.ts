import { describe, expect, it } from 'vitest'
import { addPeaks, emptyPeaks, heardAround, nearestOnset, PEAK_SEC, peaksFit } from './waveform'

const RATE = 16_000

/** `seconds` of one steady level, so the peak byte is easy to predict. */
function tone(seconds: number, level: number, rate = RATE): Int16Array {
  const samples = new Int16Array(Math.round(seconds * rate))
  samples.fill(level)
  return samples
}

/** The byte a sample level of `level` should store. */
function byteFor(level: number): number {
  return 1 + Math.round((254 * Math.abs(level)) / 32768)
}

/** A song of `seconds`, silent until `burstAt`, then loud for `burstSec`. */
function songWithBurst(seconds: number, burstAt: number, burstSec = 0.5): Uint8Array {
  const peaks = emptyPeaks(seconds)
  addPeaks(peaks, 0, tone(burstAt, 0), RATE, 1)
  addPeaks(peaks, burstAt, tone(burstSec, 20_000), RATE, 1)
  return peaks
}

describe('emptyPeaks', () => {
  it('is one zero per 20 ms', () => {
    const peaks = emptyPeaks(10)
    expect(peaks).toHaveLength(500)
    expect(peaks.every((value) => value === 0)).toBe(true)
  })

  it('rounds a part-bucket up so the song end has a bucket', () => {
    expect(emptyPeaks(10.01)).toHaveLength(501)
    expect(emptyPeaks(0.001)).toHaveLength(1)
  })

  it('has nothing for a song with no usable length', () => {
    for (const length of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(emptyPeaks(length)).toHaveLength(0)
    }
  })

  it('stops at an hour, so a wild length cannot ask for gigabytes', () => {
    expect(emptyPeaks(1e12)).toHaveLength(180_000)
    expect(peaksFit(emptyPeaks(1e12), 1e12)).toBe(true)
  })

  it('keeps PEAK_SEC at 20 ms', () => {
    expect(PEAK_SEC).toBe(0.02)
  })
})

describe('peaksFit', () => {
  it('says whether a saved outline is the size this song needs', () => {
    expect(peaksFit(new Uint8Array(500), 10)).toBe(true)
    expect(peaksFit(new Uint8Array(501), 10)).toBe(false)
    expect(peaksFit(new Uint8Array(499), 10)).toBe(false)
    expect(peaksFit(new Uint8Array(0), 10)).toBe(false)
  })

  it('agrees with emptyPeaks whatever the length', () => {
    for (const length of [0, 0.001, 10.01, 213.5, 600, Number.NaN]) {
      expect(peaksFit(emptyPeaks(length), length)).toBe(true)
    }
  })
})

describe('addPeaks', () => {
  it('fills the buckets a loud burst at 2.0 s covers with high values', () => {
    const peaks = emptyPeaks(10)
    const changed = addPeaks(peaks, 2, tone(0.5, 20_000), RATE, 1)

    expect(changed).toBe(true)
    // 0.5 s is 25 buckets, 100..124, and nothing outside them was heard.
    for (let i = 100; i < 125; i++) expect(peaks[i]).toBe(byteFor(20_000))
    expect(peaks[99]).toBe(0)
    expect(peaks[125]).toBe(0)
    expect(byteFor(20_000)).toBeGreaterThan(150)
  })

  it('stores 1 for a heard silence, so it is told apart from not heard', () => {
    const peaks = emptyPeaks(10)
    addPeaks(peaks, 0, tone(1, 0), RATE, 1)
    for (let i = 0; i < 50; i++) expect(peaks[i]).toBe(1)
    expect(peaks[50]).toBe(0)
  })

  it('scales the loudest sample to 255 and a faint one to 1', () => {
    const peaks = emptyPeaks(1)
    addPeaks(peaks, 0, tone(0.02, -32768), RATE, 1)
    addPeaks(peaks, 0.02, tone(0.02, 1), RATE, 1)
    addPeaks(peaks, 0.04, tone(0.02, 32767), RATE, 1)
    expect(peaks[0]).toBe(255)
    expect(peaks[1]).toBe(1)
    expect(peaks[2]).toBe(255)
  })

  it('takes the loudest sample in a bucket, not the last', () => {
    const peaks = emptyPeaks(1)
    const samples = tone(0.02, 100)
    samples[10] = -12_000
    addPeaks(peaks, 0, samples, RATE, 1)
    expect(peaks[0]).toBe(byteFor(12_000))
  })

  it('takes the loudest of all channels in interleaved audio', () => {
    const peaks = emptyPeaks(1)
    // 0.02 s of stereo: left silent, right loud.
    const stereo = new Int16Array(320 * 2)
    for (let frame = 0; frame < 320; frame++) stereo[frame * 2 + 1] = 9_000
    addPeaks(peaks, 0, stereo, RATE, 2)
    expect(peaks[0]).toBe(byteFor(9_000))
    expect(peaks[1]).toBe(0)
  })

  it('puts audio at a rate other than 16 kHz in the right buckets', () => {
    const peaks = emptyPeaks(2)
    addPeaks(peaks, 1, tone(0.1, 8_000, 48_000), 48_000, 1)
    for (let i = 50; i < 55; i++) expect(peaks[i]).toBe(byteFor(8_000))
    expect(peaks[49]).toBe(0)
    expect(peaks[55]).toBe(0)
  })

  it('joins chunks that split a bucket, keeping the loudest of both', () => {
    const peaks = emptyPeaks(1)
    // Half a bucket (10 ms) quiet, then the other half loud.
    addPeaks(peaks, 0, tone(0.01, 1_000), RATE, 1)
    addPeaks(peaks, 0.01, tone(0.01, 6_000), RATE, 1)
    expect(peaks[0]).toBe(byteFor(6_000))
    expect(peaks[1]).toBe(0)
  })

  it('keeps the louder of what it had and what is new, and says if a byte changed', () => {
    const peaks = emptyPeaks(1)
    expect(addPeaks(peaks, 0, tone(0.1, 10_000), RATE, 1)).toBe(true)
    const before = Array.from(peaks)

    // The same audio heard again, and a quieter pass: nothing to change.
    expect(addPeaks(peaks, 0, tone(0.1, 10_000), RATE, 1)).toBe(false)
    expect(addPeaks(peaks, 0, tone(0.1, 2_000), RATE, 1)).toBe(false)
    expect(Array.from(peaks)).toEqual(before)

    // A louder one raises it.
    expect(addPeaks(peaks, 0, tone(0.1, 20_000), RATE, 1)).toBe(true)
    expect(peaks[0]).toBe(byteFor(20_000))
  })

  it('ignores audio past the end of the song', () => {
    const peaks = emptyPeaks(1)
    expect(addPeaks(peaks, 1, tone(0.5, 20_000), RATE, 1)).toBe(false)
    expect(addPeaks(peaks, 5, tone(0.5, 20_000), RATE, 1)).toBe(false)
    expect(peaks.every((value) => value === 0)).toBe(true)
  })

  it('keeps the part of a chunk that is still inside the song', () => {
    const peaks = emptyPeaks(1)
    // 0.2 s starting 0.1 s before the end: the last 5 buckets.
    expect(addPeaks(peaks, 0.9, tone(0.2, 20_000), RATE, 1)).toBe(true)
    expect(peaks).toHaveLength(50)
    for (let i = 45; i < 50; i++) expect(peaks[i]).toBe(byteFor(20_000))
    expect(peaks[44]).toBe(0)
  })

  it('ignores audio before 0 s and keeps the part that is after it', () => {
    const peaks = emptyPeaks(1)
    expect(addPeaks(peaks, -1, tone(0.5, 20_000), RATE, 1)).toBe(false)
    expect(peaks.every((value) => value === 0)).toBe(true)

    // 0.2 s starting 0.1 s early: the first 5 buckets.
    expect(addPeaks(peaks, -0.1, tone(0.2, 20_000), RATE, 1)).toBe(true)
    for (let i = 0; i < 5; i++) expect(peaks[i]).toBe(byteFor(20_000))
    expect(peaks[5]).toBe(0)
  })

  it('treats a trailing part of a frame as nothing', () => {
    const peaks = emptyPeaks(1)
    // Stereo, but the last frame lacks its second channel: that frame is dropped.
    const samples = new Int16Array([0, 0, 0, 0, 30_000])
    addPeaks(peaks, 0, samples, RATE, 2)
    expect(peaks[0]).toBe(1)
  })

  it('does nothing, and does not throw, on audio it cannot place', () => {
    const peaks = emptyPeaks(1)
    const loud = tone(0.1, 20_000)
    expect(addPeaks(peaks, Number.NaN, loud, RATE, 1)).toBe(false)
    expect(addPeaks(peaks, 0, loud, 0, 1)).toBe(false)
    expect(addPeaks(peaks, 0, loud, Number.NaN, 1)).toBe(false)
    expect(addPeaks(peaks, 0, loud, RATE, 0)).toBe(false)
    expect(addPeaks(peaks, 0, new Int16Array(0), RATE, 1)).toBe(false)
    expect(addPeaks(new Uint8Array(0), 0, loud, RATE, 1)).toBe(false)
    expect(peaks.every((value) => value === 0)).toBe(true)
  })
})

describe('nearestOnset', () => {
  it("finds a burst's start within 0.1 s of where it was asked", () => {
    const peaks = songWithBurst(10, 2)
    expect(nearestOnset(peaks, 2.05, 0.1)).toBeCloseTo(2, 5)
    expect(nearestOnset(peaks, 1.95, 0.1)).toBeCloseTo(2, 5)
    expect(nearestOnset(peaks, 2, 0.1)).toBeCloseTo(2, 5)
  })

  it('is null when no onset is within the distance', () => {
    const peaks = songWithBurst(10, 2)
    expect(nearestOnset(peaks, 2.5, 0.1)).toBeNull()
    expect(nearestOnset(peaks, 1.5, 0.1)).toBeNull()
    expect(nearestOnset(peaks, 8, 1)).toBeNull()
  })

  it('counts only where the loudness starts, not the sustained loud after it', () => {
    const peaks = songWithBurst(10, 2, 1)
    // Mid-burst nothing rises, so the only onset is still the burst's start.
    expect(nearestOnset(peaks, 2.5, 0.3)).toBeNull()
    expect(nearestOnset(peaks, 2.5, 0.6)).toBeCloseTo(2, 5)
  })

  it('wants a rise of at least 40 over the loudest of the 3 buckets before', () => {
    const rise = (over: number): Uint8Array => {
      // Buckets 0..3 heard at 50, 52, 54, then bucket 4 at 54 + over.
      const peaks = new Uint8Array([50, 52, 54, 54, 54 + over])
      return peaks
    }
    expect(nearestOnset(rise(40), 0.08, 0.01)).toBeCloseTo(0.08, 5)
    expect(nearestOnset(rise(39), 0.08, 0.01)).toBeNull()
  })

  it('does not take a slow climb for an onset', () => {
    const peaks = Uint8Array.from({ length: 12 }, (_, i) => 20 + i * 15)
    expect(nearestOnset(peaks, 0.1, 0.2)).toBeNull()
  })

  it('measures the rise from the loudest of the 3 before, not just the one before', () => {
    // 200 then a dip to 30 then 100: 100 is 70 over the dip but under the 200 before it.
    const peaks = new Uint8Array([200, 30, 100])
    expect(nearestOnset(peaks, 0.04, 0.05)).toBeNull()
    // Four buckets on, the 200 has left the lookback: 100 is now a rise over 30.
    const later = new Uint8Array([200, 30, 30, 30, 100])
    expect(nearestOnset(later, 0.08, 0.01)).toBeCloseTo(0.08, 5)
  })

  it('never takes a bucket that was not heard as an onset or as the quiet before one', () => {
    // Loud right after a gap that was never heard: nothing to rise from, so no onset.
    const afterGap = new Uint8Array([0, 0, 0, 0, 200, 200])
    expect(nearestOnset(afterGap, 0.08, 0.1)).toBeNull()
    // Heard quiet two buckets back still counts as the quiet before it.
    const beforeGap = new Uint8Array([10, 0, 0, 200])
    expect(nearestOnset(beforeGap, 0.06, 0.01)).toBeCloseTo(0.06, 5)
    // Past the 3 buckets looked back, that heard quiet is out of reach.
    const farGap = new Uint8Array([10, 0, 0, 0, 200])
    expect(nearestOnset(farGap, 0.08, 0.01)).toBeNull()
  })

  it('has nothing to compare the very first bucket with', () => {
    expect(nearestOnset(new Uint8Array([255, 255]), 0, 0.1)).toBeNull()
  })

  it('gives the nearer of two onsets, and the earlier when they are as near', () => {
    const peaks = new Uint8Array(30).fill(1)
    // Onsets at buckets 10 and 20 (0.2 s and 0.4 s).
    for (let i = 10; i < 15; i++) peaks[i] = 200
    for (let i = 20; i < 25; i++) peaks[i] = 200
    expect(nearestOnset(peaks, 0.25, 0.3)).toBeCloseTo(0.2, 5)
    expect(nearestOnset(peaks, 0.35, 0.3)).toBeCloseTo(0.4, 5)
    // Exactly between them: the earlier.
    expect(nearestOnset(peaks, 0.3, 0.3)).toBeCloseTo(0.2, 5)
  })

  it('reaches an onset exactly `withinSec` away, but not one bucket further', () => {
    const peaks = new Uint8Array(30).fill(1)
    for (let i = 10; i < 15; i++) peaks[i] = 200
    expect(nearestOnset(peaks, 0.3, 0.1)).toBeCloseTo(0.2, 5)
    expect(nearestOnset(peaks, 0.32, 0.1)).toBeNull()
  })

  it('copes with times off either end and with nonsense', () => {
    const peaks = songWithBurst(10, 2)
    expect(nearestOnset(peaks, -5, 1)).toBeNull()
    expect(nearestOnset(peaks, 500, 1)).toBeNull()
    expect(nearestOnset(peaks, Number.NaN, 1)).toBeNull()
    expect(nearestOnset(peaks, 2, Number.NaN)).toBeNull()
    expect(nearestOnset(peaks, 2, -1)).toBeNull()
    expect(nearestOnset(new Uint8Array(0), 2, 1)).toBeNull()
  })
})

describe('heardAround', () => {
  /** 10 s, every bucket heard (a heard silence is 1). */
  function allHeard(): Uint8Array {
    return new Uint8Array(500).fill(1)
  }

  it('is true when everything within reach has been heard', () => {
    expect(heardAround(allHeard(), 2, 0.12)).toBe(true)
    expect(heardAround(songWithBurst(10, 2), 2.05, 0.12)).toBe(true)
  })

  it('is false with one bucket within reach not heard yet', () => {
    // 2 s is bucket 100; 0.12 s reaches buckets 94..106.
    for (const gap of [94, 100, 106]) {
      const peaks = allHeard()
      peaks[gap] = 0
      expect(heardAround(peaks, 2, 0.12)).toBe(false)
    }
    // Nor past it: bucket 107 isn't anything nearestOnset would read.
    const after = allHeard()
    after[107] = 0
    expect(heardAround(after, 2, 0.12)).toBe(true)
  })

  it('wants the 3 buckets an onset is measured from heard too, and no more', () => {
    const lookback = allHeard()
    lookback[91] = 0
    expect(heardAround(lookback, 2, 0.12)).toBe(false)
    const further = allHeard()
    further[90] = 0
    expect(heardAround(further, 2, 0.12)).toBe(true)
  })

  it('counts only the buckets the song has near its start and end', () => {
    expect(heardAround(allHeard(), 0, 0.12)).toBe(true)
    expect(heardAround(allHeard(), 9.95, 0.12)).toBe(true)
  })

  it('is false past the song’s edges, and on nonsense', () => {
    expect(heardAround(allHeard(), 10.5, 0.12)).toBe(false)
    expect(heardAround(allHeard(), -0.5, 0.12)).toBe(false)
    expect(heardAround(allHeard(), Number.NaN, 0.12)).toBe(false)
    expect(heardAround(allHeard(), 2, Number.NaN)).toBe(false)
    expect(heardAround(allHeard(), 2, -1)).toBe(false)
    expect(heardAround(new Uint8Array(0), 0, 0.12)).toBe(false)
  })
})
