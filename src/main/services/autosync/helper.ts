import { existsSync } from 'fs'
import { join } from 'path'
import { runHelperProcess } from '../helperProcess'
import type { StartAligner } from './aligner'
import type { StartAudioHelper } from './client'

/** Runs the Swift audio helper at `path`, or null if it isn't there (not built yet, in dev). */
export function audioHelper(path: string): StartAudioHelper | null {
  if (!existsSync(path)) return null
  return ({ onMessage, onExit }) =>
    runHelperProcess({
      label: 'autosync:audio',
      command: path,
      args: [],
      // The helper exits when its input closes, so it never outlives the app.
      input: true,
      onMessage,
      onExit
    })
}

/** The Whisper model the aligner loads (native/aligner/setup.sh downloads it). */
const MODEL_FILE = 'models/large-v3-turbo.pt'

/**
 * Runs native/aligner/aligner.py (`script`) with the Python environment setup.sh made in
 * `runtime`; null when either isn't there yet.
 */
export function alignerWorker(script: string, runtime: string): StartAligner | null {
  const python = join(runtime, '.venv/bin/python')
  if (![script, python, join(runtime, MODEL_FILE)].every((path) => existsSync(path))) return null
  return ({ onMessage, onExit }) =>
    runHelperProcess({
      label: 'autosync:aligner',
      command: python,
      // -I: only the runtime's own packages, never a module from the current folder.
      // -B: no __pycache__ next to the script; in the installed app that's inside the signed
      // bundle, and a new file there breaks its code signature. (-I ignores PYTHON* variables,
      // so PYTHONDONTWRITEBYTECODE wouldn't do it.)
      args: ['-I', '-B', script],
      input: true,
      env: { FOCUS_ALIGNER_RUNTIME: runtime },
      onMessage,
      onExit
    })
}
