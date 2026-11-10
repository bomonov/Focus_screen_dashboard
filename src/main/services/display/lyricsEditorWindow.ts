import { BrowserWindow } from 'electron'
import { loadRenderer } from '../../paths'
import type { FocusWindowController } from './controller'
import { customizeDisplay, lyricsEditorBounds } from './placement'
import { PAGE_PREFERENCES } from './window'

/** Room for the lines and the waveform under them; smaller than this they'd be squeezed. */
const MIN_SIZE = { width: 900, height: 600 }
const TITLE = 'Color-Code Lyrics'

export interface LyricsEditorWindowController {
  /** Opens the Color-Code Lyrics window, or brings it forward when it's already open. */
  open(): void
  close(): void
  getWindow(): BrowserWindow | null
  /** Fires when the window opens or closes. */
  onChange(listener: (open: boolean) => void): () => void
}

/**
 * The Color-Code Lyrics editor is a normal window on the main screen, like Customize, so the
 * Focus Screen shows each change while you make it.
 */
export function createLyricsEditorWindowController(
  focus: FocusWindowController
): LyricsEditorWindowController {
  let win: BrowserWindow | null = null
  const listeners = new Set<(open: boolean) => void>()

  function notify(open: boolean): void {
    for (const listener of listeners) listener(open)
  }

  function create(): BrowserWindow {
    const display = customizeDisplay(focus.getDisplays(), focus.getPlacement())
    const bounds = lyricsEditorBounds(display.workArea)
    const created = new BrowserWindow({
      ...bounds,
      minWidth: Math.min(MIN_SIZE.width, bounds.width),
      minHeight: Math.min(MIN_SIZE.height, bounds.height),
      show: false,
      title: TITLE,
      backgroundColor: '#000000',
      autoHideMenuBar: true,
      fullscreenable: false,
      acceptFirstMouse: true,
      webPreferences: PAGE_PREFERENCES
    })
    created.once('ready-to-show', () => {
      created.show()
      created.focus()
    })
    created.on('closed', () => {
      if (win === created) {
        win = null
        notify(false)
      }
    })
    loadRenderer(created, 'lyrics-editor').catch((error: unknown) => {
      console.error('[display] Failed to load the Color-Code Lyrics screen.', error)
    })
    return created
  }

  return {
    open() {
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
        return
      }
      win = create()
      notify(true)
    },
    close() {
      if (win && !win.isDestroyed()) win.close()
    },
    getWindow: () => (win && !win.isDestroyed() ? win : null),
    onChange(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
