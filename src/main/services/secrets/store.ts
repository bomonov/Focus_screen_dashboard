import { readFileSync } from 'fs'
import { writeJsonFile } from '../jsonFile'

/** Every secret the app keeps. Add new ones here so they're easy to audit. */
export type SecretKey =
  | 'extension.chrome'
  | 'extension.safari'
  /** The user's own Google OAuth client (id + secret, as JSON). */
  | 'google.oauthClient'
  | 'google.refreshToken'
  /** Google Calendar's own sign-in (read-only), apart from Tasks', and the client it was made with. */
  | 'google.calendarRefreshToken'
  | 'google.calendarClientId'
  /** The Canvas site (an https origin), kept with the token so they never disagree. */
  | 'canvas.site'
  /** A Canvas personal access token. */
  | 'canvas.token'
  /** A Canvas calendar feed link; it has its own secret in the path. */
  | 'canvas.feedUrl'

/** The OS keychain-backed cipher (Electron safeStorage in the app, a fake in tests). */
export interface Encryptor {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(cipher: Buffer): string
}

export interface SecretStore {
  get(key: SecretKey): string | null
  set(key: SecretKey, value: string): void
  delete(key: SecretKey): void
}

const KEYS: readonly SecretKey[] = [
  'extension.chrome',
  'extension.safari',
  'google.oauthClient',
  'google.refreshToken',
  'google.calendarRefreshToken',
  'google.calendarClientId',
  'canvas.site',
  'canvas.token',
  'canvas.feedUrl'
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The only place tokens are read or written. On disk they're encrypted by the OS (Keychain
 * on macOS, DPAPI on Windows); values never go to settings, logs or the console. Without
 * encryption, secrets live in memory for this run only, so they're never stored in plain text.
 */
export function openSecretStore(filePath: string, encryptor: Encryptor): SecretStore {
  const values = new Map<SecretKey, string>()
  /**
   * Entries this run couldn't unseal, kept as they are on disk. A new copy of the app (a
   * packaged build after dev) has to be allowed into the Keychain first; if that's refused, the
   * next save would otherwise throw away every sign-in it couldn't read.
   */
  const unreadable = new Map<SecretKey, string>()
  const persistent = encryptor.isAvailable()
  if (persistent) load()
  else console.warn('[secrets] OS encryption unavailable; secrets last until the app quits.')

  function load(): void {
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(filePath, 'utf8'))
    } catch {
      return
    }
    if (!isRecord(raw) || !isRecord(raw.entries)) return
    for (const key of KEYS) {
      const sealed = raw.entries[key]
      if (typeof sealed !== 'string') continue
      try {
        values.set(key, encryptor.decrypt(Buffer.from(sealed, 'base64')))
      } catch {
        // Unusable this run, so act as if it isn't there, but keep it for a run that can read it.
        unreadable.set(key, sealed)
      }
    }
  }

  function save(): void {
    if (!persistent) return
    const entries: Record<string, string> = Object.fromEntries(unreadable)
    try {
      for (const [key, value] of values) entries[key] = encryptor.encrypt(value).toString('base64')
      writeJsonFile(filePath, { version: 1, entries })
    } catch (error) {
      console.warn('[secrets] Could not save the secrets file.', error)
    }
  }

  return {
    get: (key) => values.get(key) ?? null,
    set(key, value) {
      values.set(key, value)
      unreadable.delete(key)
      save()
    },
    delete(key) {
      const had = values.delete(key)
      if (unreadable.delete(key) || had) save()
    }
  }
}
