import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import type { CodedLine, ColorEdit, PlaybackState, SongColors } from '../../../main/ipc'
import { positionAt } from '../../../main/services/music/types'
import { onAccentColor } from '../../theme/color'
import { singersInOrder, type SingerLookup } from '../../widgets/music/singerColors'
import { sendColorEditor } from '../../hooks/useLyricsColorEditor'
import { slideTo } from '../../../main/services/lyrics/singers/lineSlide'
import { resolveSingers } from './lineRows'
import {
  dragEdit,
  dragOn,
  fitView,
  hitTest,
  LANES,
  panBy,
  peakColumns,
  reveal,
  snapTime,
  START_SPAN_SEC,
  stripeFrom,
  timeToX,
  WAVE_HEIGHT,
  xToTime,
  zoomAt,
  waveNote,
  type WaveTarget,
  type WaveView
} from './waveMath'

/**
 * A line's block held to slide it: where it was pressed (`grabSec`, `grabX`) and where the line
 * started then. It slides only once the pointer has moved SLIDE_AFTER_PX, so a click still just
 * selects.
 */
interface Slide {
  kind: 'slide'
  line: number
  grabSec: number
  grabX: number
  from: number
  moving: boolean
}

interface Drag {
  target: Exclude<WaveTarget, { kind: 'block' }> | Slide
  preview: CodedLine | null
  edit: ColorEdit | null
}

/** How far a held block moves before it slides: a click that wobbles a pixel only selects. */
const SLIDE_AFTER_PX = 4

/**
 * The theme's colors the canvas draws with, read when it draws (the theme can change). The
 * added lines' color is the editor's own, so it's read where the canvas is.
 */
function palette(
  canvas: HTMLCanvasElement
): Record<'text' | 'dim' | 'border' | 'strong' | 'accent' | 'added', string> {
  const css = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string): string =>
    css.getPropertyValue(name).trim() || fallback
  return {
    text: read('--text', '#ffffff'),
    dim: read('--text-dim', '#9a9a9a'),
    border: read('--border', '#2a2a2a'),
    strong: read('--border-strong', '#484848'),
    accent: read('--accent', '#ffc627'),
    added:
      getComputedStyle(canvas).getPropertyValue('--lyrics-added').trim() ||
      'rgb(255 255 255 / 0.35)'
  }
}

/** A stripe and the gap after it, across: the added lines' 45° bands. */
const STRIPE_PX = 6

/**
 * 45° stripes over a block from `from` on, for a line the user added: no singer's color, so it
 * reads as theirs. They stop short of the block's words (`stripeFrom`), which stay on its fill.
 */
function stripe(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  from: number,
  color: string
): void {
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(left, top, width, height, 4)
  ctx.clip()
  ctx.beginPath()
  ctx.rect(from, top, left + width - from, height)
  ctx.clip()
  ctx.fillStyle = color
  ctx.beginPath()
  // From the block's own left, so the stripes move with it as the view pans.
  for (let x = left - height; x < left + width; x += STRIPE_PX * 2) {
    ctx.moveTo(x, top + height)
    ctx.lineTo(x + STRIPE_PX, top + height)
    ctx.lineTo(x + STRIPE_PX + height, top)
    ctx.lineTo(x + height, top)
    ctx.closePath()
  }
  ctx.fill()
  ctx.restore()
}

const epochSeconds = (): number => Date.now() / 1000
/** One wheel notch of ⌘ + scroll zooms by about this much. */
const ZOOM_PER_PIXEL = 0.01

