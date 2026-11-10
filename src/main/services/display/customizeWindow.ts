import { BrowserWindow } from 'electron'
import { loadRenderer } from '../../paths'
import type { FocusWindowController } from './controller'
import { customizeBounds, customizeDisplay } from './placement'
import { PAGE_PREFERENCES } from './window'

const MIN_SIZE = { width: 640, height: 520 }

export interface CustomizeWindowController {
  /** Opens the Customize window, or brings it forward when it's already open. */
  open(): void
  close(): void
  getWindow(): BrowserWindow | null
  /** Fires when the window opens or closes. */
  onChange(listener: (open: boolean) => void): () => void
}

/**
 * Customize is a normal window next to the Focus Screen rather than a page inside it, so every
 * change shows up live on the Focus Screen while you make it.
 */
export function createCustomizeWindowController(
  focus: FocusWindowController
): CustomizeWindowController {
  let win: BrowserWindow | null = null
  const listeners = new Set<(open: boolean) => void>()

  function notify(open: boolean): void {
    for (const listener of listeners) listener(open)
  }

  function create(): BrowserWindow {
    const display = customizeDisplay(focus.getDisplays(), focus.getPlacement())
    const bounds = customizeBounds(display.workArea)
    const created = new BrowserWindow({
      ...bounds,
      minWidth: Math.min(MIN_SIZE.width, bounds.width),
      minHeight: Math.min(MIN_SIZE.height, bounds.height),
      show: false,
      title: 'Customize',
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
    loadRenderer(created, 'customize').catch((error: unknown) => {
      console.error('[display] Failed to load the Customize screen.', error)
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
