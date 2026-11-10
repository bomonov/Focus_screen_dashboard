import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { Place, TripCommand, TripFrom, TripState, TripWhen } from '../../../main/ipc'
import type { Box } from '../cardMenu/cardMenuMotion'
import { remPx } from '../cardMenu/cardMenuPrepare'
import { useCountdownNow } from '../nextBus/useCountdownNow'
import { PeekCard, type PeekCardHandle } from '../peek/PeekCard'
import { PlaceRows } from './PlaceRows'
import {
  firstPickable,
  homeAskNext,
  nothingFound,
  readySections,
  resultSections,
  resultsWords,
  startSections,
  type HomeAsk,
  type RowAction
} from './placeRowsView'
import { createPlaceSearch, type PlaceResults, type PlaceSearch } from './placeSearch'
import { SearchIcon } from './TripIcons'
import {
  askedWhen,
  isClassPlace,
  keepCommand,
  noTripWords,
  planKey,
  startView
} from './tripCardView'
import { KeptView, PlanView } from './TripPlanView'
import { countdownMoments } from './tripView'
import { whenLabel } from './whenPick'
import { WhenPicker } from './WhenPicker'

/** "Set Home to where you are now" waits this long on a fix before it gives up saying so. */
const SETTING_HOME_MS = 50_000
/** PeekCard's gap under the bubble and margin to the window's edge, and the card's padding, in rem. */
const ROOM_REM = 0.5 + 1 + 1

const send = (command: TripCommand): void => window.focusScreen.sendTripCommand(command)

/** What the card shows under its field: places to pick, a trip planned, or the kept trip. */
type Phase = 'browse' | 'trip' | 'kept'

/** The field's words for a picked place: the class by its title, others by name. */
function pickedWords(place: Place): string {
  if (isClassPlace(place)) return place.title || place.name
  return place.kind === 'home' ? 'Home' : place.name
}

export interface TripCardProps {
  handle?: React.Ref<PeekCardHandle>
  state: TripState
  /** The bubble's (or countdown's) box: the card grows out of it and shrinks back into it. */
  from: Box
  keyboard: boolean
  /** Opened from the kept trip's countdown: it shows that trip first. */
  onKept: boolean
  returnFocus: HTMLElement | null
  onClosed(): void
}

/**
 * The trip planner's card, grown out of the search bubble (design calls 7–9): "Where to?", the
 * start and when, then ready-made places (Home, the next class, saved, recent) or what's typed's
 * matches (the Mac's own, then Apple's); a picked place's best trip spelled out with two other
 * ways and "Keep on screen". Planning is main's: the card asks and shows what comes back.
 */
