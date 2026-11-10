import { describe, expect, it } from 'vitest'
import { defaultSettings, type KeepAwake, type Settings } from '../settings/schema'
import { createKeepAwake, shouldKeepAwake, type DisplaySleepBlocker } from './keepAwake'

function fakeSettings(keepAwake: KeepAwake): {
  get(): Settings
  subscribe(listener: (settings: Settings) => void): () => void
  set(keepAwake: KeepAwake): void
} {
  const base = defaultSettings()
  let current: Settings = { ...base, display: { ...base.display, keepAwake } }
  const listeners = new Set<(settings: Settings) => void>()
  return {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next) {
      current = { ...current, display: { ...current.display, keepAwake: next } }
      for (const listener of listeners) listener(current)
    }
  }
}

function fakeBlocker(): DisplaySleepBlocker & { active: Set<number>; started: number } {
  const active = new Set<number>()
  let next = 1
  return {
    active,
    get started() {
      return next - 1
    },
    start() {
      active.add(next)
      return next++
    },
    stop(id) {
      active.delete(id)
    }
  }
}

describe('shouldKeepAwake', () => {
  it('follows the setting while the Focus Screen is up', () => {
    expect(shouldKeepAwake('always', true, false)).toBe(true)
    expect(shouldKeepAwake('busy', true, true)).toBe(true)
    expect(shouldKeepAwake('busy', true, false)).toBe(false)
    expect(shouldKeepAwake('never', true, true)).toBe(false)
  })

  it('never keeps the screens awake for a hidden Focus Screen', () => {
    expect(shouldKeepAwake('always', false, true)).toBe(false)
  })
})

describe('createKeepAwake', () => {
  it('holds one block while music or the timer runs, and lets go when both stop', () => {
    const blocker = fakeBlocker()
    const keepAwake = createKeepAwake({ settings: fakeSettings('busy'), blocker })
    keepAwake.setShown(true)
    expect(keepAwake.isBlocking()).toBe(false)

    keepAwake.setBusy('music', true)
    keepAwake.setBusy('timer', true)
    expect(blocker.active.size).toBe(1)
    expect(blocker.started).toBe(1)

    keepAwake.setBusy('music', false)
    expect(keepAwake.isBlocking()).toBe(true)
    keepAwake.setBusy('timer', false)
    expect(blocker.active.size).toBe(0)
  })

  it('lets go while the Focus Screen is hidden', () => {
    const blocker = fakeBlocker()
    const keepAwake = createKeepAwake({ settings: fakeSettings('always'), blocker })
    keepAwake.setShown(true)
    expect(blocker.active.size).toBe(1)
    keepAwake.setShown(false)
    expect(blocker.active.size).toBe(0)
    keepAwake.setShown(true)
    expect(blocker.active.size).toBe(1)
  })

  it('follows a change of setting at once', () => {
    const settings = fakeSettings('always')
    const blocker = fakeBlocker()
    const keepAwake = createKeepAwake({ settings, blocker })
    keepAwake.setShown(true)
    settings.set('never')
    expect(blocker.active.size).toBe(0)
    settings.set('always')
    expect(keepAwake.isBlocking()).toBe(true)
  })

  it('releases its block on dispose', () => {
    const blocker = fakeBlocker()
    const keepAwake = createKeepAwake({ settings: fakeSettings('always'), blocker })
    keepAwake.setShown(true)
    keepAwake.dispose()
    expect(blocker.active.size).toBe(0)
  })
})
