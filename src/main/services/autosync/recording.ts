/** What the helper sends and what the aligners want: 16 kHz mono. */
export const SAMPLE_RATE = 16_000
/** Coverage is counted in tenths of a second. */
const CELL_SAMPLES = SAMPLE_RATE / 10
/** The engine's own limit, and 19 MB of samples at most. */
export const MAX_SONG_SEC = 600

/** One song's audio laid out on the song's own timeline, whatever order it was heard in. */
export interface SongRecording {
  readonly durationSec: number
  /**
   * Puts samples at their place in the song (`songTimeSec` is where the first one belongs).
   * Hearing a spot again replaces it; anything before 0 or past the end is dropped.
   */
  write(songTimeSec: number, samples: Int16Array): void
  /** 0–1: how much of the song has been heard. */
  coverage(): number
  /** The whole song as 16-bit samples, silent where nothing was heard. */
  samples(): Int16Array
  /** Stretches heard so far, [from, to] in seconds, merged and in order; a tenth-second cell counts once half of it is. */
  heardSpans(): [number, number][]
}

export function createSongRecording(durationSec: number): SongRecording {
  const length = Math.round(Math.min(Math.max(durationSec, 0), MAX_SONG_SEC) * SAMPLE_RATE)
  const audio = new Int16Array(length)
  // Samples heard per cell, capped at the cell's size, so a replayed part isn't counted twice.
  const cells = new Uint16Array(Math.ceil(length / CELL_SAMPLES))
  let heard = 0

  return {
    durationSec: length / SAMPLE_RATE,
    write(songTimeSec, samples) {
      if (!Number.isFinite(songTimeSec)) return
      const start = Math.round(songTimeSec * SAMPLE_RATE)
      const from = Math.max(0, -start)
      const to = Math.min(samples.length, length - start)
      if (to <= from) return
      audio.set(samples.subarray(from, to), start + from)
      for (let index = start + from; index < start + to;) {
        const cell = Math.floor(index / CELL_SAMPLES)
        const cellEnd = Math.min((cell + 1) * CELL_SAMPLES, start + to, length)
        const size = Math.min(CELL_SAMPLES, length - cell * CELL_SAMPLES)
        const before = cells[cell] ?? 0
        const after = Math.min(size, before + (cellEnd - index))
        cells[cell] = after
        heard += after - before
        index = cellEnd
      }
    },
    coverage: () => (length === 0 ? 0 : heard / length),
    samples: () => audio,
    heardSpans() {
      const spans: [number, number][] = []
      // In samples, so the edges are whole tenths (or the song's end) once divided.
      let from = -1
      const close = (to: number): void => {
        if (from >= 0) spans.push([from / SAMPLE_RATE, to / SAMPLE_RATE])
        from = -1
      }
      for (let cell = 0; cell < cells.length; cell++) {
        const start = cell * CELL_SAMPLES
        const size = Math.min(CELL_SAMPLES, length - start)
        if ((cells[cell] ?? 0) * 2 >= size) {
          if (from < 0) from = start
        } else {
          close(start)
        }
      }
      close(length)
      return spans
    }
  }
}