function draw(
  canvas: HTMLCanvasElement,
  width: number,
  view: WaveView,
  colors: SongColors,
  selected: number | null,
  drag: Drag | null,
  peaks: Uint8Array | null,
  hexes: SingerLookup
): void {
  const ratio = window.devicePixelRatio || 1
  const height = WAVE_HEIGHT
  if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio)
  if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const ink = palette(canvas)
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, width, height)

  // The loudness, mirrored about the middle of its band; nothing where it hasn't been heard.
  const top = LANES.peaks.top
  const half = (height - top - LANES.peaks.bottom) / 2
  const middle = top + half
  ctx.fillStyle = ink.border
  ctx.fillRect(0, middle, width, 1)
  if (peaks) {
    ctx.fillStyle = ink.strong
    peakColumns(peaks, view, width).forEach((peak, x) => {
      if (peak === 0) return
      const reach = Math.max(0.5, (peak / 255) * half)
      ctx.fillRect(x, middle - reach, 1, reach * 2)
    })
  }

  const lineAt = (index: number): CodedLine | undefined =>
    drag?.preview && drag.target.line === index ? drag.preview : colors.lines[index]

  // The selected line last, so it's on top where lines overlap.
  const order = colors.lines.map((_, i) => i).filter((i) => i !== selected)
  if (selected !== null && colors.lines[selected]) order.push(selected)

  ctx.font = 'bold 11px Arial, Helvetica, sans-serif'
  ctx.textBaseline = 'middle'
  for (const index of order) {
    const line = lineAt(index)
    if (!line) continue
    const lane = line.under === undefined ? LANES.main : LANES.voice
    const left = timeToX(view, line.start)
    const right = timeToX(view, line.end)
    if (right < 0 || left > width) continue
    const blockWidth = Math.max(2, right - left)
    const singers = singersInOrder(
      line.words.map((word) => resolveSingers(word.singers, colors.cast))
    )
    const shades = singers.length > 0 ? hexes(singers) : []
    if (shades.length > 1) {
      const gradient = ctx.createLinearGradient(left, 0, left + blockWidth, 0)
      shades.forEach((shade, i) => gradient.addColorStop(i / (shades.length - 1), shade))
      ctx.fillStyle = gradient
    } else {
      // A break is nobody's: a quieter block than a line nobody's been given yet.
      ctx.fillStyle = shades[0] ?? (line.instrumental ? ink.border : ink.strong)
    }
    ctx.beginPath()
    ctx.roundRect(left, lane.top, blockWidth, lane.height, 4)
    ctx.fill()
    const words = line.instrumental
      ? '♪ Break'
      : line.words.map((word) => word.text).join('') || line.text
    const textX = Math.max(left, 0) + 5
    // An added line's stripes start after its words, so they're read on the plain fill.
    const wordsTo = line.added
      ? stripeFrom(left, left + blockWidth, textX + ctx.measureText(words).width + 4)
      : left + blockWidth
    if (line.added) {
      stripe(ctx, left, lane.top, blockWidth, lane.height, wordsTo, ink.added)
    }
    if (index === selected) {
      ctx.beginPath()
      ctx.roundRect(left, lane.top, blockWidth, lane.height, 4)
      ctx.lineWidth = 2
      ctx.strokeStyle = ink.text
      ctx.stroke()
    }
    // The words, cut off at the block's end (an added line's before its stripes).
    ctx.save()
    ctx.beginPath()
    ctx.rect(left, lane.top, wordsTo - left, lane.height)
    ctx.clip()
    ctx.fillStyle = shades[0] ? onAccentColor(shades[0]) : ink.text
    ctx.fillText(words, textX, lane.top + lane.height / 2 + 0.5)
    ctx.restore()
  }

  // Word starts: every line's faintly, the selected line's bright with a knob to take hold of.
  for (const index of order) {
    const line = lineAt(index)
    if (!line) continue
    const mine = index === selected
    line.words.forEach((word, i) => {
      const x = Math.round(timeToX(view, word.start)) + 0.5
      if (x < -2 || x > width + 2) return
      const held = mine && drag?.target.kind === 'tick' && drag.target.word === i
      ctx.globalAlpha = mine ? 1 : 0.35
      ctx.fillStyle = held ? ink.accent : mine ? ink.text : ink.dim
      ctx.fillRect(x - 0.5, top, 1, height - top - LANES.peaks.bottom)
      if (mine) {
        ctx.beginPath()
        ctx.arc(x, top + 3, 3, 0, Math.PI * 2)
        ctx.fill()
      }
    })
  }
  ctx.globalAlpha = 1

  // The edge being dragged, in the accent.
  if (drag && drag.target.kind !== 'tick') {
    const line = lineAt(drag.target.line)
    if (line) {
      const lane = line.under === undefined ? LANES.main : LANES.voice
      const x = timeToX(view, drag.target.kind === 'start' ? line.start : line.end)
      ctx.fillStyle = ink.accent
      ctx.fillRect(Math.round(x) - 1, lane.top - 3, 2, lane.height + 6)
    }
  }
}

