import type { KeepAwake } from '../settings/schema'
import type { SettingsStore } from '../settings/store'

/** Electron's powerSaveBlocker in the app, a fake in tests. */
export interface DisplaySleepBlocker {
  start(): number
  stop(id: number): void
}

/**
 * Music playing or a timer running: someone is likely studying by the screen with their hands
 * off the keyboard, which is exactly when the OS would otherwise put the screens to sleep.
 */
export type AwakeReason = 'music' | 'timer'

export function shouldKeepAwake(mode: KeepAwake, shown: boolean, busy: boolean): boolean {
  if (!shown) return false
  return mode === 'always' || (mode === 'busy' && busy)
}

export interface KeepAwakeService {
  setBusy(reason: AwakeReason, busy: boolean): void
  /** The Focus Screen is up; a hidden or closed one never keeps anything awake. */
  setShown(shown: boolean): void
  isBlocking(): boolean
  dispose(): void
}

interface KeepAwakeOptions {
  settings: Pick<SettingsStore, 'get' | 'subscribe'>
  blocker: DisplaySleepBlocker
}

/** "Keeps that display awake while running" (the brief), as the user chose it in Customize. */
export function createKeepAwake({ settings, blocker }: KeepAwakeOptions): KeepAwakeService {
  const busy = new Set<AwakeReason>()
  let shown = false
  let blockId: number | null = null

  function apply(): void {
    const want = shouldKeepAwake(settings.get().display.keepAwake, shown, busy.size > 0)
    if (want && blockId === null) {
      blockId = blocker.start()
    } else if (!want && blockId !== null) {
      blocker.stop(blockId)
      blockId = null
    }
  }

  const unsubscribe = settings.subscribe(apply)

  return {
    setBusy(reason, on) {
      if (on) busy.add(reason)
      else busy.delete(reason)
      apply()
    },
    setShown(on) {
      shown = on
      apply()
    },
    isBlocking: () => blockId !== null,
    dispose() {
      unsubscribe()
      if (blockId !== null) blocker.stop(blockId)
      blockId = null
    }
  }
}
