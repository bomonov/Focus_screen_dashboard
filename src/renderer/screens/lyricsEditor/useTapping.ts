import { useRef, useState } from 'react'
import type { SongColors } from '../../../main/ipc'
import { sendColorEditor } from '../../hooks/useLyricsColorEditor'
import {
  afterLineTap,
  afterTap,
  lineTapTarget,
  tapTarget,
  type Selection,
  type TapAt,
  type TapCursor,
  type TapMode
} from './selection'

/**
 * Tap timing on the editor's page: on or off, Words or Lines, and the word J marks next. In
 * Words, J's press marks a word's start and letting go its end, then it's on to the next word.
 * In Lines, only the press counts (R12: a whole line has no end to hold to): it marks the line's
 * first word, so a guessed line moves whole, then it's on to the next line. The page keeps the
 * selection: `onLine` is called when tapping moves on to another line.
 */
export function useTapping({
  colors,
  selection,
  ready,
  playing,
  onLine
}: {
  colors: SongColors | null
  selection: Selection | null
  /** J can mark now: the editor's song is on, and the selection is a line in the coding. */
  ready: boolean
  /** Main only marks while the song plays, so only then is it time for the next. */
  playing: boolean
  onLine: (line: number) => void
}): {
  /** Tap timing is on and J can mark now. */
  on: boolean
  mode: TapMode
  /** What J marks next; null when it marks nothing. */
  target: TapAt | null
  turnOn: (on: boolean) => void
  pickMode: (mode: TapMode) => void
  /** Back to the selection's start: a new selection, or a replay to tap the line again. */
  restart: () => void
  tap: (phase: 'down' | 'up') => void
} {
  const [turnedOn, setTurnedOn] = useState(false)
  const [mode, setMode] = useState<TapMode>('words')
  const [cursor, setCursor] = useState<TapCursor>(null)
  const held = useRef<TapAt | null>(null)

  const on = turnedOn && ready && colors !== null
  const target =
    on && colors ? (mode === 'lines' ? lineTapTarget : tapTarget)(colors, cursor, selection) : null

  const moveOn = (next: TapCursor): void => {
    setCursor(next)
    if (next !== 'done' && next !== null && next.line !== selection?.line) onLine(next.line)
  }

  const tap = (phase: 'down' | 'up'): void => {
    if (!colors) return
    if (phase === 'down') {
      if (!target) return
      sendColorEditor({
        kind: 'tap',
        phase: 'down',
        line: target.line,
        word: target.word,
        // Lines: the press moves the whole line there, timed or not, rather than stretching it.
        ...(mode === 'lines' ? { whole: true as const } : {})
      })
      if (mode === 'words') {
        held.current = target
        return
      }
      held.current = null
      if (playing) moveOn(afterLineTap(colors, target))
      return
    }
    // Letting go always counts in Words, even if tapping went off meanwhile; never in Lines.
    const down = held.current
    held.current = null
    if (!down) return
    sendColorEditor({ kind: 'tap', phase: 'up', line: down.line, word: down.word })
    if (playing) moveOn(afterTap(colors, down))
  }

  return {
    on,
    mode,
    target,
    turnOn: (next) => {
      setTurnedOn(next)
      setCursor(null)
    },
    pickMode: (next) => {
      setMode(next)
      setCursor(null)
      held.current = null
    },
    restart: () => setCursor(null),
    tap
  }
}
