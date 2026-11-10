import { spawn, type ChildProcess } from 'child_process'

/** A line longer than this is not one of ours; drop it rather than buffer without end. */
const MAX_LINE_CHARS = 1_000_000
const MIN_RESTART_DELAY_MS = 1000
const MAX_RESTART_DELAY_MS = 30_000
/** A helper that ran this long before exiting was healthy; restart it without backing off. */
const HEALTHY_RUN_MS = 60_000

/**
 * Collects stdout chunks into whole lines. Chunks split anywhere, including inside a
 * multi-byte character, so callers feed it strings from a UTF-8 decoding stream.
 */
export function createLineSplitter(onLine: (line: string) => void): (chunk: string) => void {
  let buffer = ''
  let skipping = false
  return (chunk) => {
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, '')
      buffer = buffer.slice(newline + 1)
      if (!skipping && line.trim() !== '') onLine(line)
      skipping = false
      newline = buffer.indexOf('\n')
    }
    if (buffer.length > MAX_LINE_CHARS) {
      buffer = ''
      skipping = true
    }
  }
}

/** Waits 1 s, 2 s, 4 s ... up to 30 s between restarts of a helper that keeps failing. */
export function restartDelayMs(failures: number): number {
  return Math.min(MAX_RESTART_DELAY_MS, MIN_RESTART_DELAY_MS * 2 ** Math.max(0, failures - 1))
}

export interface HelperProcessOptions {
  /** For log lines: "music:spotify". */
  label: string
  command: string
  args: readonly string[]
  /** One parsed JSON value per line. Lines that aren't JSON never get here. */
  onMessage: (message: unknown) => void
  /** The helper stopped (it is restarted on its own unless stop() was called). */
  onExit?: () => void
  /**
   * Keeps the helper's stdin open for `send`. The helper sees it close when the app goes away,
   * even if the app is killed, so it can exit instead of lingering.
   */
  input?: boolean
  /** Extra environment variables for the helper, on top of the app's. */
  env?: Record<string, string>
}

export interface HelperProcess {
  /** Writes one JSON line to the helper's stdin. False if it isn't running or has no input. */
  send(message: unknown): boolean
  stop(): void
}

/**
 * Runs a helper that prints one JSON object per line on stdout, and keeps it running:
 * if it exits it comes back after a short wait. Malformed output is treated as no data.
 */
export function runHelperProcess(options: HelperProcessOptions): HelperProcess {
  const { label, command, args, onMessage, onExit, input = false, env } = options
  let child: ChildProcess | null = null
  let stopped = false
  let failures = 0
  let restart: ReturnType<typeof setTimeout> | undefined

  const handleLine = (line: string): void => {
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    onMessage(message)
  }

  function launch(): void {
    const startedAt = Date.now()
    const proc = spawn(command, args, {
      stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      ...(env ? { env: { ...process.env, ...env } } : {})
    })
    child = proc
    // Writing to a helper that just died fails with EPIPE; its exit is handled below.
    proc.stdin?.on('error', () => {})
    const split = createLineSplitter(handleLine)
    proc.stdout?.setEncoding('utf8')
    proc.stdout?.on('data', (chunk: string) => split(chunk))
    // Kept short and only for the exit warning; helpers may print song titles there.
    let lastError = ''
    proc.stderr?.setEncoding('utf8')
    proc.stderr?.on('data', (chunk: string) => {
      lastError = (lastError + chunk).slice(-300)
    })

    let exited = false
    const handleExit = (detail: string | null, quiet = false): void => {
      if (exited) return
      exited = true
      child = null
      onExit?.()
      if (stopped) return
      const healthy = Date.now() - startedAt >= HEALTHY_RUN_MS
      failures = healthy ? 1 : failures + 1
      const delay = restartDelayMs(failures)
      // A healthy helper may exit on purpose now and then (to start fresh); that's not news.
      if (!quiet && (detail !== null || !healthy)) {
        console.warn(
          `[${label}] Helper stopped (${detail ?? 'exited'}); restarting in ${delay / 1000} s.`
        )
        if (lastError.trim()) console.warn(`[${label}] ${lastError.trim()}`)
      }
      restart = setTimeout(launch, delay)
    }
    proc.on('error', (error) => handleExit(error.message))
    // Ctrl-C in the terminal running the app reaches its helpers too; that's a shutdown, not news.
    proc.on('exit', (code, signal) =>
      handleExit(code === 0 ? null : (signal ?? `exit code ${code}`), signal === 'SIGINT')
    )
  }

  launch()

  return {
    send(message) {
      const stdin = child?.stdin
      if (!stdin?.writable) return false
      stdin.write(`${JSON.stringify(message)}\n`)
      return true
    },
    stop() {
      stopped = true
      clearTimeout(restart)
      child?.kill()
      child = null
    }
  }
}
