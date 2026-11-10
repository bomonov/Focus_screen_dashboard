import { useEffect, useRef, useState } from 'react'
import type { BusArrival, BusRouteInfo } from '../../../main/ipc'
import { useTransit } from '../../hooks/useTransit'
import type { Box } from '../cardMenu/cardMenuMotion'
import { stageClasses, usePillStage } from '../nextClass/pillStage'
import type { Turn } from '../nextClass/pillSwipe'
import { useHoldToOpen } from '../nextClass/useHoldToOpen'
import { usePageTurn, useReturnHome } from '../nextClass/usePageTurn'
import { usePillSwipe, withSwipe } from '../nextClass/usePillSwipe'
import type { PeekCardHandle } from '../peek/PeekCard'
import { BusIcon } from './BusIcon'
import { BusListCard } from './BusListCard'
import { BusRouteCard } from './BusRouteCard'
// The same pill as Next class beside it.
import '../nextClass/NextClass.css'
import { busIn, keyStop, mergeOrder, nextBusView, pageKey, viewChanges } from './nextBusView'
import { useCountdownNow } from './useCountdownNow'
import './NextBus.css'

/** How long a click to try again says "Checking…". */
const CHECKING_MS = 4000

/**
 * The top bar's "Bus · Orbit Venus · 4 min · then 19 min": the next Valley Metro bus at the
 * picked stops, counted down here between main's reads of the live feed. Swiped right to left,
 * it turns to the other routes coming there, one at a time (the user's idea). Held down, it
 * opens the bus's route on the map, and swiped while that's open, the map follows to the next
 * route that has one. A double press held opens the list of them all, dragged into the order the
 * pill shows them in (`order`, saved in settings).
 */
