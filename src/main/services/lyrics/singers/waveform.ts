// The editor's waveform, kept as loudness peaks only: one byte per 20 ms, enough to draw it and
// nothing that can be played back. Keep this file free of imports: the editor's page compiles it
// too (for `nearestOnset`, so dragging can snap to where a sound starts).
//
// What feeds `addPeaks` is the audio helper's stream (autosync/protocol.ts, recording.ts):
// 16 kHz, mono, 16-bit little-endian samples, ~100 ms at a time. The functions still take the
// rate and channel count, so they don't depend on that staying so.

/** Seconds one byte of the outline covers. */
export const PEAK_SEC = 0.02

/** Buckets in a second, kept whole (1 / PEAK_SEC) so the bucket maths stays exact. */
const PER_SEC = 50

/** A loudest sample of 0..32768 becomes 1..255, so a heard silence is told from "not heard" (0). */
const LOUDEST_SAMPLE = 32768

/** Nobody plays an hour-long song here, but a wild length shouldn't be able to ask for gigabytes. */
const MAX_SONG_SEC = 3600

/** A rise this big (of 255) over the buckets just before is where a sound starts. */
const ONSET_RISE = 40
const ONSET_LOOKBACK = 3

/** A hair under a bucket, so 10.0000000001 s doesn't ask for a bucket nothing could fill. */
const SLACK = 1e-6

function bucketCount(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0
  return Math.max(0, Math.ceil(Math.min(durationSec, MAX_SONG_SEC) * PER_SEC - SLACK))
}

/** Loudness peaks, one byte per bucket of PEAK_SEC; 0 means not heard yet. */
export function emptyPeaks(durationSec: number): Uint8Array {
  return new Uint8Array(bucketCount(durationSec))
}

/** Whether a saved outline is the size this song needs; one made for another length isn't used. */
export function peaksFit(peaks: Uint8Array, durationSec: number): boolean {
  return peaks.length === bucketCount(durationSec)
}

function toByte(loudestSample: number): number {
  const scaled = 1 + Math.round((254 * loudestSample) / LOUDEST_SAMPLE)
  return Math.min(255, Math.max(1, scaled))
}

/**
 * Adds audio heard at `songTimeSec` (16-bit mono or interleaved, `rate` Hz) into `peaks`: each
 * bucket keeps the loudest sample of any channel, and the loudest of what it had and what's new,
 * since the same stretch can be heard twice. Returns whether any byte changed. What falls before
 * 0 s or past the end is ignored; the rest of that chunk still counts.
 */
export function addPeaks(
  peaks: Uint8Array,
  songTimeSec: number,
  samples: Int16Array,
  rate: number,
  channels: number
): boolean {
  if (!Number.isFinite(songTimeSec) || !Number.isFinite(rate) || rate <= 0) return false
  if (!Number.isInteger(channels) || channels < 1) return false

  // A frame is one sample of every channel; a part-frame at the end is dropped.
  const frames = Math.floor(samples.length / channels)
  // Whole frames counted from the song's start, so no float drift moves a sample to the next bucket.
  const firstFrame = Math.round(songTimeSec * rate)
  let changed = false
  let bucket = -1
  let loudest = 0

  function flush(): void {
    if (bucket < 0) return
    const value = toByte(loudest)
    if (value > (peaks[bucket] ?? 0)) {
      peaks[bucket] = value
      changed = true
    }
  }

  for (let frame = Math.max(0, -firstFrame); frame < frames; frame++) {
    const here = Math.floor(((firstFrame + frame) * PER_SEC) / rate)
    if (here >= peaks.length) break
    if (here !== bucket) {
      flush()
      bucket = here
      loudest = 0
    }
    for (let channel = 0; channel < channels; channel++) {
      const level = Math.abs(samples[frame * channels + channel] ?? 0)
      if (level > loudest) loudest = level
    }
  }
  flush()
  return changed
}

/** A heard bucket that is `ONSET_RISE` louder than the loudest heard one of the 3 before it. */
function isOnset(peaks: Uint8Array, index: number): boolean {
  const value = peaks[index] ?? 0
  // Not heard isn't a sound starting, and with nothing heard just before there's nothing to rise
  // from: the edge of the part heard so far is not an onset.
  if (value === 0) return false
  let before = 0
  for (let back = 1; back <= ONSET_LOOKBACK && index - back >= 0; back++) {
    before = Math.max(before, peaks[index - back] ?? 0)
  }
  return before > 0 && value - before >= ONSET_RISE
}

/**
 * The start time of the sudden rise in loudness nearest to `timeSec` and within `withinSec` of it
 * (the earlier of two equally near), or null. The editor snaps dragged edges to it.
 */
export function nearestOnset(peaks: Uint8Array, timeSec: number, withinSec: number): number | null {
  if (!Number.isFinite(timeSec) || !Number.isFinite(withinSec) || withinSec < 0) return null
  if (peaks.length === 0) return null

  const at = timeSec * PER_SEC
  const reach = withinSec * PER_SEC + SLACK
  const first = Math.max(1, Math.ceil(at - reach))
  const last = Math.min(peaks.length - 1, Math.floor(at + reach))

  let best: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = first; index <= last; index++) {
    if (!isOnset(peaks, index)) continue
    // Rounded so two onsets that are as near as each other tie, whatever the float dust says.
    const distance = Math.round(Math.abs(index - at) * 1e6)
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  }
  return best === null ? null : best / PER_SEC
}

/**
 * Every bucket within `withinSec` of `timeSec` (and the onset look-back before them) has been
 * heard: all `nearestOnset` reads there is in, so its answer there won't change. Only the buckets
 * the song has count near its start and end. False past the song's edges.
 */
export function heardAround(peaks: Uint8Array, timeSec: number, withinSec: number): boolean {
  if (!Number.isFinite(timeSec) || !Number.isFinite(withinSec) || withinSec < 0) return false
  const at = timeSec * PER_SEC
  if (peaks.length === 0 || at < 0 || at > peaks.length) return false

  const reach = withinSec * PER_SEC + SLACK
  // The same buckets `nearestOnset` reads: its candidates, and the 3 before the first.
  const first = Math.max(0, Math.ceil(at - reach) - ONSET_LOOKBACK)
  const last = Math.min(peaks.length - 1, Math.floor(at + reach))
  for (let index = first; index <= last; index++) {
    if ((peaks[index] ?? 0) === 0) return false
  }
  return true
}
