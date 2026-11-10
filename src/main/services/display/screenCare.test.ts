import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings, type DisplaySettings, type Settings } from '../settings/schema'
import {
  BURN_IN_STEP_SEC,
  createScreenCare,
  dimAt,
  shiftAt,
  type ScreenCareService
} from './screenCare'

const MIN_MS = 60_000

function fakeSettings(display: Partial<DisplaySettings> = {}): {
  get(): Settings
  subscribe(listener: (settings: Settings) => void): () => void
  set(display: Partial<DisplaySettings>): void
} {
  let current: Settings = { ...defaultSettings() }
  current = { ...current, display: { ...current.display, ...display } }
  const listeners = new Set<(settings: Settings) => void>()
  return {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(change) {
      current = { ...current, display: { ...current.display, ...change } }
      for (const listener of listeners) listener(current)
    }
  }
}

describe('shiftAt', () => {
  it('starts centered and stays within 4 px', () => {
    expect(shiftAt(0)).toEqual({ x: 0, y: 0 })
    for (let step = 0; step < 20; step++) {
      const { x, y } = shiftAt(step)
      expect(Math.abs(x)).toBeLessThanOrEqual(4)
      expect(Math.abs(y)).toBeLessThanOrEqual(4)
    }
  })

  it('loops back around', () => {
    expect(shiftAt(8)).toEqual(shiftAt(0))
    expect(shiftAt(-1)).toEqual(shiftAt(7))
  })
})

describe('dimAt', () => {
  it('is the last activity plus the idle minutes', () => {
    expect(dimAt(false, 1000, 5)).toBe(1300)
  })

  it('never dims while busy or when dimming is off', () => {
    expect(dimAt(true, 1000, 5)).toBeNull()
    expect(dimAt(false, 1000, 0)).toBeNull()
  })
})

describe('createScreenCare', () => {
  let care: ScreenCareService | null = null

  beforeEach(() => {
    vi.useFakeTimers({ now: 1_800_000_000_000 })
  })

  afterEach(() => {
    care?.dispose()
    care = null
    vi.useRealTimers()
  })

  it('dims after the idle minutes with nothing going on', () => {
    care = createScreenCare({ settings: fakeSettings({ idleDimMinutes: 5, burnInShift: false }) })
    const listener = vi.fn()
    care.subscribe(listener)
    vi.advanceTimersByTime(5 * MIN_MS - 1000)
    expect(care.get().dimmed).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(care.get().dimmed).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('stays awake while music plays and counts from when it stops', () => {
    care = createScreenCare({ settings: fakeSettings({ idleDimMinutes: 5 }) })
    care.setBusy('music', true)
    vi.advanceTimersByTime(30 * MIN_MS)
    expect(care.get().dimmed).toBe(false)
    care.setBusy('music', false)
    vi.advanceTimersByTime(4 * MIN_MS)
    expect(care.get().dimmed).toBe(false)
    vi.advanceTimersByTime(MIN_MS)
    expect(care.get().dimmed).toBe(true)
  })

  it('stays awake while the Color-Code Lyrics window is open, like Customize', () => {
    care = createScreenCare({ settings: fakeSettings({ idleDimMinutes: 5 }) })
    care.setBusy('lyricsEditor', true)
    vi.advanceTimersByTime(30 * MIN_MS)
    expect(care.get().dimmed).toBe(false)
    care.setBusy('lyricsEditor', false)
    vi.advanceTimersByTime(5 * MIN_MS)
    expect(care.get().dimmed).toBe(true)
  })

  it('needs every reason to end before the wait starts', () => {
    care = createScreenCare({ settings: fakeSettings({ idleDimMinutes: 5 }) })
    care.setBusy('music', true)
    care.setBusy('timer', true)
    care.setBusy('music', false)
    vi.advanceTimersByTime(10 * MIN_MS)
    expect(care.get().dimmed).toBe(false)
  })

  it('wakes up at once on activity or when music starts', () => {
    care = createScreenCare({ settings: fakeSettings({ idleDimMinutes: 5 }) })
    vi.advanceTimersByTime(5 * MIN_MS)
    expect(care.get().dimmed).toBe(true)
    care.activity()
    expect(care.get().dimmed).toBe(false)
    vi.advanceTimersByTime(5 * MIN_MS)
    expect(care.get().dimmed).toBe(true)
    care.setBusy('music', true)
    expect(care.get().dimmed).toBe(false)
  })

  it('follows idle setting changes, including Never', () => {
    const settings = fakeSettings({ idleDimMinutes: 15 })
    care = createScreenCare({ settings })
    vi.advanceTimersByTime(6 * MIN_MS)
    expect(care.get().dimmed).toBe(false)
    settings.set({ idleDimMinutes: 5 })
    expect(care.get().dimmed).toBe(true)
    settings.set({ idleDimMinutes: 0 })
    expect(care.get().dimmed).toBe(false)
    vi.advanceTimersByTime(60 * MIN_MS)
    expect(care.get().dimmed).toBe(false)
  })

  it('moves the layout every few minutes while burn-in protection is on', () => {
    const settings = fakeSettings({ burnInShift: true, idleDimMinutes: 0 })
    care = createScreenCare({ settings })
    expect(care.get().shift).toEqual(shiftAt(0))
    vi.advanceTimersByTime(BURN_IN_STEP_SEC * 1000)
    expect(care.get().shift).toEqual(shiftAt(1))
    vi.advanceTimersByTime(BURN_IN_STEP_SEC * 1000)
    expect(care.get().shift).toEqual(shiftAt(2))
    settings.set({ burnInShift: false })
    expect(care.get().shift).toEqual({ x: 0, y: 0 })
    vi.advanceTimersByTime(BURN_IN_STEP_SEC * 3000)
    expect(care.get().shift).toEqual({ x: 0, y: 0 })
  })
})
