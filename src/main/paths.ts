import { app, type BrowserWindow } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { isMac } from './platform'

export const isDev = !app.isPackaged

/** Set by electron-vite while `npm run dev` serves the renderer with hot reload. */
const devServerUrl = isDev ? process.env['ELECTRON_RENDERER_URL'] : undefined
const rendererFile = join(__dirname, '../renderer/index.html')

export const preloadPath = join(__dirname, '../preload/index.js')

const REMINDERS_HELPER = 'Focus Screen Reminders.app/Contents/MacOS/focus-screen-reminders'
/**
 * macOS only. Dev runs the copy `npm run build:reminders` puts outside ~/Desktop (see
 * native/mac-reminders/build.sh); the packaged app carries its own in Resources.
 */
export const remindersHelperPath = isDev
  ? join(homedir(), 'Library/Developer/FocusScreen', REMINDERS_HELPER)
  : join(process.resourcesPath, REMINDERS_HELPER)

const AUDIO_HELPER = 'Focus Screen Audio.app/Contents/MacOS/focus-screen-audio'
/** macOS only, like the Reminders helper; `npm run build:audio` builds dev's copy. */
export const audioHelperPath = isDev
  ? join(homedir(), 'Library/Developer/FocusScreen', AUDIO_HELPER)
  : join(process.resourcesPath, AUDIO_HELPER)
/** The lyrics aligner's script; its Python runtime lives in the app's user data (aligner/). */
export const alignerScriptPath = isDev
  ? join(__dirname, '../../native/aligner/aligner.py')
  : join(process.resourcesPath, 'aligner/aligner.py')
/** The moving cover parts' worker; its Python runtime lives in the app's user data (cover-motion/). */
export const coverMotionScriptPath = isDev
  ? join(__dirname, '../../native/cover-motion/worker.py')
  : join(process.resourcesPath, 'cover-motion/worker.py')
/** Dev builds only: songs recorded to measure lyric aligners against. */
export const autosyncSamplesDir = join(homedir(), 'Library/Developer/FocusScreen/autosync-samples')

/**
 * The menu bar (macOS) or tray (Windows) icon. macOS gets a black "Template" image that it
 * colors to match the menu bar, and loads the @2x file next to it by itself. Packaged copies
 * come from extraResources in electron-builder.yml; dev reads the repo's (out/main → repo root).
 */
const TRAY_ICON = isMac ? 'trayTemplate.png' : 'tray.ico'
export const trayIconPath = isDev
  ? join(__dirname, '../../assets/tray', TRAY_ICON)
  : join(process.resourcesPath, 'tray', TRAY_ICON)

/** Which screen a window's page shows; the renderer reads it from the URL hash. */
export type RendererView = 'focus' | 'customize' | 'lyrics-editor'

export function loadRenderer(win: BrowserWindow, view: RendererView = 'focus'): Promise<void> {
  if (devServerUrl) return win.loadURL(`${devServerUrl}#${view}`)
  return win.loadFile(rendererFile, { hash: view })
}

/** True only for our own renderer page, used to vet navigation and IPC senders. */
export function isAppUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (devServerUrl) return parsed.origin === new URL(devServerUrl).origin
  return parsed.protocol === 'file:' && parsed.pathname === pathToFileURL(rendererFile).pathname
}