export function NextBus({ order: saved }: { order: readonly string[] }): React.JSX.Element | null {
  const state = useTransit()
  const now = useCountdownNow(viewChanges(state))
  // A new order shows at once, before the settings come back with it.
  const [reordered, setReordered] = useState<{
    saved: readonly string[]
    order: readonly string[]
  } | null>(null)
  const order = reordered?.saved === saved ? reordered.order : saved
  const view = nextBusView(state, now, order)
  const stage = usePillStage()
  const pill = useRef<HTMLElement | null>(null)
  const [card, setCard] = useState<{
    info: BusRouteInfo
    from: Box
    keyboard: boolean
    returnFocus: HTMLElement | null
    /** Swiped to another route, whose map is on the way. */
    paging: boolean
    /** The side the last swiped-to route came in from. */
    enter: number
  } | null>(null)
  const cardHandle = useRef<PeekCardHandle>(null)
  const cardAsk = useRef(0)
  const [list, setList] = useState<{
    from: Box
    keyboard: boolean
    returnFocus: HTMLElement | null
  } | null>(null)
  const listHandle = useRef<PeekCardHandle>(null)
  // Clicked to try the feed again: "Checking…" for a moment. A read that fails the same way
  // changes nothing main would send, so it times out rather than waiting for news.
  const [checking, setChecking] = useState(false)
  useEffect(() => {
    if (!checking) return
    const done = setTimeout(() => setChecking(false), CHECKING_MS)
    return () => clearTimeout(done)
  }, [checking])
  const pages = view?.kind === 'bus' ? view.pages : []
  // The route swiped to (null: the soonest). It stays on that route as its buses come and go,
  // and goes back to the first page once that route has nothing coming.
  const [shownKey, setShownKey] = useState<string | null>(null)
  const index = Math.max(
    0,
    pages.findIndex((page) => pageKey(page.arrival) === shownKey)
  )
  const page = pages[index] ?? null
  const arrival = page?.arrival ?? null
  const canOpen = arrival?.hasRoute === true

  async function open(keyboard: boolean): Promise<void> {
    if (!arrival || card || list) return
    stage.setOpen('bus')
    const info = await window.focusScreen.getBusRoute(arrival.id)
    // A frame for the row to land, so the card grows out of where the pill ends up.
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const element = pill.current
    if (!info || !element) {
      stage.closed('bus')
      return
    }
    cardAsk.current += 1
    setCard({
      info,
      from: stage.finalBox(element),
      keyboard,
      returnFocus: element,
      paging: false,
      enter: 1
    })
  }

  async function openList(keyboard: boolean): Promise<void> {
    if (pages.length === 0 || card || list) return
    stage.setOpen('bus')
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const element = pill.current
    if (!element) {
      stage.closed('bus')
      return
    }
    setList({ from: stage.finalBox(element), keyboard, returnFocus: element })
  }

  /** The list's rows put in a new order: the pill's too, from now on. */
  function reorder(rows: string[]): void {
    const picked = new Set(state?.stops.map((stop) => stop.id) ?? [])
    // Routes at stops no longer picked go, so the saved order doesn't fill up with them.
    const next = mergeOrder(order, rows).filter((key) => picked.has(keyStop(key)))
    setReordered({ saved, order: next })
    window.focusScreen.updateSettings({ nextBus: { order: next } })
  }

  function soonestFirst(): void {
    setReordered({ saved, order: [] })
    window.focusScreen.updateSettings({ nextBus: { order: [] } })
  }

  /** The open card follows the pill to the route it was swiped to. */
  async function showRoute(to: BusArrival, from: Turn): Promise<void> {
    const asked = ++cardAsk.current
    setCard((current) => current && { ...current, paging: true })
    const info = await window.focusScreen.getBusRoute(to.id)
    if (asked !== cardAsk.current) return
    if (!info) {
      setCard((current) => current && { ...current, paging: false })
      cardHandle.current?.close()
      return
    }
    setCard(
      (current) => current && { ...current, info, paging: false, enter: from === 'next' ? 1 : -1 }
    )
  }
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  })
  const { register } = stage
  useEffect(
    () => (canOpen ? register('bus', () => void openRef.current(false)) : undefined),
    [canOpen, register]
  )
  const opened = card !== null || list !== null
  const hold = useHoldToOpen((keyboard) => void open(keyboard), !canOpen || opened, {
    open: (keyboard) => void openList(keyboard),
    disabled: pages.length === 0 || opened
  })
  const setPill = (element: HTMLElement | null): void => {
    pill.current = element
  }

  /** The page a swipe that way goes to; with the card open, only routes with a map count. */
  const step = (to: Turn): number | null => {
    const way = to === 'next' ? 1 : -1
    for (let at = index + way; at >= 0 && at < pages.length; at += way) {
      if (!card || pages[at]?.arrival.hasRoute) return at
    }
    return null
  }
  const beginTurn = usePageTurn(pill)
  const turn = (to: Turn, target = step(to)): void => {
    const next = target === null ? undefined : pages[target]
    if (!next || target === index) return
    beginTurn(to)
    setShownKey(target === 0 ? null : pageKey(next.arrival))
    if (card) void showRoute(next.arrival, to)
  }
  const paged = pages.length > 1
  const swipe = usePillSwipe(
    () => [pill.current, card ? (cardHandle.current?.content() ?? null) : null],
    { next: step('next') !== null, back: step('back') !== null },
    turn,
    // Its own card open is fine (it follows); another's, or its own still opening, isn't.
    !paged || (stage.open !== null && !(stage.open === 'bus' && card !== null))
  )
  // Back to the first on its own; not while its card or list (or another pill's card) is open.
  useReturnHome(
    index > 0 && arrival && !opened && stage.open === null ? pageKey(arrival) : null,
    () => turn('back', 0)
  )

  if (!view || !state) return null
  // Kept on screen till it has shrunk back, even if its bus has come and gone meanwhile.
  const shown = card && (
    <BusRouteCard
      handle={cardHandle}
      info={card.info}
      paging={card.paging}
      enter={card.enter}
      gestures={paged ? swipe : undefined}
      when={page && arrival?.id === card.info.arrivalId ? busIn(page.minutes) : ''}
      from={card.from}
      keyboard={card.keyboard}
      returnFocus={card.returnFocus}
      onPressOutside={stage.pressAt}
      onClosed={() => {
        setCard(null)
        stage.closed('bus')
      }}
    />
  )
  const listShown = list && (
    <BusListCard
      handle={listHandle}
      pages={pages}
      stops={state.stops}
      current={arrival ? pageKey(arrival) : null}
      custom={order.length > 0}
      from={list.from}
      keyboard={list.keyboard}
      returnFocus={list.returnFocus}
      onPick={(key) => {
        const target = pages.findIndex((candidate) => pageKey(candidate.arrival) === key)
        if (target >= 0) turn(target > index ? 'next' : 'back', target)
        listHandle.current?.close()
      }}
      onReorder={reorder}
      onSoonestFirst={soonestFirst}
      onPressOutside={stage.pressAt}
      onClosed={() => {
        setList(null)
        stage.closed('bus')
      }}
    />
  )
  const classes = ['next-class', 'next-bus', ...stageClasses(stage, 'bus')]
  if (view.kind === 'setup') {
    return (
      <>
        <p className={[...classes, 'next-class--setup'].join(' ')} data-pill="bus">
          <BusIcon className="next-bus__icon pill-icon pill-icon--bubble" />
          <span>{view.text}</span>
        </p>
        {shown}
        {listShown}
      </>
    )
  }

  if (view.kind === 'quiet') classes.push('next-bus--quiet')
  if (page && page.minutes < 1) classes.push('next-class--soon')
  if (paged) classes.push('next-class--paged')
  const stop = arrival ? state.stops.find((s) => s.id === arrival.stopId) : null
  const title = arrival
    ? [arrival.route, arrival.headsign && `to ${arrival.headsign}`, stop && `at ${stop.name}`]
        .filter(Boolean)
        .join(' ')
    : undefined
  const others = pages.length - 1
  const swipeHint = paged
    ? `Swipe for ${others} more ${others === 1 ? 'route' : 'routes'} here`
    : null
  const hints = [
    canOpen && 'Hold to see its route',
    'Double-press and hold for all of them',
    swipeHint
  ]
  const parts =
    view.kind === 'quiet' || !page ? (
      <>
        <BusIcon />
        <span className="next-class__label">Bus</span>
        <span className="next-bus__quiet">{view.kind === 'quiet' ? view.text : ''}</span>
      </>
    ) : (
      <>
        <BusIcon />
        <span className="next-class__label">Bus</span>
        <span className="next-class__title">{page.arrival.route}</span>
        <span className="next-bus__parts">
          {/* Only while the pill is stretched for its card: there's room to say where it goes. */}
          {page.arrival.headsign && (
            <span className="next-class__part next-bus__held-part">to {page.arrival.headsign}</span>
          )}
          <span className="next-class__part">{busIn(page.minutes)}</span>
          {page.then !== null && <span className="next-class__part">then {busIn(page.then)}</span>}
        </span>
      </>
    )

  if (view.kind === 'quiet' && view.retry) {
    // The feed couldn't be read: a click asks for it again now, rather than at the next try.
    return (
      <>
        <button
          ref={setPill}
          type="button"
          className={classes.join(' ')}
          title="Valley Metro’s live times couldn’t be read. Click to try again now"
          data-pill="bus"
          onClick={() => {
            window.focusScreen.sendTransitCommand({ kind: 'retry' })
            setChecking(true)
          }}
        >
          <BusIcon />
          <span className="next-class__label">Bus</span>
          <span className="next-bus__quiet">{checking ? 'Checking…' : view.text}</span>
        </button>
        {shown}
        {listShown}
      </>
    )
  }
  if (view.kind === 'quiet') {
    return (
      <>
        <p ref={setPill} className={classes.join(' ')} data-pill="bus">
          {parts}
        </p>
        {shown}
        {listShown}
      </>
    )
  }

  // A bus coming: a button, held for its route (when there's a map), held after a click for the
  // list of them all, and swiped (or arrowed) between routes.
  if (hold.pressing) classes.push('next-class--pressing')
  if (opened) classes.push('next-class--open')
  return (
    <>
      <button
        ref={setPill}
        type="button"
        className={classes.join(' ')}
        title={[title, ...hints].filter(Boolean).join('. ')}
        aria-haspopup="dialog"
        aria-expanded={opened}
        data-pill="bus"
        {...(paged ? withSwipe(hold.handlers, swipe) : hold.handlers)}
      >
        {parts}
      </button>
      {shown}
      {listShown}
    </>
  )
}
