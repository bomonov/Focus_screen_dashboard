import { useEffect, useRef, useState } from 'react'
import type { ClassPlaceInfo } from '../../../main/ipc'
import { useCalendar } from '../../hooks/useCalendar'
import { useNow } from '../../hooks/useNow'
import { useTodos } from '../../hooks/useTodos'
import type { Box } from '../cardMenu/cardMenuMotion'
import { timeFormat } from '../clockFormat'
import { BookIcon } from './BookIcon'
import { ClassListCard } from './ClassListCard'
import { ClassMapCard } from './ClassMapCard'
import { askPlaces, shownPlace, type ShownPlace } from './classPlaces'
import { classWeek } from './classWeek'
import { dueTags } from './dueTags'
import { calendarColor, nextClassView, SOON_MINUTES, startsIn } from './nextClassView'
import { stageClasses, usePillStage } from './pillStage'
import type { Turn } from './pillSwipe'
import { useDropToFit } from './useDropToFit'
import { useHoldToOpen } from './useHoldToOpen'
import { usePageTurn, useReturnHome } from './usePageTurn'
import { usePillSwipe, withSwipe } from './usePillSwipe'
import './NextClass.css'

const timeAt = (epochSec: number): string => timeFormat.format(new Date(epochSec * 1000))
const WEEK_HINT = 'Double-click for the week'

/** Where a location says the class meets, asked of main whenever the location changes. */
function useClassPlace(location: string): ClassPlaceInfo | null {
  const [answer, setAnswer] = useState<{ location: string; place: ClassPlaceInfo | null } | null>(
    null
  )
  useEffect(() => {
    if (!location) return
    let live = true
    void window.focusScreen.getClassPlace(location).then((place) => {
      if (live) setAnswer({ location, place })
    })
    return () => {
      live = false
    }
  }, [location])
  return answer?.location === location ? answer.place : null
}

/**
 * The top bar's "Next · BIO 181 · 10:30 AM · in 25 min · LSE 104". Held down, it opens a card
 * with the class's building on the campus map. Once the day's classes are over it stays, blank;
 * swiped right to left, it shows the first class of the next day that has any (the user's idea).
 * Double-clicked, it drops the week's classes, each held for its map (the user's idea too).
 */
