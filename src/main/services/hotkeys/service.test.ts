import { describe, expect, it, vi, type Mock } from 'vitest'
import { defaultSettings, type Settings } from '../settings/schema'
import { HOTKEYS, hotkeyAccelerator, hotkeyLabel } from './bindings'
import { createHotkeyService, type ShortcutRegistrar } from './service'
import type { HotkeyAction } from './types'

function fakeSettings(enabled: boolean): {
  get(): Settings
  subscribe(listener: (settings: Settings) => void): () => void
  setEnabled(on: boolean): void
} {
  let current: Settings = { ...defaultSettings(), hotkeys: { enabled } }
  const listeners = new Set<(settings: Settings) => void>()
  return {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setEnabled(on) {
      current = { ...current, hotkeys: { enabled: on } }
      for (const listener of listeners) listener(current)
    }
  }
}

/** Like globalShortcut: one owner per accelerator, and `taken` ones belong to another app. */
function fakeRegistrar(taken: string[] = []): ShortcutRegistrar & {
  live: Map<string, () => void>
  press(accelerator: string): void
} {
  const live = new Map<string, () => void>()
  return {
    live,
    register(accelerator, run) {
      if (taken.includes(accelerator) || live.has(accelerator)) return false
      live.set(accelerator, run)
      return true
    },
    unregister(accelerator) {
      live.delete(accelerator)
    },
    press(accelerator) {
      live.get(accelerator)?.()
    }
  }
}

function fakeActions(): Record<HotkeyAction, Mock<() => void>> {
  return {
    playPause: vi.fn(),
    nextTrack: vi.fn(),
    previousTrack: vi.fn(),
    toggleTimer: vi.fn(),
    lyricsEarlier: vi.fn(),
    lyricsLater: vi.fn(),
    toggleFocusScreen: vi.fn()
  }
}

describe('hotkey bindings', () => {
  it('uses three modifiers on each OS', () => {
    expect(hotkeyAccelerator('P', true)).toBe('Control+Alt+Command+P')
    expect(hotkeyAccelerator('P', false)).toBe('Control+Alt+Shift+P')
    expect(hotkeyLabel('[', true)).toBe('⌃⌥⌘[')
    expect(hotkeyLabel('[', false)).toBe('Ctrl+Alt+Shift+[')
  })

  it('gives every action its own key', () => {
    const keys = HOTKEYS.map((hotkey) => hotkey.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(new Set(HOTKEYS.map((hotkey) => hotkey.action)).size).toBe(HOTKEYS.length)
  })

  it('stays off the keys window managers and macOS already use', () => {
    const keys = HOTKEYS.map((hotkey) => hotkey.key)
    for (const reserved of ['Left', 'Right', 'Up', 'Down', ',', '.', '8']) {
      expect(keys).not.toContain(reserved)
    }
  })
})

describe('createHotkeyService', () => {
  it('registers every hotkey when on and runs its action', () => {
    const registrar = fakeRegistrar()
    const actions = fakeActions()
    const service = createHotkeyService({
      settings: fakeSettings(true),
      registrar,
      mac: true,
      actions
    })
    expect(registrar.live.size).toBe(HOTKEYS.length)
    expect(service.get().enabled).toBe(true)
    expect(service.get().hotkeys.every((hotkey) => hotkey.registered)).toBe(true)

    registrar.press('Control+Alt+Command+T')
    expect(actions.toggleTimer).toHaveBeenCalledTimes(1)
    expect(actions.playPause).not.toHaveBeenCalled()
  })

  it('registers nothing while off', () => {
    const registrar = fakeRegistrar()
    const service = createHotkeyService({
      settings: fakeSettings(false),
      registrar,
      mac: true,
      actions: fakeActions()
    })
    expect(registrar.live.size).toBe(0)
    expect(service.get().enabled).toBe(false)
    expect(service.get().hotkeys.some((hotkey) => hotkey.registered)).toBe(false)
  })

  it('marks keys another app already has, and keeps the rest', () => {
    const registrar = fakeRegistrar(['Control+Alt+Shift+F'])
    const service = createHotkeyService({
      settings: fakeSettings(true),
      registrar,
      mac: false,
      actions: fakeActions()
    })
    const toggle = service.get().hotkeys.find((hotkey) => hotkey.action === 'toggleFocusScreen')
    expect(toggle).toMatchObject({ keys: 'Ctrl+Alt+Shift+F', registered: false })
    expect(registrar.live.size).toBe(HOTKEYS.length - 1)
    expect(service.acceleratorFor('toggleFocusScreen')).toBeNull()
    expect(service.acceleratorFor('playPause')).toBe('Control+Alt+Shift+P')
  })

  it('treats a register that throws as not registered', () => {
    const registrar = fakeRegistrar()
    const register = registrar.register.bind(registrar)
    registrar.register = (accelerator, run) => {
      if (accelerator.endsWith('+[')) throw new Error('conversion failure')
      return register(accelerator, run)
    }
    const service = createHotkeyService({
      settings: fakeSettings(true),
      registrar,
      mac: true,
      actions: fakeActions()
    })
    const earlier = service.get().hotkeys.find((hotkey) => hotkey.action === 'lyricsEarlier')
    expect(earlier?.registered).toBe(false)
  })

  it('lets go of the keys when turned off, and takes them again when turned on', () => {
    const settings = fakeSettings(true)
    const registrar = fakeRegistrar()
    const service = createHotkeyService({
      settings,
      registrar,
      mac: true,
      actions: fakeActions()
    })
    const seen: boolean[] = []
    service.subscribe((state) => seen.push(state.enabled))

    settings.setEnabled(false)
    expect(registrar.live.size).toBe(0)
    settings.setEnabled(true)
    expect(registrar.live.size).toBe(HOTKEYS.length)
    expect(seen).toEqual([false, true])
  })

  it('ignores settings changes that leave hotkeys as they were', () => {
    const settings = fakeSettings(true)
    const registrar = fakeRegistrar()
    const service = createHotkeyService({
      settings,
      registrar,
      mac: true,
      actions: fakeActions()
    })
    const listener = vi.fn()
    service.subscribe(listener)
    settings.setEnabled(true)
    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps a failing action from escaping into the main process', () => {
    const registrar = fakeRegistrar()
    const actions = fakeActions()
    actions.nextTrack.mockImplementation(() => {
      throw new Error('player gone')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    createHotkeyService({ settings: fakeSettings(true), registrar, mac: true, actions })
    expect(() => registrar.press('Control+Alt+Command+N')).not.toThrow()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('unregisters everything on dispose', () => {
    const registrar = fakeRegistrar()
    const service = createHotkeyService({
      settings: fakeSettings(true),
      registrar,
      mac: true,
      actions: fakeActions()
    })
    service.dispose()
    expect(registrar.live.size).toBe(0)
  })
})
