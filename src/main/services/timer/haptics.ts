// The trackpad's tick when a timer wheel lands on 0 (the user asked for "a checkpoint with a
// haptic", 2026-10-26). Electron can't drive the Force Touch trackpad, so the Swift helper's
// haptics mode does (native/mac-reminders, Haptics.swift): one line on its stdin, one tick
// ("tick", or "tick firm" for a wheel that came onto 0 fast). It's
// started as the wheels open, so the first tick isn't late, and stopped once they've been quiet.

/** The helper's haptics mode, as the main process runs it (wrapped, so tests can fake it). */
export interface HapticsProcess {
  write(line: string): void
  onExit(listener: () => void): void
  kill(): void
}

export interface Haptics {
  /** The wheels opened: have the helper ready. */
  warm(): void
  /** A wheel landed on 0; `firm` when it came fast, so the light tick would be missed. */
  tick(firm?: boolean): void
  dispose(): void
}

const IDLE_MS = 60_000
/** Closer ticks than this (a fast scroll round past 0) are one. */
const MIN_GAP_MS = 40

export function createHaptics(options: {
  /** Starts the helper's haptics mode; may throw when it can't. */
  start(): HapticsProcess
  idleMs?: number
}): Haptics {
  const idleMs = options.idleMs ?? IDLE_MS
  let process: HapticsProcess | null = null
  let failed = false
  let idle: ReturnType<typeof setTimeout> | undefined
  let lastTick = -Infinity

  function stop(): void {
    clearTimeout(idle)
    process?.kill()
    process = null
  }

  function ready(): HapticsProcess | null {
    clearTimeout(idle)
    idle = setTimeout(stop, idleMs)
    if (process || failed) return process
    try {
      const started = options.start()
      started.onExit(() => {
        if (process === started) process = null
      })
      process = started
    } catch {
      // No helper (a build without it, or not a Mac): the lines on the card still light up.
      failed = true
    }
    return process
  }

  return {
    warm() {
      ready()
    },
    tick(firm = false) {
      const now = Date.now()
      if (now - lastTick < MIN_GAP_MS) return
      lastTick = now
      ready()?.write(firm ? 'tick firm\n' : 'tick\n')
    },
    dispose() {
      stop()
    }
  }
}
