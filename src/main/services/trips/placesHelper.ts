import { existsSync } from 'fs'
import { runHelperProcess } from '../helperProcess'
import type { StartHelper } from '../todos/apple-reminders/client'

/** The Reminders helper at `path` in place-search mode, or null if it isn't there (dev, unbuilt). */
export function placesHelper(path: string): StartHelper | null {
  if (!existsSync(path)) return null
  return ({ onMessage, onExit }) =>
    runHelperProcess({
      label: 'trips',
      command: path,
      args: ['--places'],
      // The helper exits when its input closes, so it never outlives the app.
      input: true,
      onMessage,
      onExit
    })
}
