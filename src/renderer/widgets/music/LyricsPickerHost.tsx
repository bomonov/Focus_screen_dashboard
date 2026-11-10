import type { LyricsPickerCommand } from '../../../main/ipc'
import { useLyricsPicker } from '../../hooks/useLyricsPicker'
import type { Box } from '../cardMenu/cardMenuMotion'
import { LyricsPicker } from './LyricsPicker'

const send = (command: LyricsPickerCommand): void =>
  window.focusScreen.sendLyricsPickerCommand(command)

/** The Music card's dot, which the list grows out of like the card's menu; null when hidden. */
function musicDot(): Box | null {
  const dot = document.querySelector('[data-card="music"] .status-dot')
  if (!dot) return null
  const { left, top, right, bottom } = dot.getBoundingClientRect()
  return { left, top, right, bottom }
}

/** "Pick Other Lyrics…" on the Focus Screen: main opens it from the Music menus. */
export function LyricsPickerHost(): React.JSX.Element | null {
  const state = useLyricsPicker()
  if (!state) return null
  return <LyricsPicker state={state} from={state.open ? musicDot() : null} onCommand={send} />
}