export function TripCard({
  handle,
  state,
  from,
  keyboard,
  onKept,
  returnFocus,
  onClosed
}: TripCardProps): React.JSX.Element {
  const id = useId()
  const peek = useRef<PeekCardHandle>(null)
  useImperativeHandle(
    handle,
    () => ({
      close: () => peek.current?.close(),
      content: () => peek.current?.content() ?? null
    }),
    []
  )
  const field = useRef<HTMLInputElement>(null)
  const rows = useRef<HTMLDivElement>(null)
  const whenButton = useRef<HTMLButtonElement>(null)

  const [text, setText] = useState('')
  const [fieldFor, setFieldFor] = useState<'to' | 'from'>('to')
  const [phase, setPhase] = useState<Phase>(onKept && state.kept ? 'kept' : 'browse')
  /** The place picked last: its trips are shown once main's state is about it. */
  const [picked, setPicked] = useState<Place | null>(null)
  const [start, setStart] = useState<TripFrom>(state.from)
  /** The user's own "when": what a newly picked place is planned for. */
  const [when, setWhen] = useState<TripWhen>(state.when)
  const [whenOpen, setWhenOpen] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [shownKey, setShownKey] = useState<string | null>(null)
  const [results, setResults] = useState<PlaceResults>(NO_RESULTS)
  /** "Set Home to where you are now" pressed: waiting on a fix until Home comes, or failed. */
  const [homeAsk, setHomeAsk] = useState<HomeAsk>({ kind: 'idle' })
  const homeWait = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(homeWait.current), [])
  // The ask follows where the Mac is and Home as main's state brings them (React's way of
  // adjusting state to new props during render, not after it in an effect).
  const hereKey = `${state.here?.status ?? ''}|${state.home ? 'home' : ''}`
  const [seenHere, setSeenHere] = useState(hereKey)
  if (seenHere !== hereKey) {
    setSeenHere(hereKey)
    setHomeAsk(homeAskNext(homeAsk, state.here, state.home))
  }

  const latest = useRef(state)
  useLayoutEffect(() => {
    latest.current = state
  })
  const search = useRef<PlaceSearch | null>(null)
  useEffect(() => {
    const made = createPlaceSearch({
      local: (words) => window.focusScreen.searchPlaces(words),
      apple: (words) => window.focusScreen.searchApplePlaces(words),
      appleOn: () => latest.current.supported.appleSearch,
      onResults: setResults
    })
    search.current = made
    return () => {
      made.dispose()
      search.current = null
    }
  }, [])

  const now = useCountdownNow([
    ...(state.plans ?? []).map((plan) => plan.leave),
    ...countdownMoments(state.kept),
    ...(state.homePreview ? [state.homePreview.leave] : [])
  ])

  // The card's height stops at the window's foot; past that, what's under the field scrolls.
  const [maxHeight] = useState(() =>
    Math.max(window.innerHeight - from.bottom - ROOM_REM * remPx(), 240)
  )

  // Picking a start lists places whatever was showing; the trip or kept trip comes back after.
  const showing: Phase = fieldFor === 'from' || (phase === 'kept' && !state.kept) ? 'browse' : phase
  const about = picked && state.to?.id === picked.id ? state.to : null
  // What's asked about is main's while its trip shows (a class plans to arrive early); while
  // browsing, the user's own, which the next place picked is planned for.
  const shownWhen = askedWhen(state, picked, phase === 'trip', when)
  const view = startView(start, state.here, state.supported.location)

  function type(words: string): void {
    setText(words)
    setSaving(null)
    if (fieldFor === 'to') setPhase('browse')
    search.current?.type(words)
  }

  function plan(to: Place, startAt: TripFrom, at: TripWhen): void {
    send({ kind: 'plan', to, from: startAt, when: at })
  }

  function pickTo(place: Place): void {
    // Nothing more goes to Apple for what was typed: the place is picked.
    search.current?.type('')
    setText(pickedWords(place))
    setPicked(place)
    setPhase('trip')
    setShownKey(null)
    setSaving(null)
    setWhenOpen(false)
    plan(place, start, when)
    // The row that was picked is gone: the keys stay on the card, in the field.
    field.current?.focus({ preventScroll: true })
  }

  function pickFrom(next: TripFrom): void {
    search.current?.type('')
    setStart(next)
    setFieldFor('to')
    setSaving(null)
    setText(phase === 'trip' && picked ? pickedWords(picked) : '')
    // The same place from a new start, asked as main asked it: a class still arrives early.
    if (phase === 'trip' && picked) plan(picked, next, shownWhen)
    field.current?.focus({ preventScroll: true })
  }

  function toggleStartSearch(): void {
    search.current?.type('')
    setSaving(null)
    if (fieldFor === 'from') {
      setFieldFor('to')
      setText(phase === 'trip' && picked ? pickedWords(picked) : '')
    } else {
      setFieldFor('from')
      setText('')
      setWhenOpen(false)
    }
    field.current?.focus({ preventScroll: true })
  }

  function changeWhen(next: TripWhen): void {
    setWhen(next)
    if (picked && phase === 'trip') plan(picked, start, next)
  }

  /** Esc steps back out of what's open inside the card first; true when it did. */
  function onEscape(): boolean {
    if (saving !== null) {
      setSaving(null)
      field.current?.focus({ preventScroll: true })
      return true
    }
    if (whenOpen) {
      setWhenOpen(false)
      whenButton.current?.focus({ preventScroll: true })
      return true
    }
    if (fieldFor === 'from') {
      toggleStartSearch()
      return true
    }
    return false
  }

  function setHomeHere(): void {
    setHomeAsk({ kind: 'waiting', sawLocating: state.here?.status === 'locating' })
    clearTimeout(homeWait.current)
    // Main gives up on a fix after 45 s; a fix that never showed as being looked for ends here.
    homeWait.current = setTimeout(
      () => setHomeAsk((ask) => (ask.kind === 'waiting' ? { kind: 'failed' } : ask)),
      SETTING_HOME_MS
    )
    send({ kind: 'setHomeHere' })
  }

  /** A row picked: the trip there, its start, or Home set where the Mac is. */
  function act(action: RowAction): void {
    if (action.kind === 'to') pickTo(action.place)
    else if (action.kind === 'from') pickFrom(action.from)
    else setHomeHere()
  }

  const typed = text.trim() !== ''
  const sections = typed
    ? resultSections(results, text, fieldFor, now)
    : fieldFor === 'from'
      ? startSections(state, start, now)
      : readySections(state, start, now, homeAsk)
  // While the new words' answer is on its way the rows are the last words': Enter waits for it.
  const firstRow = typed && results.localWaiting ? null : firstPickable(sections)
  const flatRows = sections.flatMap((section) => section.rows)
  const litIndex = typed && firstRow ? flatRows.indexOf(firstRow) : -1
  const listId = `${id}-places`

  function onFieldKey(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (showing !== 'browse') return
    if (event.key === 'ArrowDown') {
      const row = rows.current?.querySelector<HTMLButtonElement>('.trip-row__pick:not(:disabled)')
      if (!row) return
      event.preventDefault()
      row.focus()
    } else if (event.key === 'Enter' && typed && firstRow) {
      event.preventDefault()
      act(firstRow.action)
    }
  }

  const noMatches = nothingFound(results, text)

  const startLabel = view.label.startsWith('From ') ? (
    <>
      From <strong className="trip-start__name">{view.label.slice('From '.length)}</strong>
    </>
  ) : (
    <strong className="trip-start__name trip-start__name--pick">{view.label}</strong>
  )

  return (
    <PeekCard
      handle={peek}
      className="trip-card"
      label="Plan a trip"
      from={from}
      anchor="dot"
      keyboard={keyboard}
      focus={field}
      returnFocus={returnFocus}
      onPlaced={() => {
        // Clicked open too: what's typed next is where to. A frame later as well, since the
        // press that opened the card can still move the focus to the bubble as it ends.
        field.current?.focus({ preventScroll: true })
        const frame = requestAnimationFrame(() => {
          if (!field.current?.closest('.peek-card')?.contains(document.activeElement)) {
            field.current?.focus({ preventScroll: true })
          }
        })
        return () => cancelAnimationFrame(frame)
      }}
      onEscape={onEscape}
      onClosed={onClosed}
    >
      <div
        className="trip-card__body"
        style={{ maxHeight }}
        onKeyDown={(event) => {
          // Space presses the button it's on here, not the music's play and pause.
          if (event.key === ' ' && event.target instanceof HTMLButtonElement) {
            event.stopPropagation()
          }
          if (event.key === 'Tab') keepTabInside(event)
        }}
        onKeyUp={(event) => {
          if (event.key === ' ' && event.target instanceof HTMLButtonElement)
            event.stopPropagation()
        }}
      >
        <div className="trip-field">
          <SearchIcon className="trip-field__icon" />
          <input
            ref={field}
            className="trip-field__input"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showing === 'browse' && flatRows.length > 0}
            aria-controls={listId}
            aria-activedescendant={litIndex >= 0 ? `${listId}-${litIndex}` : undefined}
            aria-label={fieldFor === 'from' ? 'Where from' : 'Where to'}
            placeholder={fieldFor === 'from' ? 'Where from?' : 'Where to?'}
            autoComplete="off"
            spellCheck={false}
            maxLength={100}
            value={text}
            onChange={(event) => type(event.target.value)}
            onKeyDown={onFieldKey}
          />
        </div>
        <div className="trip-start">
          <button
            type="button"
            className="trip-start__from"
            aria-pressed={fieldFor === 'from'}
            title={fieldFor === 'from' ? 'Back to where to' : 'Plan from somewhere else'}
            onClick={toggleStartSearch}
          >
            <span className="trip-start__label">{startLabel}</span>
            {view.detail && <span className="trip-start__detail"> · {view.detail}</span>}
          </button>
          <button
            ref={whenButton}
            type="button"
            className="trip-start__when"
            aria-expanded={whenOpen}
            aria-controls={`${id}-when`}
            onClick={() => setWhenOpen((open) => !open)}
          >
            {whenLabel(shownWhen, now)}
          </button>
        </div>
        {whenOpen && (
          <WhenPicker id={`${id}-when`} when={shownWhen} now={now} onChange={changeWhen} />
        )}
        {view.locationOff && (
          <div className="trip-notice" role="status">
            <p className="trip-notice__words">Turn on Location to plan from here</p>
            <button
              type="button"
              className="trip-notice__button"
              onClick={() => send({ kind: 'openLocationSettings' })}
            >
              Open Location Settings
            </button>
          </div>
        )}
        {state.schedule !== 'ready' && (
          <ScheduleNotice downloading={state.schedule === 'downloading'} />
        )}
        <div className="trip-card__scroll">
          {showing === 'kept' && state.kept ? (
            <KeptView
              kept={state.kept}
              now={now}
              onUnkeep={() => {
                send({ kind: 'unkeep' })
                setPhase('browse')
                field.current?.focus({ preventScroll: true })
              }}
            />
          ) : showing === 'trip' && picked ? (
            <TripResult
              state={state}
              about={about}
              shownKey={shownKey}
              now={now}
              pickStart={view.pick && start.kind === 'here'}
              onPickStart={toggleStartSearch}
              onShow={setShownKey}
              onKeep={(index) => {
                const keep = keepCommand(state.plans, index)
                if (keep) send(keep)
                // The bubble grows into the countdown as the card goes.
                peek.current?.close()
              }}
            />
          ) : (
            <div>
              <PlaceRows
                listRef={rows}
                listId={listId}
                sections={sections}
                litIndex={litIndex}
                saving={saving}
                onPick={(row) => act(row.action)}
                onSaving={setSaving}
                onSave={(place, name) => {
                  send({ kind: 'save', place, name })
                  search.current?.refresh()
                  field.current?.focus({ preventScroll: true })
                }}
                onUpFromTop={() => field.current?.focus({ preventScroll: true })}
              />
              {noMatches && <p className="trip-card__quiet">No places found</p>}
              <p className="trip-card__said" role="status">
                {resultsWords(results, text)}
              </p>
            </div>
          )}
        </div>
        <p className="trip-card__credit">Data: Valley Metro via City of Phoenix Open Data</p>
      </div>
    </PeekCard>
  )
}

