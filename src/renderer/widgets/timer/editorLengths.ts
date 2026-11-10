import type { TimerLength } from '../../../main/ipc'

export type Lengths = Record<TimerLength, number>

const LENGTHS: readonly TimerLength[] = ['focus', 'break', 'countdown']

/**
 * The open wheels' lengths after the settings changed (`seen` → `incoming`): a length set
 * elsewhere while they're open (Customize, a menu) shows on them, unless the wheels' own turn of
 * it is still waiting to be saved. The wheels' own saves come back as no change. Returns `shown`
 * itself when nothing changes.
 */
export function adoptOutside(
  shown: Lengths,
  seen: Lengths,
  incoming: Lengths,
  pending: readonly TimerLength[]
): Lengths {
  let next = shown
  for (const length of LENGTHS) {
    const changed = incoming[length] !== seen[length]
    if (changed && !pending.includes(length) && incoming[length] !== shown[length]) {
      next = { ...next, [length]: incoming[length] }
    }
  }
  return next
}
