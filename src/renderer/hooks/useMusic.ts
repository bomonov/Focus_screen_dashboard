import type { PlaybackState } from '../../main/ipc'
import { useBridgeValue } from './useBridgeValue'

const load = (): Promise<PlaybackState> => window.focusScreen.getMusic()
const subscribe = (listener: (music: PlaybackState) => void): (() => void) =>
  window.focusScreen.onMusicChanged(listener)

export function useMusic(): PlaybackState | null {
  return useBridgeValue(load, subscribe)
}
