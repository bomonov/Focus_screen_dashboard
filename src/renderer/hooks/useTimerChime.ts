import { useEffect } from 'react'
import { playChime } from '../widgets/timer/chime'

/** Main decides when to chime (it owns the timer and the setting); the renderer has the speakers. */
export function useTimerChime(): void {
  useEffect(() => window.focusScreen.onTimerChime(() => playChime()), [])
}
