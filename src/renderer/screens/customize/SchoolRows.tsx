import { useEffect, useState } from 'react'
import type { School, SchoolState, SettingsPatch } from '../../../main/ipc'
import { useSchool } from '../../hooks/useSchool'

const day = (seconds: number): string =>
  new Date(seconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

function hint(state: SchoolState): string {
  if (state.source === 'official') return 'ASU’s own building list, every building’s code'
  if (state.downloading) return 'Downloading its map from OpenStreetMap… this can take a minute'
  if (state.map) {
    return `${state.map.buildings} buildings from OpenStreetMap · ${day(state.map.downloadedAt)}`
  }
  return 'No map yet'
}

/**
 * Next class's school: whose buildings the class map knows. ASU has its own list; any other
 * school's map comes from OpenStreetMap, downloaded only once the user says so here.
 */
export function SchoolRows({
  update
}: {
  update: (patch: SettingsPatch) => void
}): React.JSX.Element | null {
  const state = useSchool()
  const [picking, setPicking] = useState(false)
  if (!state) return null
  const pick = (school: School): void => {
    setPicking(false)
    update({ nextClass: { school } })
  }
  const send = (kind: 'download' | 'remove'): void => window.focusScreen.sendSchoolCommand({ kind })
  const osm = state.source === 'openstreetmap'

  return (
    <div className="customize__group">
      <span className="customize__group-label">School · for the class map</span>
      <div className="customize__row">
        <span className="customize__toggle-text">
          <span>{state.school.name}</span>
          <span className="customize__hint">{hint(state)}</span>
        </span>
        <button type="button" className="customize__button" onClick={() => setPicking(!picking)}>
          {picking ? 'Cancel' : 'Change…'}
        </button>
      </div>
      {picking && <SchoolSearch pick={pick} />}
      {!picking && state.suggestion && (
        <div className="customize__row">
          <span className="customize__toggle-text">
            <span>{state.suggestion.name}?</span>
            <span className="customize__hint">Your calendar’s email address is from there</span>
          </span>
          <button
            type="button"
            className="customize__button"
            onClick={() => state.suggestion && pick(state.suggestion)}
          >
            Use It
          </button>
        </div>
      )}
      {osm && !state.map && !state.downloading && (
        <div className="customize__row">
          <span className="customize__toggle-text">
            <span>Download its building map?</span>
            <span className="customize__hint">
              From OpenStreetMap, once. Only the school’s name goes there; classes are matched on
              this Mac.
            </span>
          </span>
          <button type="button" className="customize__button" onClick={() => send('download')}>
            Download
          </button>
        </div>
      )}
      {osm && state.map && !state.downloading && (
        <div className="customize__pills">
          <button type="button" className="customize__button" onClick={() => send('download')}>
            Update Map
          </button>
          <button type="button" className="customize__button" onClick={() => send('remove')}>
            Remove Map
          </button>
        </div>
      )}
      {state.problem && <p className="customize__note">{state.problem}</p>}
    </div>
  )
}

/** Type a school's name, its initials or its email name; the list is searched on this Mac. */
function SchoolSearch({ pick }: { pick: (school: School) => void }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<{ query: string; schools: School[] }>({
    query: '',
    schools: []
  })
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      window.focusScreen
        .searchSchools(query)
        .then((schools) => {
          if (live) setFound({ query, schools })
        })
        .catch(() => undefined)
    }, 150)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query])
  const results = found.query === query ? found.schools : []

  return (
    <div className="customize__school-search">
      <input
        className="customize__search-input"
        type="search"
        placeholder="School name, “ASU”, or “purdue”"
        aria-label="Find your school"
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {results.length > 0 && (
        <div className="customize__school-results" role="listbox" aria-label="Schools">
          {results.map((school) => (
            <button
              key={`${school.name}|${school.country}`}
              type="button"
              role="option"
              aria-selected={false}
              className="customize__school-result"
              onClick={() => pick(school)}
            >
              <span>{school.name}</span>
              <span className="customize__hint">{school.country}</span>
            </button>
          ))}
        </div>
      )}
      {query.trim() !== '' && found.query === query && results.length === 0 && (
        <p className="customize__note">No school by that name in the list.</p>
      )}
    </div>
  )
}
