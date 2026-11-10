/** A press this soon after a click is the second of a double press. */
export const DOUBLE_MS = 400

/** A second card a pill can open from a double press, as `useHoldToOpen` takes it. */
export interface DoublePress {
  disabled: boolean
  /**
   * The second press opens it at once, a plain double-click (the class list); otherwise only
   * once that press is held (the Bus list).
   */
  atOnce?: boolean
}

/**
 * What a press down on a pill starts, `sinceClick` ms after the last quick click on it let go:
 * a hold for its card, its second card at once or once held, or nothing. `holdDisabled` when
 * the pill has no card to hold for just now.
 */
export function pressStart(
  sinceClick: number,
  holdDisabled: boolean,
  double: DoublePress | undefined
): 'hold' | 'double' | 'double-held' | 'none' {
  if (sinceClick < DOUBLE_MS && double && !double.disabled) {
    return double.atOnce ? 'double' : 'double-held'
  }
  return holdDisabled ? 'none' : 'hold'
}
