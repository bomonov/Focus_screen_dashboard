import { BrowserWindow, type WebPreferences } from 'electron'
import { loadRenderer, preloadPath } from '../../paths'
import { isMac } from '../../platform'
import { floatingBounds, type Placement } from './placement'

const MIN_FLOATING_SIZE = { width: 960, height: 600 }

/** Every window of ours runs our page locked down the same way. */
export const PAGE_PREFERENCES: WebPreferences = {
  preload: preloadPath,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  spellcheck: false
}

/**
 * Keep on top. A macOS fullscreen window already has its Space to itself, and raising its level
 * there can knock it out of fullscreen, so on a Mac only the floating window is raised.
 */
export function applyAlwaysOnTop(win: BrowserWindow, placement: Placement, on: boolean): void {
  const raise = on && !(isMac && placement.kind === 'fullscreen')
  if (win.isAlwaysOnTop() !== raise) win.setAlwaysOnTop(raise, 'floating')
}

/**
 * `shouldShow` is asked once the page is ready: a window made while the Focus Screen is hidden
 * (e.g. a monitor was plugged in) stays hidden until it's shown again.
 */
export function createFocusWindow(placement: Placement, shouldShow: () => boolean): BrowserWindow {
  const fullscreen = placement.kind === 'fullscreen'
  const { workArea } = placement.display
  const bounds = fullscreen ? workArea : floatingBounds(workArea)

  const win = new BrowserWindow({
    // Starting inside the target display is what makes fullscreen land on that display.
    ...bounds,
    ...(fullscreen
      ? {}
      : {
          minWidth: Math.min(MIN_FLOATING_SIZE.width, bounds.width),
          minHeight: Math.min(MIN_FLOATING_SIZE.height, bounds.height)
        }),
    show: false,
    frame: !fullscreen,
    fullscreenable: true,
    backgroundColor: '#000000',
    title: 'Focus Screen',
    autoHideMenuBar: true,
    // You work in another app and reach over to press a button here. Without this, macOS spends
    // that first click on bringing the window forward and the button never sees it.
    acceptFirstMouse: true,
    webPreferences: PAGE_PREFERENCES
  })

  win.once('ready-to-show', () => {
    if (shouldShow()) showFocusWindow(win, placement)
  })

  loadRenderer(win).catch((error: unknown) => {
    console.error('[display] Failed to load the renderer.', error)
  })

  return win
}

export function showFocusWindow(win: BrowserWindow, placement: Placement): void {
  win.show()
  // Native fullscreen rather than macOS "simple" fullscreen: simple fullscreen only hides the
  // menu bar while we're the active app, so the second screen's menu bar would cover the top
  // bar whenever you work in another app. Native fullscreen keeps that display to itself.
  if (placement.kind === 'fullscreen' && !win.isFullScreen()) win.setFullScreen(true)
}

/**
 * Hides the window but keeps its page running, so the timer chime still sounds. A macOS
 * native-fullscreen window hidden as is leaves its Space behind as a black screen, so it leaves
 * fullscreen first. `stillHidden` covers being shown again before that's done.
 */
export function hideFocusWindow(win: BrowserWindow, stillHidden: () => boolean): void {
  if (isMac && win.isFullScreen()) {
    win.once('leave-full-screen', () => {
      if (!win.isDestroyed() && stillHidden()) win.hide()
    })
    win.setFullScreen(false)
  } else {
    win.hide()
  }
}
