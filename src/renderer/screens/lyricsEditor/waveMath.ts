// The editor's waveform as numbers: which second sits under which pixel, zooming and panning,
// what a press lands on (a line's edge, a word's tick), and the edit a drag makes. Pure, so the
// canvas only has to draw.
import type { CodedLine, ColorEdit } from '../../../main/ipc'
import { nearestOnset, PEAK_SEC } from '../../../main/services/lyrics/singers/waveform'

/** What part of the song the waveform shows: the second at its left edge, and seconds a pixel. */
export interface WaveView {
  start: number
  secPerPx: number
}

/** The rows of the canvas, in CSS pixels from its top. */
export const LANES = {
  main: { top: 6, height: 22 },
  voice: { top: 32, height: 16 },
  /** The loudness peaks, with the words' ticks drawn over them. */
  peaks: { top: 52, bottom: 6 }
} as const

/** The canvas's height in CSS pixels. */
export const WAVE_HEIGHT = 132

/** Zoomed right in, a second is 400 px: room to place a tick on a single sound. */
const MIN_SEC_PER_PX = 1 / 400
/** About 16 seconds across the window when the editor opens. */
export const START_SPAN_SEC = 16

/** How near an edge or a tick a press has to be to take hold of it. */
const GRAB_PX = 6
/** The shortest a line can be dragged to; `lineTime` refuses a start at or after the end. */
const MIN_LINE_SEC = 0.05
/** The snap reaches this far for a loud onset (the spec's "lightly"). */
export const SNAP_SEC = 0.08

export function timeToX(view: WaveView, sec: number): number {
  return (sec - view.start) / view.secPerPx
}

export function xToTime(view: WaveView, x: number): number {
  return view.start + x * view.secPerPx
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}

/** The view kept on the song: no further in than MIN_SEC_PER_PX, no further out than all of it. */
export function fitView(view: WaveView, durationSec: number, width: number): WaveView {
  if (width <= 0 || durationSec <= 0) return view
  const widest = Math.max(MIN_SEC_PER_PX, durationSec / width)
  const secPerPx = clamp(view.secPerPx, MIN_SEC_PER_PX, widest)
  const start = clamp(view.start, 0, Math.max(0, durationSec - width * secPerPx))
  return { start, secPerPx }
}

/** Zoomed by `factor` (above 1 is further out) with the second under `x` staying under it. */
export function zoomAt(
  view: WaveView,
  x: number,
  factor: number,
  durationSec: number,
  width: number
): WaveView {
  if (!Number.isFinite(factor) || factor <= 0) return view
  const anchor = xToTime(view, x)
  const widest = Math.max(MIN_SEC_PER_PX, durationSec / Math.max(1, width))
  const secPerPx = clamp(view.secPerPx * factor, MIN_SEC_PER_PX, widest)
  return fitView({ start: anchor - x * secPerPx, secPerPx }, durationSec, width)
}

export function panBy(view: WaveView, dx: number, durationSec: number, width: number): WaveView {
  return fitView({ ...view, start: view.start + dx * view.secPerPx }, durationSec, width)
}

/**
 * The view moved just enough to show `from`..`to` (a line), or as it was when it already does.
 * A line wider than the view starts at its left edge, with a little room before it.
 */
export function reveal(
  view: WaveView,
  from: number,
  to: number,
  durationSec: number,
  width: number
): WaveView {
  const span = width * view.secPerPx
  const margin = span * 0.08
  if (from >= view.start && to <= view.start + span) return view
  const start = to - from > span - 2 * margin ? from - margin : (from + to) / 2 - span / 2
  return fitView({ ...view, start }, durationSec, width)
}

/** The loudest peak under each of `width` columns; 0 where nothing under it has been heard. */
export function peakColumns(peaks: Uint8Array, view: WaveView, width: number): Uint8Array {
  const columns = new Uint8Array(Math.max(0, Math.floor(width)))
  if (peaks.length === 0) return columns
  for (let x = 0; x < columns.length; x++) {
    const from = Math.max(0, Math.floor(xToTime(view, x) / PEAK_SEC))
    // At least one bucket a column, so zoomed in past a bucket a pixel still draws.
    const to = Math.min(
      peaks.length,
      Math.max(from + 1, Math.ceil(xToTime(view, x + 1) / PEAK_SEC))
    )
    let loudest = 0
    for (let i = from; i < to; i++) loudest = Math.max(loudest, peaks[i] ?? 0)
    columns[x] = loudest
  }
  return columns
}