const TABBABLE = 'input:not(:disabled), button:not(:disabled), select:not(:disabled), [href]'

/**
 * Tab goes round the card's own controls, last back to the field: past the last one it would
 * walk into the pills under the dimmed screen, which the card covers.
 */
function keepTabInside(event: React.KeyboardEvent<HTMLElement>): void {
  const stops = [...event.currentTarget.querySelectorAll<HTMLElement>(TABBABLE)]
  const first = stops[0]
  const last = stops.at(-1)
  if (!first || !last) return
  const wrapTo = event.shiftKey ? event.target === first && last : event.target === last && first
  if (!wrapTo) return
  event.preventDefault()
  wrapTo.focus({ preventScroll: true })
}

/** Nothing typed, nothing found. */
const NO_RESULTS: PlaceResults = {
  text: '',
  local: [],
  apple: [],
  localWaiting: false,
  appleWaiting: false
}

/** No schedule on this Mac yet: the same offer as Customize › Next bus (the same yes). */
function ScheduleNotice({ downloading }: { downloading: boolean }): React.JSX.Element {
  if (downloading) {
    return (
      <p className="trip-notice trip-notice__words" role="status">
        Downloading the schedule… this takes a minute.
      </p>
    )
  }
  return (
    <div className="trip-notice">
      <p className="trip-notice__words">
        Bus and train times aren’t on this Mac yet
        <span className="trip-notice__hint">
          About 7 MB from City of Phoenix Open Data, then once a month. Where you go stays on this
          computer.
        </span>
      </p>
      <button
        type="button"
        className="trip-notice__button"
        onClick={() => send({ kind: 'downloadSchedule' })}
      >
        Download schedule
      </button>
    </div>
  )
}

