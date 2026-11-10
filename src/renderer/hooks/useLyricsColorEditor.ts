import type { ColorEditorCommand, ColorEditorState } from '../../main/ipc'
import { useBridgeValue } from './useBridgeValue'

const load = (): Promise<ColorEditorState> => window.focusScreen.getLyricsColorEditor()
const subscribe = (listener: (state: ColorEditorState) => void): (() => void) =>
  window.focusScreen.onLyricsColorEditorChanged(listener)

/** The Color-Code Lyrics session as main holds it; null until it answers. */
export function useLyricsColorEditor(): ColorEditorState | null {
  return useBridgeValue(load, subscribe)
}

/** Everything the editor asks of main goes through here. */
export function sendColorEditor(command: ColorEditorCommand): void {
  window.focusScreen.sendLyricsColorEditorCommand(command)
}
