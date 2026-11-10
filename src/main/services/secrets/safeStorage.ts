import { safeStorage } from 'electron'
import type { Encryptor } from './store'

/** Electron's safeStorage: macOS Keychain, Windows DPAPI. Only usable after app ready. */
export const safeStorageEncryptor: Encryptor = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (cipher) => safeStorage.decryptString(cipher)
}