interface TripResultProps {
  state: TripState
  /** Main's destination, once it's the place picked; null while that's on its way. */
  about: Place | null
  shownKey: string | null
  now: number
  /** The start is where the Mac is, which can't be had: one has to be picked. */
  pickStart: boolean
  onPickStart(): void
  onShow(key: string): void
  onKeep(index: number): void
}

/** A picked place's answer: its trips, or why there are none. Never a blank card. */
function TripResult({
  state,
  about,
  shownKey,
  now,
  pickStart,
  onPickStart,
  onShow,
  onKeep
}: TripResultProps): React.JSX.Element | null {
  if (state.schedule !== 'ready') return null
  const quiet = (words: string): React.JSX.Element => (
    <p className="trip-card__quiet" role="status">
      {words}
    </p>
  )
  if (!about) return quiet('Looking for trips…')
  const { plans, planning } = state
  if (plans && plans.length > 0) {
    const kept = state.kept
    const keptKey = kept && !kept.missed && kept.to.id === about.id ? planKey(kept.plan) : null
    return (
      <PlanView
        to={about}
        asked={state.when}
        plans={plans}
        shownKey={shownKey}
        now={now}
        planning={planning}
        keptKey={keptKey}
        onShow={onShow}
        onKeep={onKeep}
      />
    )
  }
  if (planning) {
    return quiet(
      state.here?.status === 'locating' && state.from.kind === 'here'
        ? 'Finding where you are…'
        : 'Looking for trips…'
    )
  }
  if (pickStart) {
    return (
      <div className="trip-notice">
        <p className="trip-notice__words">Pick a start to plan this trip</p>
        <button type="button" className="trip-notice__button" onClick={onPickStart}>
          Pick a start
        </button>
      </div>
    )
  }
  if (state.problem) return quiet(state.problem)
  if (plans) {
    const words = noTripWords(state.noTrip, state.when, now)
    return (
      <div className="trip-none" role="status">
        <p className="trip-none__lead">{words.lead}</p>
        {words.detail && <p className="trip-none__detail">{words.detail}</p>}
      </div>
    )
  }
  return quiet('Looking for trips…')
}