export function NextClass({ picked }: { picked: readonly string[] }): React.JSX.Element | null {
  const state = useCalendar()
  const now = useNow()
  // The user's own homework and exams, for the week list's nearly-due tags.
  const todos = useTodos()
  const view = nextClassView(state, picked, now)
  const later = view?.kind === 'done' ? view.later : null
  // The later class swiped to. Another one (a new day, a moved class) starts blank again.
  const [shownId, setShownId] = useState<string | null>(null)
  const showing = later !== null && later.event.id === shownId
  const event =
    view?.kind === 'now' || view?.kind === 'next' ? view.event : showing ? later.event : null
  const place = shownPlace(useClassPlace(event?.location ?? ''))
  const stage = usePillStage()
  const [card, setCard] = useState<{
    place: ShownPlace
    from: Box
    keyboard: boolean
    heading: string
    location: string
    returnFocus: HTMLElement | null
  } | null>(null)
  const [list, setList] = useState<{
    places: ReadonlyMap<string, ShownPlace | null>
    from: Box
    keyboard: boolean
    returnFocus: HTMLElement | null
  } | null>(null)
  const opened = card !== null || list !== null
  const pill = useRef<HTMLElement | null>(null)
  useDropToFit(pill, '.next-class__part', '.next-class__title')
  const setPill = (element: HTMLElement | null): void => {
    pill.current = element
  }

  // Asked again as it opens: the map may have been made since the pill first asked.
  async function open(keyboard: boolean): Promise<void> {
    if (!event || opened) return
    stage.setOpen('class')
    const fresh = shownPlace(await window.focusScreen.getClassPlace(event.location))
    // A frame for the row to land, so the card grows out of where the pill ends up.
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const element = pill.current
    if (!fresh || !element) {
      stage.closed('class')
      return
    }
    setCard({
      place: fresh,
      from: stage.finalBox(element),
      keyboard,
      heading: `${event.title || 'Class'} · ${showing ? `${later.day} ` : ''}${timeAt(event.start)}`,
      location: event.location,
      returnFocus: element
    })
  }
  // Its places asked first, so the rows that can show a map can be held (and focused) at once.
  async function openList(keyboard: boolean): Promise<void> {
    if (!state || opened) return
    stage.setOpen('class')
    const places = await askPlaces(state.events.map((event) => event.location))
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const element = pill.current
    if (!element) {
      stage.closed('class')
      return
    }
    setList({ places, from: stage.finalBox(element), keyboard, returnFocus: element })
  }

  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  })
  const canOpen = place !== null
  const { register } = stage
  useEffect(
    () => (canOpen ? register('class', () => void openRef.current(false)) : undefined),
    [canOpen, register]
  )
  const hold = useHoldToOpen((keyboard) => void open(keyboard), !canOpen || opened, {
    open: (keyboard) => void openList(keyboard),
    disabled: opened,
    atOnce: true
  })

  const beginTurn = usePageTurn(pill)
  const turn = (to: Turn): void => {
    if (!later) return
    beginTurn(to)
    setShownId(to === 'next' ? later.event.id : null)
  }
  const swipe = usePillSwipe(
    () => [pill.current],
    { next: later !== null && !showing, back: showing },
    turn,
    view?.kind !== 'done' || opened || stage.open !== null
  )
  // Back to blank on its own, so the day ends quiet; not while its card (or another's) is open.
  useReturnHome(showing && !opened && stage.open === null ? later.event.id : null, () =>
    turn('back')
  )

  if (!view || !state) return null
  const color = event ? calendarColor(state, event) : null
  // Kept on screen till it has shrunk back, even if the class has ended meanwhile.
  const shown = card && (
    <ClassMapCard
      place={card.place}
      heading={card.heading}
      location={card.location}
      from={card.from}
      keyboard={card.keyboard}
      returnFocus={card.returnFocus}
      onPressOutside={stage.pressAt}
      onClosed={() => {
        setCard(null)
        stage.closed('class')
      }}
    />
  )
  const week = list ? classWeek(state.events, now, event?.id ?? null) : []
  const listShown = list && (
    <ClassListCard
      days={week}
      places={list.places}
      tags={dueTags(week, todos, now)}
      colorOf={(classEvent) => calendarColor(state, classEvent)}
      from={list.from}
      keyboard={list.keyboard}
      returnFocus={list.returnFocus}
      onPressOutside={stage.pressAt}
      onClosed={() => {
        setList(null)
        stage.closed('class')
      }}
    />
  )
  const staged = stageClasses(stage, 'class')
  const pressed = [
    ...(hold.pressing ? ['next-class--pressing'] : []),
    ...(opened ? ['next-class--open'] : [])
  ]
  // A button whatever it shows, so it can be double-clicked for the week (and Shift+Enter).
  const buttonProps = {
    ref: setPill,
    type: 'button',
    'aria-haspopup': 'dialog',
    'aria-expanded': opened,
    'data-pill': 'class'
  } as const
  if (view.kind === 'setup') {
    return (
      <>
        <p
          ref={setPill}
          className={['next-class', 'next-class--setup', ...staged].join(' ')}
          data-pill="class"
        >
          <BookIcon />
          <span>{view.text}</span>
        </p>
        {shown}
        {listShown}
      </>
    )
  }
  if (view.kind === 'done' && !showing) {
    return (
      <>
        <button
          {...buttonProps}
          className={[
            'next-class',
            'next-class--paged',
            'next-class--blank',
            ...staged,
            ...pressed
          ].join(' ')}
          aria-label="No classes left today"
          title={later ? `Swipe left for the next class. ${WEEK_HINT}` : 'No classes this week'}
          {...withSwipe(hold.handlers, swipe)}
        >
          <BookIcon />
        </button>
        {shown}
        {listShown}
      </>
    )
  }
  if (!event) return shown || listShown || null

  const soon = view.kind === 'next' && view.minutes <= SOON_MINUTES
  const label = view.kind === 'now' ? 'Now' : view.kind === 'next' ? 'Next' : (later?.day ?? '')
  const when =
    view.kind === 'now'
      ? `until ${timeAt(event.end)}`
      : [timeAt(event.start), view.kind === 'next' ? startsIn(view.minutes) : null]
          .filter((part) => part !== null)
          .join(' · ')

  const classes = ['next-class', ...staged, ...pressed]
  if (soon) classes.push('next-class--soon')
  if (view.kind === 'done') classes.push('next-class--paged')
  const parts = (
    <>
      <span
        className="next-class__dot"
        style={color ? { background: color } : undefined}
        aria-hidden="true"
      />
      <BookIcon color={color} />
      <span className="next-class__label">{label}</span>
      <span className="next-class__title">{event.title || 'Class'}</span>
      <span className="next-class__part">{when}</span>
      {event.location && <span className="next-class__part">{event.location}</span>}
    </>
  )
  const hints = [
    canOpen && 'Hold to see where it is',
    WEEK_HINT,
    view.kind === 'done' && 'Swipe right to go back'
  ]
  return (
    <>
      <button
        {...buttonProps}
        className={classes.join(' ')}
        title={hints.filter(Boolean).join('. ')}
        // Swiped to (the next day's class): it can be swiped (or arrowed) back.
        {...(view.kind === 'done' ? withSwipe(hold.handlers, swipe) : hold.handlers)}
      >
        {parts}
      </button>
      {shown}
      {listShown}
    </>
  )
}
