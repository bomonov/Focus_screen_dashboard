import { randomInt } from 'crypto'

/** Long enough to walk to the browser and type it, short enough not to linger. */
export const PAIRING_CODE_TTL_SEC = 300
/** Six digits can't be guessed in five tries (1 in 200,000). */
export const PAIRING_MAX_ATTEMPTS = 5

export interface PairingCodes {
  /** A fresh six-digit code; any earlier one stops working. */
  create(now: number): string
  /** True once for the right code before it expires; wrong tries count against it. */
  redeem(code: string, now: number): boolean
}

export function createPairingCodes(random: (max: number) => number = randomInt): PairingCodes {
  let current: { code: string; expiresAt: number; attemptsLeft: number } | null = null

  return {
    create(now) {
      const code = String(random(1_000_000)).padStart(6, '0')
      current = { code, expiresAt: now + PAIRING_CODE_TTL_SEC, attemptsLeft: PAIRING_MAX_ATTEMPTS }
      return code
    },
    redeem(code, now) {
      if (!current || now > current.expiresAt) {
        current = null
        return false
      }
      if (code === current.code) {
        current = null
        return true
      }
      current.attemptsLeft -= 1
      if (current.attemptsLeft <= 0) current = null
      return false
    }
  }
}
