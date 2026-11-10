import { Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'
import { trayIconPath } from './paths'
import { isMac } from './platform'

export interface TrayContext {
  /** The Focus Screen is up (not hidden or closed). */
  shown: boolean
  /** The live show/hide hotkey, to show next to the item; null while it isn't registered. */
  toggleAccelerator: string | null
  setShown(shown: boolean): void
  openCustomize(): void
  /** A playlist is being prepared (played muted); the menu offers to stop it. */
  preparing: boolean
  stopPreparing(): void
}

export interface AppTray {
  update(ctx: TrayContext): void
  destroy(): void
}

function template(ctx: TrayContext): MenuItemConstructorOptions[] {
  return [
    {
      label: ctx.shown ? 'Hide Focus Screen' : 'Show Focus Screen',
      // Only a hint: the global hotkey already handles these keys.
      ...(ctx.toggleAccelerator
        ? { accelerator: ctx.toggleAccelerator, registerAccelerator: false }
        : {}),
      click: () => ctx.setShown(!ctx.shown)
    },
    { label: 'Customize…', click: () => ctx.openCustomize() },
    ...(ctx.preparing
      ? [
          { type: 'separator' as const },
          { label: 'Stop Preparing Playlist', click: () => ctx.stopPreparing() }
        ]
      : []),
    { type: 'separator' },
    { role: 'quit', label: 'Quit Focus Screen' }
  ]
}

/** The brief's menu bar icon (macOS) or tray icon (Windows): Show, Customize, Quit. */
export function createAppTray(ctx: TrayContext): AppTray | null {
  const image = nativeImage.createFromPath(trayIconPath)
  if (image.isEmpty()) {
    console.warn('[tray] The menu bar icon is missing; running without it.')
    return null
  }
  if (isMac) image.setTemplateImage(true)

  const tray = new Tray(image)
  tray.setToolTip('Focus Screen')
  let current = ctx
  // On Windows a click on a tray icon is expected to open the app; the menu is on right-click.
  if (!isMac) tray.on('click', () => current.setShown(true))

  function update(next: TrayContext): void {
    current = next
    tray.setContextMenu(Menu.buildFromTemplate(template(next)))
  }
  update(ctx)

  return {
    update,
    destroy: () => tray.destroy()
  }
}
