import { screen, type BrowserWindow, type Display } from 'electron'
import type { DisplayChoice, PlacementInfo } from '../../ipc'
import type { SettingsStore } from '../settings/store'
import {
  displayChoices,
  numberDisplays,
  placementKey,
  placementLabel,
  resolvePlacement,
  type DisplayInfo,
  type NumberedDisplay,
  type Placement
} from './placement'
import { applyAlwaysOnTop, createFocusWindow, hideFocusWindow, showFocusWindow } from './window'

/** Plugging a monitor in fires several events in a burst; wait for it to settle. */
const DISPLAY_CHANGE_DEBOUNCE_MS = 500

export interface FocusWindowController {
  start(): void
  /** Brings the window back after it was hidden or closed (dock click, second launch). */
  ensureWindow(): void
  /** Up on its display: not hidden, and its window not closed. */
  isShown(): boolean
  /** The show/hide hotkey, the menu bar icon and the menus. */
  setShown(shown: boolean): void
  getWindow(): BrowserWindow | null
  getDisplays(): NumberedDisplay[]
  getPlacement(): Placement
  getPlacementInfo(): PlacementInfo
  /** The Customize screen's "Show on" buttons. */
  getDisplayChoices(): DisplayChoice[]
  /** Fires after the window is (re)placed, shown, hidden or closed, or the display list changes. */
  onChange(listener: () => void): () => void
}

function toDisplayInfo(display: Display): DisplayInfo {
  return {
    id: display.id,
    label: display.label,
    internal: display.internal,
    bounds: display.bounds,
    workArea: display.workArea
  }
}

function readDisplays(): NumberedDisplay[] {
  return numberDisplays(screen.getAllDisplays().map(toDisplayInfo), screen.getPrimaryDisplay().id)
}

export function createFocusWindowController(settings: SettingsStore): FocusWindowController {
  let win: BrowserWindow | null = null
  let windowKey: string | null = null
  let displays: NumberedDisplay[] = []
  let placement: Placement | null = null
  let debounce: ReturnType<typeof setTimeout> | undefined
  /** Hidden by the user; closing the window counts too, so a display change won't reopen it. */
  let hidden = false
  const listeners = new Set<() => void>()

  function notify(): void {
    for (const listener of listeners) listener()
  }

  function place(): void {
    displays = readDisplays()
    placement = resolvePlacement(displays, settings.get().display.showOn)
    const key = placementKey(placement)

    if (!win || win.isDestroyed() || key !== windowKey) {
      // A window's frame can't change after creation, and moving a native-fullscreen window
      // between displays is unreliable, so every move gets a fresh window. Create the new one
      // before closing the old so the app never has zero windows (Windows would quit).
      const previous = win
      const created = createFocusWindow(placement, () => !hidden)
      created.on('closed', () => {
        // Only the user closes the current window; replaced ones are destroyed after the swap.
        if (win === created) {
          win = null
          windowKey = null
          hidden = true
          notify()
        }
      })
      win = created
      windowKey = key
      if (previous && !previous.isDestroyed()) previous.destroy()
    }
    applyAlwaysOnTop(win, placement, settings.get().display.alwaysOnTop)
    notify()
  }

  function setShown(shown: boolean): void {
    hidden = !shown
    if (!win || win.isDestroyed()) {
      if (shown) place()
      else notify()
      return
    }
    if (shown) showFocusWindow(win, current())
    else hideFocusWindow(win, () => hidden)
    notify()
  }

  function isShown(): boolean {
    return !hidden && win !== null && !win.isDestroyed()
  }

  function current(): Placement {
    if (!placement) place()
    return placement!
  }

  function schedulePlace(): void {
    clearTimeout(debounce)
    debounce = setTimeout(place, DISPLAY_CHANGE_DEBOUNCE_MS)
  }

  return {
    start() {
      place()
      screen.on('display-added', schedulePlace)
      screen.on('display-removed', schedulePlace)
      screen.on('display-metrics-changed', schedulePlace)
      settings.subscribe(place)
    },
    ensureWindow() {
      if (isShown() && win) {
        win.show()
        win.focus()
      } else {
        setShown(true)
      }
    },
    isShown,
    setShown,
    getWindow: () => (win && !win.isDestroyed() ? win : null),
    getDisplays: () => displays,
    getPlacement: current,
    getPlacementInfo() {
      const p = current()
      return { kind: p.kind, label: placementLabel(p) }
    },
    getDisplayChoices() {
      const p = current()
      return displayChoices(displays, settings.get().display.showOn, p)
    },
    onChange(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
