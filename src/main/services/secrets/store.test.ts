import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openSecretStore, type Encryptor } from './store'

/** Reversible, and obviously not plain text, so the tests can tell sealed from unsealed. */
const fakeEncryptor: Encryptor = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(`sealed:${[...plain].reverse().join('')}`),
  decrypt: (cipher) => {
    const text = cipher.toString()
    if (!text.startsWith('sealed:')) throw new Error('not ours')
    return [...text.slice('sealed:'.length)].reverse().join('')
  }
}

let dir = ''
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ''
})

function tempFile(): string {
  dir = mkdtempSync(join(tmpdir(), 'focus-secrets-'))
  return join(dir, 'secrets.json')
}

describe('secret store', () => {
  it('keeps values sealed on disk and reads them back', () => {
    const file = tempFile()
    openSecretStore(file, fakeEncryptor).set('extension.chrome', 'token-123')
    expect(readFileSync(file, 'utf8')).not.toContain('token-123')
    expect(openSecretStore(file, fakeEncryptor).get('extension.chrome')).toBe('token-123')
  })

  it('deletes values', () => {
    const file = tempFile()
    const store = openSecretStore(file, fakeEncryptor)
    store.set('extension.safari', 'abc')
    store.delete('extension.safari')
    expect(openSecretStore(file, fakeEncryptor).get('extension.safari')).toBeNull()
  })

  it('never writes a file when the OS can’t encrypt, but still works for this run', () => {
    const file = tempFile()
    const store = openSecretStore(file, { ...fakeEncryptor, isAvailable: () => false })
    store.set('extension.chrome', 'in-memory')
    expect(store.get('extension.chrome')).toBe('in-memory')
    expect(() => readFileSync(file)).toThrow()
  })

  it('skips values it can’t unseal and files it can’t read', () => {
    const file = tempFile()
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        entries: { 'extension.chrome': Buffer.from('x').toString('base64') }
      })
    )
    expect(openSecretStore(file, fakeEncryptor).get('extension.chrome')).toBeNull()
    writeFileSync(file, 'not json')
    expect(openSecretStore(file, fakeEncryptor).get('extension.chrome')).toBeNull()
  })

  it('keeps values it can’t unseal when it saves others', () => {
    const file = tempFile()
    const foreign = Buffer.from('sealed-by-another-app').toString('base64')
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        entries: { 'google.refreshToken': foreign, 'extension.chrome': foreign }
      })
    )
    const store = openSecretStore(file, fakeEncryptor)
    store.set('extension.safari', 'new-pairing')
    // Pairing again replaces an unreadable value; deleting one removes it for good.
    store.set('extension.chrome', 'fresh')
    expect(JSON.parse(readFileSync(file, 'utf8')).entries['google.refreshToken']).toBe(foreign)
    store.delete('google.refreshToken')

    const reopened = openSecretStore(file, fakeEncryptor)
    expect(reopened.get('extension.safari')).toBe('new-pairing')
    expect(reopened.get('extension.chrome')).toBe('fresh')
    expect(JSON.parse(readFileSync(file, 'utf8')).entries['google.refreshToken']).toBeUndefined()
  })

  it('keeps the file as it was when the OS refuses to encrypt', () => {
    const file = tempFile()
    const store = openSecretStore(file, fakeEncryptor)
    store.set('extension.chrome', 'kept')
    const refusing = openSecretStore(file, {
      ...fakeEncryptor,
      encrypt: () => {
        throw new Error('Keychain access denied')
      }
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => refusing.set('extension.safari', 'lost')).not.toThrow()
    warn.mockRestore()
    expect(openSecretStore(file, fakeEncryptor).get('extension.chrome')).toBe('kept')
  })
})
