import { useEffect, useRef } from 'react'
import type { ListenState } from '../../../main/ipc'
import { sendColorEditor } from '../../hooks/useLyricsColorEditor'
import { noteApplies, noteStep } from './editorView'

/**
 * "Time by listening"'s note on the last run, while the selected lines (`run`, second voices'
 * blocks too) include one it's about; else null. Once it has shown and the selection moves to
 * other lines it no longer applies, so main is asked to drop it (`noteStep`).
 */
export function useRunNote(
  listen: ListenState | null,
  run: { from: number; to: number } | null
): string | null {
  const note = listen?.note ?? null
  const lines = listen?.noteLines ?? []
  const here = note !== null && noteApplies(lines, run)
  const key = note === null ? null : JSON.stringify([note, lines])
  const shown = useRef<string | null>(null)

  useEffect(() => {
    const step = noteStep(shown.current, key, here)
    shown.current = step.shown
    if (step.drop && note !== null) sendColorEditor({ kind: 'clearNote', note })
  }, [key, here, note])

  return here ? note : null
}
