import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Place, Settings, SettingsPatch, TripCommand, TripState } from '../../../main/ipc'
import { ARRIVE_EARLY_LIMITS } from '../../../main/services/settings/schema'
import { useTrips } from '../../hooks/useTrips'
import { homeAskNext, type HomeAsk } from '../../widgets/trips/placeRowsView'
import { Section, ToggleRow } from './controls'
import {
  PLACE_NAME_MAX,
  clampEarly,
  cleanName,
  earlyWords,
  locationWords,
  scheduleWords
} from './tripsView'

const send = (command: TripCommand): void => window.focusScreen.sendTripCommand(command)

/** Main gives up on a fix after 45 s; the same wait the card gives Home, plus a little. */
const SETTING_HOME_MS = 50_000

/**
 * Trips: the switch, Home, saved and recent places, how early to arrive for class, and the
 * schedule it shares with Next bus. Turning it on is what may ask macOS for Location.
 */
export function TripsSection({
  settings,
  update
}: {
  settings: Settings
  update: (patch: SettingsPatch) => void
}): React.JSX.Element {
  const trips = useTrips()
  const on = settings.widgets.trips

  function toggle(next: boolean): void {
    update({ widgets: { trips: next } })
    // The one place the prompt comes from: asked here, not out of the blue on the card.
    if (next && trips?.supported.location && trips.here?.status !== 'found')
      send({ kind: 'requestAccess' })
  }

  return (
    <Section title="Trips">
      <div className="customize__rows">
        <ToggleRow
          label="Show trips"
          hint="Plan a bus or train trip from the top bar. Turning this on may ask for your location."
          on={on}
          onToggle={toggle}
        />
        {on && trips && (
          <TripRows trips={trips} early={settings.trips.arriveEarlyMin} update={update} />
        )}
        <p className="customize__hint">
          Trips are planned on this Mac. Only what you type into the search goes to Apple Maps,
          never where you are.
        </p>
        <p className="customize__hint">Data: Valley Metro via City of Phoenix Open Data</p>
      </div>
    </Section>
  )
}

function TripRows({
  trips,
  early,
  update
}: {
  trips: TripState
  early: number
  update: (patch: SettingsPatch) => void
}): React.JSX.Element {
  const location = locationWords(trips.supported.location, trips.here, trips.locationAccess)
  const schedule = scheduleWords(trips.schedule)
  return (
    <>
      {location && (
        <div className="customize__row">
          <span className="customize__toggle-text">
            <span>{location.text}</span>
            {location.settings && (
              <span className="customize__hint">Privacy &amp; Security › Location Services</span>
            )}
          </span>
          {location.settings && (
            <button
              type="button"
              className="customize__button"
              onClick={() => send({ kind: 'openLocationSettings' })}
            >
              Open System Settings
            </button>
          )}
        </div>
      )}
      <HomeRow trips={trips} />
      <SavedRows saved={trips.saved} />
      <div className="customize__row">
        <span className="customize__toggle-text">
          <span>Recent places</span>
          <span className="customize__hint">
            {trips.recents.length === 0 ? 'None yet' : `${trips.recents.length} kept`}
          </span>
        </span>
        <button
          type="button"
          className="customize__button"
          disabled={trips.recents.length === 0}
          onClick={() => send({ kind: 'clearRecents' })}
        >
          Clear recent places
        </button>
      </div>
      <EarlyRow early={early} update={update} />
      <div className="customize__row">
        <span className="customize__toggle-text">
          <span>Uses Valley Metro’s schedule, shared with Next bus</span>
          <span className="customize__hint">{schedule.text}</span>
        </span>
        {schedule.download !== 'none' && (
          <button
            type="button"
            className="customize__button"
            disabled={schedule.download === 'busy'}
            onClick={() => send({ kind: 'downloadSchedule' })}
          >
            Download
          </button>
        )}
      </div>
    </>
  )
}

function HomeRow({ trips }: { trips: TripState }): React.JSX.Element {
  const { home } = trips
  const [ask, setAsk] = useState<HomeAsk>({ kind: 'idle' })
  const wait = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [seen, setSeen] = useState({ here: trips.here, home })
  // The card's own rule, so a fix that fails says so here too.
  if (seen.here !== trips.here || seen.home !== home) {
    setSeen({ here: trips.here, home })
    const next = homeAskNext(ask, trips.here, home)
    if (next !== ask) setAsk(next)
  }
  useEffect(() => () => clearTimeout(wait.current), [])

  function setHere(): void {
    setAsk({ kind: 'waiting', sawLocating: trips.here?.status === 'locating' })
    clearTimeout(wait.current)
    wait.current = setTimeout(
      () => setAsk((was) => (was.kind === 'waiting' ? { kind: 'failed' } : was)),
      SETTING_HOME_MS
    )
    send({ kind: 'setHomeHere' })
  }

  const waiting = ask.kind === 'waiting'
  return (
    <div className="customize__row">
      <span className="customize__toggle-text">
        <span>Home</span>
        <span className="customize__hint">
          {home ? home.detail || 'Set' : 'Not set'}
          {ask.kind === 'failed' && !home ? ' · Couldn’t find where you are' : ''}
        </span>
      </span>
      <span className="customize__row-actions">
        {trips.supported.location && (
          <button type="button" className="customize__button" disabled={waiting} onClick={setHere}>
            {waiting ? 'Finding where you are…' : 'Set to where I am now'}
          </button>
        )}
        {home && (
          <button
            type="button"
            className="customize__button"
            onClick={() => send({ kind: 'clearHome' })}
          >
            Clear
          </button>
        )}
      </span>
    </div>
  )
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled)'

