// Global hotkey types shared with the renderer.
// Keep this file free of runtime imports: the renderer compiles it too.

/** What a global hotkey does. */
export type HotkeyAction =
  | 'playPause'
  | 'nextTrack'
  | 'previousTrack'
  | 'toggleTimer'
  | 'lyricsEarlier'
  | 'lyricsLater'
  | 'toggleFocusScreen'

export interface HotkeyStatus {
  action: HotkeyAction
  /** "Play or pause music" */
  label: string
  /** "⌃⌥⌘P" on a Mac, "Ctrl+Alt+Shift+P" on Windows. */
  keys: string
  /** False while hotkeys are off, or on but another app already has these keys. */
  registered: boolean
}

export interface HotkeyState {
  enabled: boolean
  hotkeys: HotkeyStatus[]
}
