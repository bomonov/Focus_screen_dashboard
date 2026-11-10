import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from './schema'
import { openSettingsStore } from './store'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'focus-screen-settings-'))
  file = join(dir, 'settings.json')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function readFile(): unknown {
  return JSON.parse(readFileSync(file, 'utf8'))
}

describe('openSettingsStore', () => {
  it('creates the file with defaults on first run', () => {
    const store = openSettingsStore(file)
    expect(store.get()).toEqual(defaultSettings())
    expect(readFile()).toEqual(defaultSettings())
  })

  it('creates missing parent folders', () => {
    file = join(dir, 'nested', 'deeper', 'settings.json')
    openSettingsStore(file)
    expect(readFile()).toEqual(defaultSettings())
  })

  it('loads saved values', () => {
    const defaults = defaultSettings()
    const saved = { ...defaults, display: { ...defaults.display, showOn: { kind: 'floating' } } }
    writeFileSync(file, JSON.stringify(saved))
    expect(openSettingsStore(file).get()).toEqual(saved)
  })

  it('backs up a corrupt file and starts from defaults', () => {
    writeFileSync(file, '{ not json')
    const store = openSettingsStore(file)
    expect(store.get()).toEqual(defaultSettings())
    expect(readFile()).toEqual(defaultSettings())
    const backups = readdirSync(dir).filter((name) => name.startsWith('settings.corrupt-'))
    expect(backups).toHaveLength(1)
    expect(readFileSync(join(dir, backups[0]!), 'utf8')).toBe('{ not json')
  })

  it('repairs invalid fields on disk', () => {
    writeFileSync(file, JSON.stringify({ theme: { accent: 'nope' } }))
    openSettingsStore(file)
    expect(readFile()).toEqual(defaultSettings())
  })

  it('saves updates and notifies subscribers', () => {
    const store = openSettingsStore(file)
    const listener = vi.fn()
    store.subscribe(listener)

    store.update((s) => ({ ...s, display: { ...s.display, showOn: { kind: 'floating' } } }))

    expect(store.get().display.showOn).toEqual({ kind: 'floating' })
    expect(readFile()).toMatchObject({ display: { showOn: { kind: 'floating' } } })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('ignores updates that change nothing', () => {
    const store = openSettingsStore(file)
    const listener = vi.fn()
    store.subscribe(listener)
    store.update((s) => ({ ...s }))
    expect(listener).not.toHaveBeenCalled()
  })

  it('validates updates like file contents', () => {
    const store = openSettingsStore(file)
    store.update((s) => ({ ...s, theme: { ...s.theme, accent: 'red' } }))
    expect(store.get().theme.accent).toBe(defaultSettings().theme.accent)
  })

  it('stops notifying after unsubscribe', () => {
    const store = openSettingsStore(file)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    unsubscribe()
    store.update((s) => ({ ...s, display: { ...s.display, showOn: { kind: 'floating' } } }))
    expect(listener).not.toHaveBeenCalled()
  })
})
