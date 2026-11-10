import type { HotkeyAction } from './types'

export interface HotkeyBinding {
  action: HotkeyAction
  /** The key pressed with the modifiers, as Electron names it. */
  key: string
  label: string
}

/**
 * Not ⌃⌥⌘ with the arrow keys (window managers such as Rectangle use them) or with comma and
 * period (macOS's own contrast shortcuts).
 */
export const HOTKEYS: readonly HotkeyBinding[] = [
  { action: 'playPause', key: 'P', label: 'Play or pause music' },
  { action: 'nextTrack', key: 'N', label: 'Next song' },
  { action: 'previousTrack', key: 'B', label: 'Previous song' },
  { action: 'toggleTimer', key: 'T', label: 'Start or pause the timer' },
  { action: 'lyricsEarlier', key: '[', label: 'Show lyrics earlier' },
  { action: 'lyricsLater', key: ']', label: 'Show lyrics later' },
  { action: 'toggleFocusScreen', key: 'F', label: 'Show or hide the Focus Screen' }
]

/**
 * Three modifiers, because a global hotkey takes the keys away from every other app. Windows
 * keeps most Win-key combinations for itself, so it gets Shift instead.
 */
export function hotkeyAccelerator(key: string, mac: boolean): string {
  return `${mac ? 'Control+Alt+Command' : 'Control+Alt+Shift'}+${key}`
}

/** How the keys read in Customize, the way each OS writes them in its own menus. */
export function hotkeyLabel(key: string, mac: boolean): string {
  return mac ? `⌃⌥⌘${key}` : `Ctrl+Alt+Shift+${key}`
}
