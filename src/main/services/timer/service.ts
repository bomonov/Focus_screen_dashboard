import { readFileSync } from 'fs'
import { writeJsonFile } from '../jsonFile'
import type { SettingsStore } from '../settings/store'
import {
  advance,
  applyCommand,
  applyConfig,
  remainingAt,
  timerConfig,
  type CompletedRun,
  type TimerConfig
} from './machine'
import { parseTimerState } from './parse'
import type { TimerCommand, TimerCompletion, TimerState } from './types'

/**
 * Check at least this often while a run is going. Node timers don't count time the Mac spends
 * asleep, so one long timeout could fire minutes late; short ones catch the end right after wake.
 */
const MAX_CHECK_INTERVAL_MS = 1000
/** Timers can fire a hair early; aim just past the end so one check is enough. */
const END_MARGIN_MS = 10
/** A run that ended longer ago than this (app closed, long sleep) is old news: no chime. */
const CHIME_WINDOW_SEC = 60

export interface TimerService {
  get(): TimerState
  command(command: TimerCommand): void
  subscribe(listener: (state: TimerState) => void): () => void
  /** Fires when a run reaches its end and the chime setting is on. */
  onChime(listener: (completion: TimerCompletion) => void): () => void
  dispose(): void
}

export interface TimerServiceOptions {
  filePath: string
  settings: SettingsStore
  /** Unix epoch seconds; injectable for tests. */
  now?: () => number
}

const epochSeconds = (): number => Date.now() / 1000

export function createTimerService({
  filePath,
  settings,
  now = epochSeconds
}: TimerServiceOptions): TimerService {
  let config = timerConfig(settings.get().timer)
  // Whatever ended while the app was closed is applied quietly, at the time it ended.
  const startedAt = now()
  let state = advance(load(filePath, config, startedAt), config, startedAt).state
  save(filePath, state)

  const listeners = new Set<(state: TimerState) => void>()
  const chimeListeners = new Set<(completion: TimerCompletion) => void>()
  let check: ReturnType<typeof setTimeout> | undefined

  function commit(next: TimerState, completed: readonly CompletedRun[]): void {
    if (next !== state) {
      state = next
      save(filePath, state)
      for (const listener of listeners) listener(state)
    }

    const at = now()
    const last = completed.filter((run) => at - run.at < CHIME_WINDOW_SEC).at(-1)
    if (last && settings.get().timer.chime) {
      for (const listener of chimeListeners) listener({ mode: last.mode, phase: last.phase })
    }

    scheduleCheck()
  }

  function catchUp(): void {
    const result = advance(state, config, now())
    commit(result.state, result.completed)
  }

  function scheduleCheck(): void {
    clearTimeout(check)
    check = undefined
    // The stopwatch never ends, so main has nothing to watch; the renderer draws its seconds.
    if (state.status !== 'running' || state.durationSec === 0) return
    const untilEndMs = remainingAt(state, now()) * 1000 + END_MARGIN_MS
    check = setTimeout(catchUp, Math.min(untilEndMs, MAX_CHECK_INTERVAL_MS))
  }

  const unsubscribeSettings = settings.subscribe((next) => {
    const nextConfig = timerConfig(next.timer)
    if (sameConfig(nextConfig, config)) return
    config = nextConfig
    commit(applyConfig(state, config), [])
  })

  scheduleCheck()

  return {
    get: () => state,
    command(command) {
      // Settle anything that just ended first, so e.g. a late Pause can't stop a finished run.
      const at = now()
      const caughtUp = advance(state, config, at)
      commit(applyCommand(caughtUp.state, command, config, at), caughtUp.completed)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    onChime(listener) {
      chimeListeners.add(listener)
      return () => {
        chimeListeners.delete(listener)
      }
    },
    dispose() {
      clearTimeout(check)
      unsubscribeSettings()
      listeners.clear()
      chimeListeners.clear()
    }
  }
}

function sameConfig(a: TimerConfig, b: TimerConfig): boolean {
  return (
    a.focusSec === b.focusSec &&
    a.breakSec === b.breakSec &&
    a.countdownSec === b.countdownSec &&
    a.autoStartBreaks === b.autoStartBreaks
  )
}

function load(filePath: string, config: TimerConfig, now: number): TimerState {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    // Missing or unreadable: start fresh. A lost timer isn't worth a backup file.
    raw = undefined
  }
  return parseTimerState(raw, config, now)
}

function save(filePath: string, state: TimerState): void {
  try {
    writeJsonFile(filePath, state)
  } catch (error) {
    console.warn(`[timer] Could not save ${filePath}.`, error)
  }
}
