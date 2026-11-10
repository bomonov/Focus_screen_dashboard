import { useEffect, useState } from 'react'
import type {
  Settings,
  SettingsPatch,
  TransitRoute,
  TransitState,
  TransitStop
} from '../../../main/ipc'
import { MAX_BUS_STOPS } from '../../../main/services/transit/types'
import { useTransit } from '../../hooks/useTransit'
import { Section, ToggleRow } from './controls'

const day = (seconds: number): string =>
  new Date(seconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/** "Orbit Venus → Venus Forward · Route 66 → Downtown Tempe/ASU" */
function servesText(stop: TransitStop): string {
  return stop.serves
    .map(({ route, headsign }) => (headsign ? `${route} → ${headsign}` : route))
    .join(' · ')
}

/** "NB Mill Av & FS University Dr · stop 12651" */
function stopHint(stop: TransitStop): string {
  return [stop.detail, stop.code && `stop ${stop.code}`].filter(Boolean).join(' · ')
}

/**
 * Next bus: the switch, Valley Metro's stop list (downloaded only once the user says so
 * here), the picked stops and an optional route filter. Works on every platform.
 */
export function NextBusSection({
  settings,
  update
}: {
  settings: Settings
  update: (patch: SettingsPatch) => void
}): React.JSX.Element {
  const transit = useTransit()
  const on = settings.widgets.nextBus
  return (
    <Section title="Next bus">
      <div className="customize__rows">
        <ToggleRow
          label="Show next bus"
          hint="Valley Metro buses, Orbit and light rail live, and ASU’s shuttles, in the top bar"
          on={on}
          onToggle={(nextBus) => update({ widgets: { nextBus } })}
        />
        {on && transit && <StopListRows transit={transit} />}
        {on && transit && <StopRows transit={transit} settings={settings} update={update} />}
        {on && transit && transit.routes.length > 1 && (
          <RouteFilter
            routes={transit.routes}
            picked={settings.nextBus.routes}
            pick={(routes) => update({ nextBus: { routes } })}
          />
        )}
        {on && (
          <p className="customize__hint">
            Buses: Valley Metro, live, via City of Phoenix Open Data · ASU shuttles: ASU’s published
            timetable, not live
          </p>
        )}
      </div>
    </Section>
  )
}

/** The stop list: asked for before it's downloaded, then its date and the buttons. */
function StopListRows({ transit }: { transit: TransitState }): React.JSX.Element {
  const send = (kind: 'download' | 'remove'): void =>
    window.focusScreen.sendTransitCommand({ kind })
  const problem = transit.scheduleProblem && (
    <p className="customize__note">{transit.scheduleProblem}</p>
  )
  if (transit.downloading) {
    return <p className="customize__note">Downloading the stop list… this takes a minute.</p>
  }
  if (!transit.schedule) {
    return (
      <>
        <div className="customize__row">
          <span className="customize__toggle-text">
            <span>Download Valley Metro’s stop list?</span>
            <span className="customize__hint">
              About 13 MB from City of Phoenix Open Data, then once a month. Your stops stay on this
              computer: the live times are the same download for everyone.
            </span>
          </span>
          <button type="button" className="customize__button" onClick={() => send('download')}>
            Download
          </button>
        </div>
        {problem}
      </>
    )
  }
  return (
    <>
      <div className="customize__row">
        <span className="customize__toggle-text">
          <span>Stop list</span>
          <span className="customize__hint">
            {transit.demo
              ? 'Demo stops'
              : `${transit.schedule.stops.toLocaleString()} stops · ${day(transit.schedule.downloadedAt)}`}
          </span>
        </span>
        <div className="customize__pills">
          <button type="button" className="customize__button" onClick={() => send('download')}>
            Update
          </button>
          <button type="button" className="customize__button" onClick={() => send('remove')}>
            Remove
          </button>
        </div>
      </div>
      {problem}
    </>
  )
}

/** The picked stops, each with Remove, and a search to add another. */
function StopRows({
  transit,
  settings,
  update
}: {
  transit: TransitState
  settings: Settings
  update: (patch: SettingsPatch) => void
}): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  const picked = settings.nextBus.stops
  const setStops = (stops: string[]): void => update({ nextBus: { stops } })
  const full = picked.length >= MAX_BUS_STOPS

  return (
    <div className="customize__group">
      <span className="customize__group-label">Your stops</span>
      {transit.stops.length === 0 && !adding && (
        <p className="customize__note">No stop yet: add the one you wait at.</p>
      )}
      {transit.stops.map((stop) => (
        <div key={stop.id} className="customize__row">
          <span className="customize__toggle-text">
            <span>{stop.name}</span>
            <span className="customize__hint">{stopHint(stop)}</span>
            {stop.serves.length > 0 && <span className="customize__hint">{servesText(stop)}</span>}
          </span>
          <button
            type="button"
            className="customize__button"
            onClick={() => setStops(picked.filter((id) => id !== stop.id))}
          >
            Remove
          </button>
        </div>
      ))}
      {adding ? (
        <StopSearch
          picked={picked}
          hasStopList={transit.schedule !== null}
          pick={(stop) => {
            setAdding(false)
            setStops([...picked, stop.id])
          }}
          cancel={() => setAdding(false)}
        />
      ) : (
        <div className="customize__pills">
          <button
            type="button"
            className="customize__button"
            disabled={full}
            onClick={() => setAdding(true)}
          >
            {full ? `${MAX_BUS_STOPS} stops is the most` : 'Add a Stop…'}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Type a street, both cross streets, or the number on the stop's sign; the stop list is
 * searched on this computer.
 */
function StopSearch({
  picked,
  hasStopList,
  pick,
  cancel
}: {
  picked: readonly string[]
  /** Without Valley Metro's stop list, only ASU's shuttle stops can be found. */
  hasStopList: boolean
  pick: (stop: TransitStop) => void
  cancel: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<{ query: string; stops: TransitStop[] }>({
    query: '',
    stops: []
  })
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      window.focusScreen
        .searchBusStops(query)
        .then((stops) => {
          if (live) setFound({ query, stops })
        })
        .catch(() => undefined)
    }, 150)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query])
  const results = found.query === query ? found.stops.filter((s) => !picked.includes(s.id)) : []

  return (
    <div className="customize__school-search">
      <div className="customize__search-row">
        <input
          className="customize__search-input"
          type="search"
          placeholder={
            hasStopList
              ? '“Mill University”, “Tempe TC”, “ASU shuttle” or the stop’s number'
              : '“ASU shuttle”, “Tempe”, “Gold”'
          }
          aria-label="Find a bus stop"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') cancel()
          }}
        />
        <button type="button" className="customize__button" onClick={cancel}>
          Cancel
        </button>
      </div>
      {results.length > 0 && (
        <div className="customize__school-results" role="listbox" aria-label="Bus stops">
          {results.map((stop) => (
            <button
              key={stop.id}
              type="button"
              role="option"
              aria-selected={false}
              className="customize__school-result customize__stop-result"
              onClick={() => pick(stop)}
            >
              <span>{stop.name}</span>
              <span className="customize__hint">{stopHint(stop)}</span>
              <span className="customize__hint">{servesText(stop)}</span>
            </button>
          ))}
        </div>
      )}
      {query.trim() !== '' && found.query === query && results.length === 0 && (
        <p className="customize__note">
          {hasStopList
            ? 'No stop by that name in the list.'
            : 'No ASU shuttle stop by that name. Valley Metro’s stops need its stop list, above.'}
        </p>
      )}
    </div>
  )
}

/** Every route at the picked stops, or only some: pick none for all of them. */
function RouteFilter({
  routes,
  picked,
  pick
}: {
  routes: readonly TransitRoute[]
  picked: readonly string[]
  pick: (routes: string[]) => void
}): React.JSX.Element {
  // A route no longer at any picked stop doesn't count (main ignores it too).
  const shown = picked.filter((id) => routes.some((route) => route.id === id))
  const toggle = (id: string): void =>
    pick(shown.includes(id) ? shown.filter((r) => r !== id) : [...shown, id])
  return (
    <div className="customize__group">
      <span className="customize__group-label">Routes</span>
      <div className="customize__pills" role="group" aria-label="Routes">
        <button
          type="button"
          className="customize__pill"
          aria-pressed={shown.length === 0}
          onClick={() => pick([])}
        >
          All
        </button>
        {routes.map((route) => (
          <button
            key={route.id}
            type="button"
            className="customize__pill"
            aria-pressed={shown.includes(route.id)}
            title={route.detail || undefined}
            onClick={() => toggle(route.id)}
          >
            {route.name}
          </button>
        ))}
      </div>
    </div>
  )
}
