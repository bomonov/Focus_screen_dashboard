// The school picked for Next class's map, its map's state, and a school the calendars point to.
import type { SchoolMaps } from './schoolMap'
import { isAsu, loadCatalog, sameSchool, schoolForEmails, searchSchools } from './schools'
import type { School, SchoolState } from './types'

export interface SchoolStatus {
  get(): SchoolState
  subscribe(listener: (state: SchoolState) => void): () => void
  /** Works the suggestion out again from the calendars' email addresses (on this Mac). */
  suggest(): void
  /** Schools in the bundled list whose name matches what was typed. */
  search(query: string): Promise<School[]>
  /** The picked school (or the suggestion) changed: tell the windows. */
  refresh(): void
  dispose(): void
}

export interface SchoolStatusOptions {
  school(): School
  schoolMaps: SchoolMaps
  /** Email addresses the calendar accounts carry ("someone@asu.edu"); never sent anywhere. */
  emails(): string[]
}

const MAX_QUERY = 100

export function createSchoolStatus(options: SchoolStatusOptions): SchoolStatus {
  const { schoolMaps } = options
  const listeners = new Set<(state: SchoolState) => void>()
  let suggestion: School | null = null
  let emailsKey = ''

  function compute(): SchoolState {
    const school = options.school()
    const official = isAsu(school)
    const map = official ? null : schoolMaps.read(school)
    return {
      school,
      source: official ? 'official' : 'openstreetmap',
      map: map ? { buildings: map.buildings.length, downloadedAt: map.downloadedAt } : null,
      downloading: !official && schoolMaps.downloading(school),
      problem: official ? null : schoolMaps.problem(school),
      suggestion: suggestion && !sameSchool(suggestion, school) ? suggestion : null
    }
  }

  let state = compute()
  function refresh(): void {
    const next = compute()
    if (JSON.stringify(next) === JSON.stringify(state)) return
    state = next
    for (const listener of listeners) listener(state)
  }

  const unsubscribe = schoolMaps.subscribe(refresh)

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    suggest() {
      const emails = options.emails()
      const key = emails.join('\n')
      if (key === emailsKey) return
      emailsKey = key
      void loadCatalog()
        .then((catalog) => {
          suggestion = schoolForEmails(catalog, emails)
          refresh()
        })
        .catch((error: unknown) =>
          console.warn('[calendar] Could not read the school list.', error)
        )
    },
    async search(query) {
      return searchSchools(await loadCatalog(), query.slice(0, MAX_QUERY))
    },
    refresh,
    dispose() {
      unsubscribe()
      listeners.clear()
    }
  }
}
