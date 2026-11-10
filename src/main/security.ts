import type { Session, WebContents } from 'electron'
import { isAppUrl } from './paths'

/** The renderer only ever shows our own page: no navigation away, no popups, no webviews. */
export function hardenContents(contents: WebContents): void {
  contents.on('will-navigate', (event) => {
    if (!isAppUrl(event.url)) event.preventDefault()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
}

/** Nothing in the renderer needs camera, mic, location, notifications, etc. */
export function denyAllPermissions(session: Session): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)
}
