import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openSettingsStore, type SettingsStore } from '../settings/store'
import { createTimerService, type TimerService } from './service'
import type { TimerState } from './types'

const T0_MS = 1_800_000_000_000

let dir: string
let timerFile: string
let settings: SettingsStore
const services: TimerService[] = []

function open(): TimerService {
  const service = createTimerService({ filePath: timerFile, settings })
  services.push(service)
  return service
}

function saved(): TimerState {
  return JSON.parse(readFileSync(timerFile, 'utf8')) as TimerState
}

beforeEach(() => {
  // Fake timers also fake Date, so the service's clock moves with advanceTimersByTime.
  vi.useFakeTimers({ now: T0_MS })
  dir = mkdtempSync(join(tmpdir(), 'focus-screen-timer-'))
  timerFile = join(dir, 'timer.json')
  settings = openSettingsStore(join(dir, 'settings.json'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  for (const service of services.splice(0)) service.dispose()
  vi.useRealTimers()
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

describe('createTimerService', () => {
  it('starts with a fresh Pomodoro and saves it', () => {
    const timer = open()
    expect(timer.get()).toMatchObject({ mode: 'pomodoro', status: 'idle', durationSec: 1500 })
    expect(saved()).toEqual(timer.get())
  })

  it('finishes a countdown on time, saves it, and chimes once', () => {
    const timer = open()
    const chime = vi.fn()
    timer.onChime(chime)
    timer.command({ kind: 'selectMode', mode: 'countdown' })
    timer.command({ kind: 'start' })

    vi.advanceTimersByTime(599_000)
    expect(timer.get().status).toBe('running')
    expect(chime).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1_100)
    expect(timer.get().status).toBe('finished')
    expect(saved().status).toBe('finished')
    expect(chime).toHaveBeenCalledTimes(1)
    expect(chime).toHaveBeenCalledWith({ mode: 'countdown', phase: 'focus' })

    vi.advanceTimersByTime(60_000)
    expect(chime).toHaveBeenCalledTimes(1)
  })

  it('stays quiet when the chime is off', () => {
    settings.update((s) => ({ ...s, timer: { ...s.timer, chime: false } }))
    const timer = open()
    const chime = vi.fn()
    timer.onChime(chime)
    timer.command({ kind: 'selectMode', mode: 'countdown' })
    timer.command({ kind: 'start' })
    vi.advanceTimersByTime(601_000)
    expect(timer.get().status).toBe('finished')
    expect(chime).not.toHaveBeenCalled()
  })

  it('pushes each change to subscribers', () => {
    const timer = open()
    const listener = vi.fn()
    timer.subscribe(listener)
    timer.command({ kind: 'start' })
    timer.command({ kind: 'start' }) // already running: no change, no push
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'running' }))
  })

  it('keeps counting across a restart', () => {
    const first = open()
    first.command({ kind: 'start' })
    first.dispose()

    vi.setSystemTime(T0_MS + 120_000)
    const second = open()
    expect(second.get()).toMatchObject({ status: 'running', runningSince: T0_MS / 1000 })
  })

  it('applies a run that ended while the app was closed, without a chime', () => {
    const first = open()
    first.command({ kind: 'selectMode', mode: 'countdown' })
    first.command({ kind: 'start' })
    first.dispose()

    vi.setSystemTime(T0_MS + 3_600_000)
    const second = open()
    const chime = vi.fn()
    second.onChime(chime)
    expect(second.get().status).toBe('finished')
    expect(saved().status).toBe('finished')
    vi.advanceTimersByTime(5_000)
    expect(chime).not.toHaveBeenCalled()
  })

  it('starts fresh when timer.json is not JSON', () => {
    writeFileSync(timerFile, '{ nope')
    expect(open().get()).toMatchObject({ mode: 'pomodoro', status: 'idle' })
  })

  it('gives an idle timer new lengths from settings', () => {
    const timer = open()
    const listener = vi.fn()
    timer.subscribe(listener)
    settings.update((s) => ({ ...s, timer: { ...s.timer, focusSec: 2705 } }))
    expect(timer.get().durationSec).toBe(2705)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('ignores settings that have nothing to do with timer lengths', () => {
    const timer = open()
    timer.command({ kind: 'addFiveMinutes' })
    const listener = vi.fn()
    timer.subscribe(listener)
    settings.update((s) => ({ ...s, theme: { ...s.theme, accent: '#8C1D40' } }))
    settings.update((s) => ({ ...s, timer: { ...s.timer, style: 'flip' } }))
    expect(listener).not.toHaveBeenCalled()
    expect(timer.get().durationSec).toBe(1800)
  })
})
