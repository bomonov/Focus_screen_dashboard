import type { LyricsPickerState } from '../../main/ipc'
import { useBridgeValue } from './useBridgeValue'

const load = (): Promise<LyricsPickerState> => window.focusScreen.getLyricsPicker()
const subscribe = (listener: (state: LyricsPickerState) => void): (() => void) =>
  window.focusScreen.onLyricsPickerChanged(listener)

/** "Pick Other Lyrics…" as main holds it; null until it answers. */
export function useLyricsPicker(): LyricsPickerState | null {
  return useBridgeValue(load, subscribe)
}
