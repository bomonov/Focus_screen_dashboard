import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runHelperProcess } from '../helperProcess'
import type { StartCoverWorker } from './worker'

/** The SAM model native/cover-motion/setup.sh downloads. */
const MODEL_CONFIG = 'models/sam2.1-hiera-base-plus/config.json'

/**
 * Runs native/cover-motion/worker.py (`script`) with the Python environment setup.sh made in
 * `runtime`; null when either isn't there yet, and the moving parts then stay hidden.
 */
export function coverWorker(script: string, runtime: string): StartCoverWorker | null {
  const python = join(runtime, '.venv/bin/python')
  if (![script, python, join(runtime, MODEL_CONFIG)].every((path) => existsSync(path))) return null
  return ({ onMessage, onExit }) =>
    runHelperProcess({
      label: 'cover-motion:worker',
      command: python,
      // -I: only the runtime's own packages, never a module from the current folder.
      // -B: no __pycache__ beside the script, which in the installed app is inside the signed
      // bundle (a new file there breaks its code signature).
      args: ['-I', '-B', script],
      input: true,
      env: { FOCUS_COVER_RUNTIME: runtime },
      onMessage,
      onExit
    })
}
