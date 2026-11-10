import type { CoverEditorState } from '../../main/ipc'
import { useBridgeValue } from './useBridgeValue'

const load = (): Promise<CoverEditorState> => window.focusScreen.getCoverEditor()
const subscribe = (listener: (state: CoverEditorState) => void): (() => void) =>
  window.focusScreen.onCoverEditorChanged(listener)

/** The moving parts editor's state, from main; null until it answers. */
export function useCoverEditor(): CoverEditorState | null {
  return useBridgeValue(load, subscribe)
}
