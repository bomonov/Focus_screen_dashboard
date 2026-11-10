import type { SettingsStore } from '../settings/store'
import { HOTKEYS, hotkeyAccelerator, hotkeyLabel } from './bindings'
import type { HotkeyAction, HotkeyState } from './types'

/** Electron's globalShortcut in the app, a fake in tests. */
export interface ShortcutRegistrar {
  /** False (or a throw) when the keys can't be had, e.g. another app already uses them. */
  register(accelerator: string, run: () => void): boolean
  unregister(accelerator: string): void
}

export interface HotkeyService {
  get(): HotkeyState
  subscribe(listener: (state: HotkeyState) => void): () => void
  /** The accelerator for a menu to show next to the same command; null when it isn't live. */
  acceleratorFor(action: HotkeyAction): string | null
  dispose(): void
}

interface HotkeyServiceOptions {
  settings: Pick<SettingsStore, 'get' | 'subscribe'>
  registrar: ShortcutRegistrar
  mac: boolean
  actions: Record<HotkeyAction, () => void>
}

export function createHotkeyService({
  settings,
  registrar,
  mac,
  actions
}: HotkeyServiceOptions): HotkeyService {
  const registered = new Set<HotkeyAction>()
  const listeners = new Set<(state: HotkeyState) => void>()
  let enabled = false

  function build(): HotkeyState {
    return {
      enabled,
      hotkeys: HOTKEYS.map(({ action, key, label }) => ({
        action,
        label,
        keys: hotkeyLabel(key, mac),
        registered: registered.has(action)
      }))
    }
  }

  let state = build()

  function registerAll(): void {
    for (const { action, key } of HOTKEYS) {
      let ok = false
      try {
        ok = registrar.register(hotkeyAccelerator(key, mac), () => {
          try {
            actions[action]()
          } catch (error) {
            console.warn(`[hotkeys] ${action} failed.`, error)
          }
        })
      } catch (error) {
        console.warn(`[hotkeys] Could not register ${action}.`, error)
      }
      if (ok) registered.add(action)
    }
  }

  function unregisterAll(): void {
    for (const { action, key } of HOTKEYS) {
      if (registered.has(action)) registrar.unregister(hotkeyAccelerator(key, mac))
    }
    registered.clear()
  }

  function apply(): void {
    const want = settings.get().hotkeys.enabled
    if (want === enabled) return
    enabled = want
    if (want) registerAll()
    else unregisterAll()
    state = build()
    for (const listener of listeners) listener(state)
  }

  const unsubscribe = settings.subscribe(apply)
  apply()

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    acceleratorFor(action) {
      const binding = HOTKEYS.find((hotkey) => hotkey.action === action)
      return binding && registered.has(action) ? hotkeyAccelerator(binding.key, mac) : null
    },
    dispose() {
      unsubscribe()
      unregisterAll()
      listeners.clear()
    }
  }
}