/** Base64 peaks from main as bytes; anything that won't decode is no waveform. */
export function decodePeaks(base64: string | null): Uint8Array | null {
  if (base64 === null) return null
  try {
    const text = atob(base64)
    const bytes = new Uint8Array(text.length)
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

/** Said where the loudness goes while none of the song has been heard with the editor open. */
export const NOTHING_HEARD_NOTE =
  'The waveform fills in as the song plays while this window is open.'

/**
 * What to say in place of the loudness: main's words when there's no waveform (no helper, not
 * allowed), else that it fills in, while nothing has been heard yet; null once there's some.
 */
export function waveNote(peaks: Uint8Array | null, note: string | null): string | null {
  if (!peaks) return note
  return peaks.some((peak) => peak > 0) ? null : (note ?? NOTHING_HEARD_NOTE)
}

/** Where a dragged time lands: on the nearest loud onset, unless Option says leave it be. */
export function snapTime(peaks: Uint8Array | null, sec: number, free: boolean): number {
  if (free || !peaks) return sec
  return nearestOnset(peaks, sec, SNAP_SEC) ?? sec
}

export type WaveTarget =
  | { kind: 'start' | 'end'; line: number }
  | { kind: 'tick'; line: number; word: number }
  | { kind: 'block'; line: number }

function laneOf(line: CodedLine): { top: number; height: number } {
  return line.under === undefined ? LANES.main : LANES.voice
}

/**
 * What a press at `x`, `y` takes hold of. In a lane: a line's edge, else the line itself (to
 * select it); the selected line wins where lines overlap, then the later one (drawn on top).
 * Below the lanes: the selected line's word ticks, the nearest within reach.
 */
export function hitTest(
  lines: readonly CodedLine[],
  selected: number | null,
  view: WaveView,
  x: number,
  y: number
): WaveTarget | null {
  if (y >= LANES.peaks.top) {
    const line = selected === null ? undefined : lines[selected]
    if (!line || selected === null) return null
    let best: number | null = null
    let bestDistance = GRAB_PX
    for (let i = 0; i < line.words.length; i++) {
      const word = line.words[i]
      if (!word) continue
      const distance = Math.abs(timeToX(view, word.start) - x)
      // Ties go to the later word: words that start together stack, and the last can be pulled out.
      if (distance <= bestDistance) {
        best = i
        bestDistance = distance
      }
    }
    return best === null ? null : { kind: 'tick', line: selected, word: best }
  }

  const order = lines.map((_, i) => i).reverse()
  if (selected !== null && lines[selected]) order.unshift(selected)
  // Edges first, over every line, so a short line next to the selected one can still be held.
  for (const index of order) {
    const line = lines[index]
    if (!line) continue
    const lane = laneOf(line)
    if (y < lane.top || y > lane.top + lane.height) continue
    const left = timeToX(view, line.start)
    const right = timeToX(view, line.end)
    if (Math.abs(x - left) <= GRAB_PX && Math.abs(x - left) <= Math.abs(x - right)) {
      return { kind: 'start', line: index }
    }
    if (Math.abs(x - right) <= GRAB_PX) return { kind: 'end', line: index }
  }
  for (const index of order) {
    const line = lines[index]
    if (!line) continue
    const lane = laneOf(line)
    if (y < lane.top || y > lane.top + lane.height) continue
    if (x >= timeToX(view, line.start) && x <= timeToX(view, line.end)) {
      return { kind: 'block', line: index }
    }
  }
  return null
}

/**
 * A drag to `sec`: the line as it'll look (kept within what the edit allows, so what's drawn
 * is what's saved) and the edit to send when it's let go. A block's body isn't dragged.
 */
export function dragEdit(
  line: CodedLine,
  target: WaveTarget,
  sec: number,
  durationSec: number
): { preview: CodedLine; edit: ColorEdit } | null {
  if (target.kind === 'block') return null
  if (target.kind === 'tick') {
    const word = line.words[target.word]
    if (!word) return null
    // As `wordTime` places it: never before the word before it, nor past the one after.
    const earliest = Math.max(line.start, line.words[target.word - 1]?.start ?? line.start)
    const latest = Math.min(line.end, line.words[target.word + 1]?.start ?? line.end)
    const start = clamp(sec, earliest, latest)
    const end = Math.min(Math.max(word.end, start), line.end)
    const words = line.words.map((w, i) => (i === target.word ? { ...w, start, end } : w))
    return {
      preview: { ...line, words },
      edit: { kind: 'wordTime', line: target.line, word: target.word, start }
    }
  }
  const start =
    target.kind === 'start' ? clamp(sec, 0, Math.max(0, line.end - MIN_LINE_SEC)) : line.start
  const end =
    target.kind === 'end'
      ? clamp(sec, line.start + MIN_LINE_SEC, Math.max(line.start + MIN_LINE_SEC, durationSec))
      : line.end
  // As `lineTime` does: words left outside are pulled to the edge.
  const inside = (t: number): number => clamp(t, start, end)
  const words = line.words.map((w) => ({ ...w, start: inside(w.start), end: inside(w.end) }))
  const edit: ColorEdit =
    target.kind === 'start'
      ? { kind: 'lineTime', line: target.line, start }
      : { kind: 'lineTime', line: target.line, end }
  return { preview: { ...line, start, end, words }, edit }
}

/** What happened to the pointer holding a drag. */
export type DragPointer =
  { kind: 'move'; buttons: number } | { kind: 'up' } | { kind: 'cancel' } | { kind: 'lostCapture' }

/**
 * Whether a drag goes on, is let go (its edit sent), or is dropped with nothing sent. A
 * release the waveform never heard (outside the window, a system gesture taking the pointer)
 * shows up as a move with the main button up, or the capture going: the drag is dropped then,
 * so a later move can't send a time nobody chose.
 */
export function dragOn(event: DragPointer): 'keep' | 'send' | 'drop' {
  switch (event.kind) {
    case 'up':
      return 'send'
    case 'move':
      return (event.buttons & 1) === 1 ? 'keep' : 'drop'
    case 'cancel':
    case 'lostCapture':
      return 'drop'
  }
}

/** Stripes an added block keeps at its end even when its words fill it, so it still reads as added. */
export const STRIPE_TAIL_PX = 12

/**
 * Where an added block's stripes start: after its words (`labelEnd`), so they sit on the
 * block's plain fill and stay readable, but never closer to the end than STRIPE_TAIL_PX (the
 * words are cut off before the stripes there), and never before the block.
 */
export function stripeFrom(left: number, right: number, labelEnd: number): number {
  return Math.max(left, Math.min(labelEnd, right - STRIPE_TAIL_PX))
}