/**
 * Focus to the control after `row` (the next row's first), else the one before it: the row's
 * place is being deleted, and focus mustn't drop to the window with it.
 */
function focusNear(row: Element | null): void {
  for (let next = row?.nextElementSibling; next; next = next.nextElementSibling) {
    const control = next.querySelector<HTMLElement>(FOCUSABLE)
    if (control) return control.focus()
  }
  for (let before = row?.previousElementSibling; before; before = before.previousElementSibling) {
    const controls = before.querySelectorAll<HTMLElement>(FOCUSABLE)
    const last = controls[controls.length - 1]
    if (last) return last.focus()
  }
}

function SavedRows({ saved }: { saved: Place[] }): React.JSX.Element {
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  /** Each row's Rename and Delete buttons, by `${id}:rename` and `${id}:delete`. */
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  /** The button focus goes back to once its row is drawn again (a rename or delete let go). */
  const refocus = useRef<string | null>(null)
  useLayoutEffect(() => {
    const key = refocus.current
    if (key === null) return
    refocus.current = null
    buttons.current.get(key)?.focus()
  })

  const button = (key: string) => (element: HTMLButtonElement | null) => {
    if (element) buttons.current.set(key, element)
    else buttons.current.delete(key)
  }
  /** Done renaming (saved or not): back to its Rename button. */
  function doneRenaming(id: string): void {
    refocus.current = `${id}:rename`
    setEditing(null)
  }
  /** Not deleted after all: back to its Delete button. */
  function keepPlace(id: string): void {
    refocus.current = `${id}:delete`
    setDeleting(null)
  }

  if (saved.length === 0) {
    return (
      <div className="customize__row">
        <span className="customize__toggle-text">
          <span>Saved places</span>
          <span className="customize__hint">None yet. Save a place from a trip search.</span>
        </span>
      </div>
    )
  }
  return (
    <>
      {saved.map((place) =>
        editing === place.id ? (
          <RenameRow key={place.id} place={place} done={() => doneRenaming(place.id)} />
        ) : deleting === place.id ? (
          <div
            className="customize__row"
            key={place.id}
            role="group"
            aria-label={`Delete ${place.name}?`}
            onKeyDown={(event) => {
              // Esc is Cancel, the default.
              if (event.key !== 'Escape') return
              event.preventDefault()
              event.stopPropagation()
              keepPlace(place.id)
            }}
          >
            <span className="customize__toggle-text">
              <span>Delete {place.name}?</span>
              <span className="customize__hint">It leaves your saved places.</span>
            </span>
            <span className="customize__row-actions">
              <button
                type="button"
                className="customize__button customize__button--primary"
                autoFocus
                onClick={() => keepPlace(place.id)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="customize__button"
                onClick={(event) => {
                  focusNear(event.currentTarget.closest('.customize__row'))
                  setDeleting(null)
                  send({ kind: 'remove', id: place.id })
                }}
              >
                Delete
              </button>
            </span>
          </div>
        ) : (
          <div className="customize__row" key={place.id}>
            <span className="customize__toggle-text">
              <span>{place.name}</span>
              {place.detail !== '' && <span className="customize__hint">{place.detail}</span>}
            </span>
            <span className="customize__row-actions">
              <button
                ref={button(`${place.id}:rename`)}
                type="button"
                className="customize__button"
                onClick={() => setEditing(place.id)}
              >
                Rename
              </button>
              <button
                ref={button(`${place.id}:delete`)}
                type="button"
                className="customize__button"
                onClick={() => setDeleting(place.id)}
              >
                Delete
              </button>
            </span>
          </div>
        )
      )}
    </>
  )
}

function RenameRow({ place, done }: { place: Place; done: () => void }): React.JSX.Element {
  const [text, setText] = useState(place.name)
  const name = cleanName(text)
  function save(): void {
    if (name !== null && name !== place.name) send({ kind: 'rename', id: place.id, name })
    done()
  }
  return (
    <form
      className="customize__row"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <input
        className="customize__search-input"
        aria-label={`Name for ${place.name}`}
        value={text}
        maxLength={PLACE_NAME_MAX}
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            done()
          }
        }}
      />
      <span className="customize__row-actions">
        <button
          type="submit"
          className="customize__button customize__button--primary"
          disabled={name === null}
        >
          Save
        </button>
        <button type="button" className="customize__button" onClick={done}>
          Cancel
        </button>
      </span>
    </form>
  )
}

/** −, the number and + for how early a trip to class aims to arrive. */
function EarlyRow({
  early,
  update
}: {
  early: number
  update: (patch: SettingsPatch) => void
}): React.JSX.Element {
  const set = (next: number): void => update({ trips: { arriveEarlyMin: clampEarly(next) } })
  const { min, max } = ARRIVE_EARLY_LIMITS
  return (
    <div className="customize__row">
      <span className="customize__toggle-text">
        <span>Arrive early for class</span>
        <span className="customize__hint">
          A trip to your next class aims to get there this long before it starts.
        </span>
      </span>
      <span className="customize__row-actions" role="group" aria-label="Arrive early for class">
        <button
          type="button"
          className="customize__button"
          aria-label="One minute less"
          disabled={early <= min}
          onClick={() => set(early - 1)}
        >
          −
        </button>
        <span role="status" className="customize__early">
          {earlyWords(early)}
        </span>
        <button
          type="button"
          className="customize__button"
          aria-label="One minute more"
          disabled={early >= max}
          onClick={() => set(early + 1)}
        >
          +
        </button>
      </span>
    </div>
  )
}
