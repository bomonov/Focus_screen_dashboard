import type { TransitCommand } from './types'

/** Customize's stop-list buttons; from the renderer, so only the exact known shapes pass. */
export function parseTransitCommand(raw: unknown): TransitCommand | null {
  if (typeof raw !== 'object' || raw === null) return null
  const kind = (raw as Record<string, unknown>).kind
  return kind === 'download' || kind === 'remove' || kind === 'retry' ? { kind } : null
}
