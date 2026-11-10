import type { CalendarCommand, SchoolCommand } from './types'

/** Commands come from the renderer, so they're untrusted: only the exact known shapes pass. */
export function parseCalendarCommand(raw: unknown): CalendarCommand | null {
  if (typeof raw !== 'object' || raw === null) return null
  switch ((raw as Record<string, unknown>).kind) {
    case 'openPrivacySettings':
      return { kind: 'openPrivacySettings' }
    case 'connectGoogle':
      return { kind: 'connectGoogle' }
    case 'disconnectGoogle':
      return { kind: 'disconnectGoogle' }
    default:
      return null
  }
}

/** Customize's school buttons, as untrusted as any other command. */
export function parseSchoolCommand(raw: unknown): SchoolCommand | null {
  if (typeof raw !== 'object' || raw === null) return null
  const kind = (raw as Record<string, unknown>).kind
  return kind === 'download' || kind === 'remove' ? { kind } : null
}
