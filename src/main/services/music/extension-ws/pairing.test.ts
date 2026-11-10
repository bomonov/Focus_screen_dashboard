import { describe, expect, it } from 'vitest'
import { createPairingCodes, PAIRING_CODE_TTL_SEC, PAIRING_MAX_ATTEMPTS } from './pairing'

const T0 = 1_800_000_000

describe('pairing codes', () => {
  it('makes six-digit codes, zero-padded', () => {
    expect(createPairingCodes(() => 42).create(T0)).toBe('000042')
    expect(createPairingCodes(() => 999_999).create(T0)).toBe('999999')
  })

  it('accepts the right code once', () => {
    const codes = createPairingCodes(() => 123_456)
    const code = codes.create(T0)
    expect(codes.redeem(code, T0 + 10)).toBe(true)
    expect(codes.redeem(code, T0 + 11)).toBe(false)
  })

  it('expires', () => {
    const codes = createPairingCodes(() => 123_456)
    const code = codes.create(T0)
    expect(codes.redeem(code, T0 + PAIRING_CODE_TTL_SEC + 1)).toBe(false)
  })

  it('gives up after too many wrong tries', () => {
    const codes = createPairingCodes(() => 123_456)
    const code = codes.create(T0)
    for (let i = 0; i < PAIRING_MAX_ATTEMPTS; i++) expect(codes.redeem('000000', T0)).toBe(false)
    expect(codes.redeem(code, T0)).toBe(false)
  })

  it('replaces the old code with a new one', () => {
    let next = 111_111
    const codes = createPairingCodes(() => next)
    const first = codes.create(T0)
    next = 222_222
    const second = codes.create(T0)
    expect(codes.redeem(first, T0)).toBe(false)
    expect(codes.redeem(second, T0)).toBe(true)
  })

  it('refuses everything before a code was made', () => {
    expect(createPairingCodes().redeem('123456', T0)).toBe(false)
  })
})
