import { existsSync } from 'fs'
import { runHelperProcess } from '../../helperProcess'
import type { StartHelper } from './client'

/** Runs the Swift helper at `path`, or null if it isn't there (not built yet, in dev). */
export function remindersHelper(path: string): StartHelper | null {
  if (!existsSync(path)) return null
  return ({ onMessage, onExit }) =>
    runHelperProcess({
      label: 'todos:reminders',
      command: path,
      args: [],
      // The helper exits when its input closes, so it never outlives the app.
      input: true,
      onMessage,
      onExit
    })
}
