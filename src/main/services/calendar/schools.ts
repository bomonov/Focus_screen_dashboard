// Which school a student is at, for Next class's map: from a list of universities bundled with
// the app (Hipo's university-domains-list, MIT), searched on this Mac. Nothing here goes out.

import type { School } from './types'

export type { School }

interface SchoolEntry extends School {
  /** Its email domains: "asu.edu". */
  domains: string[]
}

/** ASU has its own building list, with every building's code (campus.ts); others use OpenStreetMap. */
export const ASU: School = { name: 'Arizona State University', country: 'US' }

export function sameSchool(a: School | null, b: School | null): boolean {
  return a !== null && b !== null && a.name === b.name && a.country === b.country
}

export const isAsu = (school: School | null): boolean => sameSchool(school, ASU)

const MAX_NAME = 200

/** A school as settings or the renderer give it; null when it isn't one. */
export function parseSchool(raw: unknown): School | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { name, country } = raw as Record<string, unknown>
  if (typeof name !== 'string' || typeof country !== 'string') return null
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > MAX_NAME || !/^[A-Z]{2}$/.test(country)) return null
  return { name: trimmed, country }
}

/** The bundled list, read through the same checks as anything else. */
export function parseCatalog(raw: unknown): SchoolEntry[] {
  const rows =
    typeof raw === 'object' &&
    raw !== null &&
    Array.isArray((raw as Record<string, unknown>).schools)
      ? ((raw as Record<string, unknown>).schools as unknown[])
      : []
  const entries: SchoolEntry[] = []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    const [name, country, domains] = row as unknown[]
    const school = parseSchool({ name, country })
    if (!school) continue
    entries.push({
      ...school,
      domains: Array.isArray(domains)
        ? domains.filter((domain): domain is string => typeof domain === 'string')
        : []
    })
  }
  return entries
}

let catalog: Promise<SchoolEntry[]> | null = null

/** The list, loaded the first time it's needed (it's half a megabyte). */
export function loadCatalog(): Promise<SchoolEntry[]> {
  catalog ??= import('./schools.json').then((module) => parseCatalog(module.default))
  return catalog
}

/** Lower case, accents and punctuation gone, one space between words. */
function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const SEARCH_RESULTS = 12

/**
 * Schools whose name holds every word typed, best first: the whole name, the start of it, its
 * email name ("asu"), its initials, then the start of a word in it; "asu" or "state arizona"
 * find Arizona State University.
 */
export function searchSchools(
  entries: readonly SchoolEntry[],
  query: string,
  limit = SEARCH_RESULTS
): School[] {
  const words = fold(query).split(' ').filter(Boolean)
  if (words.length === 0) return []
  const typed = words.join(' ')
  const ranked: { school: School; rank: number }[] = []
  for (const entry of entries) {
    const name = fold(entry.name)
    const nameWords = name.split(' ')
    const initials = nameWords.map((word) => word.charAt(0)).join('')
    const byWords = words.every((word) => nameWords.some((part) => part.startsWith(word)))
    const byInitials = words.length === 1 && initials === typed
    const byDomain = entry.domains.some((domain) => domain.split('.')[0] === typed)
    if (!byWords && !byInitials && !byDomain) continue
    // Its email name ("asu", "purdue") says the most after the name itself; initials, which
    // many schools share, the least.
    const starts = name.startsWith(typed)
    const order = [name === typed, starts && byDomain, starts, byDomain, byInitials]
    const rank = order.indexOf(true) === -1 ? order.length : order.indexOf(true)
    ranked.push({ school: { name: entry.name, country: entry.country }, rank })
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || a.school.name.localeCompare(b.school.name))
    .slice(0, limit)
    .map(({ school }) => school)
}

/**
 * The school an email address belongs to ("someone@asu.edu", or a department's
 * "x@engineering.asu.edu"), from the list's domains; null when none or more than one.
 */
export function schoolForEmails(
  entries: readonly SchoolEntry[],
  emails: readonly string[]
): School | null {
  const found = new Map<string, School>()
  for (const email of emails) {
    const host = /@([a-z0-9.-]+)$/i.exec(email.trim())?.[1]?.toLowerCase()
    if (!host) continue
    for (const entry of entries) {
      if (entry.domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
        found.set(`${entry.name}|${entry.country}`, { name: entry.name, country: entry.country })
      }
    }
  }
  return found.size === 1 ? ([...found.values()][0] ?? null) : null
}