/**
 * The song's loudness as heard so far, its lines as blocks in their singers' colors (second
 * voices on a lane of their own), the selected line's word starts as ticks, and the playhead.
 * Dragging an edge or a tick retimes it, snapped to the nearest onset unless Option is held;
 * pinch or ⌘ + scroll zooms, scrolling pans.
 */
export function Waveform({
  colors,
  selected,
  peaks,
  note,
  durationSec,
  music,
  playingThis,
  hexes,
  onSelect
}: {
  colors: SongColors
  selected: number | null
  peaks: Uint8Array | null
  note: string | null
  durationSec: number
  music: PlaybackState | null
  playingThis: boolean
  hexes: SingerLookup
  onSelect: (line: number) => void
}): React.JSX.Element {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const playhead = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [chosenView, setView] = useState<WaveView | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [revealed, setRevealed] = useState<number | null>(null)

  const start: WaveView = chosenView ?? { start: 0, secPerPx: START_SPAN_SEC / Math.max(1, width) }
  let view = fitView(start, durationSec, width)
  // A newly selected line is brought into view (kept as derived state, not an effect).
  const line = selected === null ? undefined : colors.lines[selected]
  if (width > 0 && selected !== revealed) {
    setRevealed(selected)
    if (line) {
      view = reveal(view, line.start, line.end, durationSec, width)
      setView(view)
    }
  }

  useEffect(() => {
    const element = wrap.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (canvas.current && width > 0) {
      draw(canvas.current, width, view, colors, selected, drag, peaks, hexes)
    }
  }, [width, view, colors, selected, drag, peaks, hexes])

  // Zooming and panning need the wheel before the page scrolls, so the listener can't be passive.
  const onWheel = useEffectEvent((event: WheelEvent) => {
    if (width <= 0) return
    event.preventDefault()
    const box = canvas.current?.getBoundingClientRect()
    const x = event.clientX - (box?.left ?? 0)
    // A trackpad pinch arrives as a wheel with Ctrl held.
    if (event.ctrlKey || event.metaKey) {
      setView(zoomAt(view, x, Math.exp(event.deltaY * ZOOM_PER_PIXEL), durationSec, width))
      return
    }
    const dx = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    setView(panBy(view, dx, durationSec, width))
  })
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const listener = (event: WheelEvent): void => onWheel(event)
    element.addEventListener('wheel', listener, { passive: false })
    return () => element.removeEventListener('wheel', listener)
  }, [])

  // The playhead moves on its own layer, so the canvas isn't redrawn every frame. It runs only
  // while this song plays, and turns the page when it runs off the right.
  const page = useEffectEvent((position: number) => {
    if (!drag)
      setView(
        fitView({ ...view, start: position - width * view.secPerPx * 0.1 }, durationSec, width)
      )
  })
  useEffect(() => {
    const head = playhead.current
    if (!head) return
    if (!music || !playingThis || width <= 0) {
      head.hidden = true
      return
    }
    head.hidden = false
    let frame = 0
    let wasShown = false
    const place = (): void => {
      const position = positionAt(music, epochSeconds())
      const x = timeToX(view, position)
      head.style.transform = `translateX(${Math.round(x)}px)`
      const shown = x >= 0 && x <= width
      if (wasShown && x > width) page(position)
      wasShown = shown
      if (music.playing) frame = requestAnimationFrame(place)
    }
    place()
    return () => cancelAnimationFrame(frame)
  }, [music, playingThis, view, width])

  const shownNote = useMemo(() => waveNote(peaks, note), [peaks, note])

  const pointAt = (event: React.PointerEvent): { x: number; y: number } => {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }

  return (
    <div className="waveform" ref={wrap}>
      <canvas
        ref={canvas}
        className="waveform__canvas"
        style={{ height: WAVE_HEIGHT }}
        role="img"
        aria-label="The song's waveform: lines as blocks, the selected line's word starts as ticks. Drag a block to move its line, or an edge or a tick to retime it; hold Option to place it freely. Pinch or ⌘-scroll to zoom."
        onPointerDown={(event) => {
          if (event.button !== 0) return
          const { x, y } = pointAt(event)
          const target = hitTest(colors.lines, selected, view, x, y)
          if (!target) return
          if (target.line !== selected) {
            // It's on screen already: moving the view to it would slide it out from under the drag.
            setRevealed(target.line)
          }
          // A block pressed picks its line, for Delete too, even when it was selected already; an
          // edge or tick of the selected line leaves the words picked in the edit area alone.
          if (target.kind === 'block' || target.line !== selected) onSelect(target.line)
          event.currentTarget.setPointerCapture(event.pointerId)
          const line = colors.lines[target.line]
          if (target.kind === 'block') {
            if (!line) return
            const slide: Slide = {
              kind: 'slide',
              line: target.line,
              grabSec: xToTime(view, x),
              grabX: x,
              from: line.start,
              moving: false
            }
            setDrag({ target: slide, preview: null, edit: null })
            return
          }
          setDrag({ target, preview: null, edit: null })
        }}
        onPointerMove={(event) => {
          const { x, y } = pointAt(event)
          if (!drag) {
            const target = hitTest(colors.lines, selected, view, x, y)
            event.currentTarget.style.cursor =
              target === null ? '' : target.kind === 'block' ? 'grab' : 'ew-resize'
            return
          }
          if (dragOn({ kind: 'move', buttons: event.buttons }) === 'drop') {
            setDrag(null)
            return
          }
          const line = colors.lines[drag.target.line]
          if (!line) return
          const { target } = drag
          if (target.kind === 'slide') {
            if (!target.moving && Math.abs(x - target.grabX) < SLIDE_AFTER_PX) return
            event.currentTarget.style.cursor = 'grabbing'
            // The line's start moves as far as the pointer has, then lands on a beat nearby.
            const wanted = target.from + xToTime(view, x) - target.grabSec
            const start = snapTime(peaks, wanted, event.altKey)
            const preview = slideTo(colors, target.line, start, durationSec)
            if (!preview) return
            const edit: ColorEdit = {
              kind: 'slideLine',
              line: target.line,
              start: preview.start,
              ...(durationSec > 0 ? { songEnd: durationSec } : {})
            }
            setDrag({ target: { ...target, moving: true }, preview, edit })
            return
          }
          const sec = snapTime(peaks, xToTime(view, x), event.altKey)
          const result = dragEdit(line, target, sec, durationSec)
          if (result) setDrag({ ...drag, preview: result.preview, edit: result.edit })
        }}
        onPointerUp={() => {
          if (drag?.edit) sendColorEditor({ kind: 'edit', edit: drag.edit })
          setDrag(null)
        }}
        onPointerCancel={() => setDrag(null)}
        // After a release this comes second and finds no drag; without one, the drag is lost.
        onLostPointerCapture={() => setDrag(null)}
      />
      <div ref={playhead} className="waveform__playhead" hidden aria-hidden="true" />
      {shownNote && (
        <p className="waveform__note">
          <span>{shownNote}</span>
        </p>
      )}
    </div>
  )
}
