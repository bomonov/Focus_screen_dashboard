import type { LyricsState } from '../../main/ipc'
import { useBridgeValue } from './useBridgeValue'

const load = (): Promise<LyricsState> => window.focusScreen.getLyrics()
const subscribe = (listener: (lyrics: LyricsState) => void): (() => void) =>
  window.focusScreen.onLyricsChanged(listener)

export function useLyrics(): LyricsState | null {
  return useBridgeValue(load, subscribe)
}
