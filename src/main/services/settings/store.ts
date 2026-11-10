import { readFileSync, renameSync } from 'fs'
import { writeJsonFile } from '../jsonFile'
import { defaultSettings, parseSettings, type Settings } from './schema'

export interface SettingsStore {
  get(): Settings
  /** Applies a change, saves it, and notifies subscribers. No-op changes are ignored. */
  update(change: (current: Settings) => Settings): Settings
  subscribe(listener: (settings: Settings) => void): () => void
}

export function openSettingsStore(filePath: string): SettingsStore {
  let current = load(filePath)
  const listeners = new Set<(settings: Settings) => void>()

  return {
    get: () => current,
    update(change) {
      const next = parseSettings(change(current))
      if (JSON.stringify(next) === JSON.stringify(current)) return current
      current = next
      save(filePath, current)
      for (const listener of listeners) listener(current)
      return current
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

function load(filePath: string): Settings {
  let text: string
  try {
    text = readFileSync(filePath, 'utf8')
  } catch (error) {
    const defaults = defaultSettings()
    if (isMissingFile(error)) {
      save(filePath, defaults)
    } else {
      console.warn(`[settings] Could not read ${filePath}; using defaults for this session.`, error)
    }
    return defaults
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    // Keep the broken file next to the new one so a hand-edit typo doesn't silently lose choices.
    backUpCorruptFile(filePath)
    raw = undefined
  }

  const settings = parseSettings(raw)
  // Rewrite whenever parsing dropped or repaired something, so the file on disk is always valid.
  if (JSON.stringify(raw) !== JSON.stringify(settings)) save(filePath, settings)
  return settings
}

function save(filePath: string, settings: Settings): void {
  try {
    writeJsonFile(filePath, settings)
  } catch (error) {
    console.warn(`[settings] Could not save ${filePath}.`, error)
  }
}

function backUpCorruptFile(filePath: string): void {
  const backupPath = filePath.replace(/\.json$/, '') + `.corrupt-${Date.now()}.json`
  try {
    renameSync(filePath, backupPath)
    console.warn(`[settings] ${filePath} was not valid JSON; moved it to ${backupPath}.`)
  } catch (error) {
    console.warn(`[settings] Could not back up corrupt ${filePath}.`, error)
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
