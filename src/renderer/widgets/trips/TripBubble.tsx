import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useTrips } from '../../hooks/useTrips'
import type { Box } from '../cardMenu/cardMenuMotion'
import { useCountdownNow } from '../nextBus/useCountdownNow'
import { boxOf } from '../nextClass/pillStage'
import { morphWidth, reducedMotion, stopMorph } from '../nextClass/pillMorph'
import { isMorphing, refit } from '../nextClass/useDropToFit'
import type { PeekCardHandle } from '../peek/PeekCard'
import { TripCard } from './TripCard'
import { PlaceIcon, SearchIcon } from './TripIcons'
import {
  countdownMoments,
  countdownParts,
  countdownWords,
  isFindKey,
  type CountdownParts
} from './tripView'
// The countdown wears the pills' look (NextClass.css), at the bar's other end.
import '../nextClass/NextClass.css'
import './Trips.css'

/** What the button is: not yet told (no morph into the first answer), the glass, the countdown. */
type Shape = 'starting' | 'search' | 'countdown'

/** The open card: grown out of `from`; `onKept` when it was the countdown that opened it. */
interface OpenCard {
  from: Box
  keyboard: boolean
  onKept: boolean
  returnFocus: HTMLElement
}

/** Opens the card from the bubble's box; `keyboard`: Enter or ⌘F, so its field takes the keys. */
type Open = (keyboard: boolean) => void

/**
 * The top bar's search bubble, beside Customize: a magnifying glass that opens the trip card
 * (the user's idea). With a trip kept on screen it grows into that trip's countdown, "Leave in 6
 * min · [Orbit Venus] · home 4:41 PM", gold at "Leave now", and shrinks back once the trip is
 * over. Clicked, held or ⌘F, it opens the card (the countdown opens it on the kept trip); the
 * card's own glass covers the bubble while it's open, so a second press there closes it.
 */
export function TripBubble(): React.JSX.Element {
  const state = useTrips()
  const kept = state?.kept ?? null
  const now = useCountdownNow(countdownMoments(kept))
  const parts = countdownParts(kept, now)
  const button = useRef<HTMLButtonElement>(null)
  const shape: Shape = state === null ? 'starting' : parts ? 'countdown' : 'search'
  const [card, setCard] = useState<OpenCard | null>(null)
  const cardHandle = useRef<PeekCardHandle>(null)
  const cardOpen = useRef(false)
  useCountdownFit(button, shape)

  const open: Open = (keyboard) => {
    const element = button.current
    if (!element || state === null) return
    // Already open (⌘F from a button on it): the same key closes it, like the bubble.
    if (cardOpen.current) {
      cardHandle.current?.close()
      return
    }
    cardOpen.current = true
    window.focusScreen.sendTripCommand({ kind: 'open' })
    setCard({
      from: boxOf(element.getBoundingClientRect()),
      keyboard,
      onKept: shape === 'countdown',
      returnFocus: element
    })
  }
  useFindKey(open)

  // The bar can take the bubble away with the card open (cards being arranged, the screen
  // dimming): main still hears that it closed.
  useEffect(
    () => () => {
      if (cardOpen.current) window.focusScreen.sendTripCommand({ kind: 'close' })
    },
    []
  )

  const shown = card && state && (
    <TripCard
      handle={cardHandle}
      state={state}
      from={card.from}
      keyboard={card.keyboard}
      onKept={card.onKept}
      returnFocus={card.returnFocus}
      onClosed={() => {
        cardOpen.current = false
        setCard(null)
        window.focusScreen.sendTripCommand({ kind: 'close' })
      }}
    />
  )
  const handlers = {
    // On the press, like the glass menus: a hold opens it as surely as a click.
    onPointerDown: (down: React.PointerEvent) => {
      if (down.button === 0 && !down.ctrlKey) open(false)
    },
    // Enter or Space (a click with no count); the mouse's own click came in on the press.
    onClick: (click: React.MouseEvent) => {
      if (click.detail === 0) open(true)
    }
  }

  if (!parts || !kept) {
    return (
      <>
        <button
          ref={button}
          type="button"
          className={`top-bar__customize top-bar__bubble trip-search${card ? ' trip-search--open' : ''}`}
          aria-label="Plan a trip"
          title="Plan a trip"
          aria-haspopup="dialog"
          aria-expanded={card !== null}
          {...handlers}
        >
          <SearchIcon />
        </button>
        {shown}
      </>
    )
  }

  const words = countdownWords(kept, parts)
  const classes = ['next-class', 'trip-countdown']
  if (parts.due) classes.push('trip-countdown--due')
  if (kept.missed) classes.push('trip-countdown--missed')
  if (card) classes.push('next-class--open')
  return (
    <>
      <button
        ref={button}
        type="button"
        className={classes.join(' ')}
        aria-label={words.join(', ')}
        title={`${words.join(' · ')}. Click to see the trip`}
        aria-haspopup="dialog"
        aria-expanded={card !== null}
        {...handlers}
      >
        <PlaceIcon kind={kept.to.kind} className="trip-countdown__icon" />
        <CountdownWords parts={parts} missed={kept.missed} />
      </button>
      {shown}
    </>
  )
}

/**
 * Leaving: the lead, then the bus's chip and where it gets to when. Missed: the next way's
 * leave time comes before its chip, so the chip reads as that way's bus, not the one missed.
 */
function CountdownWords({
  parts,
  missed
}: {
  parts: CountdownParts
  missed: boolean
}): React.JSX.Element {
  const { lead, chip, tail } = parts
  const chipShown = chip && (
    <span
      className="trip-countdown__chip"
      style={{ background: chip.color, color: chip.textColor }}
    >
      {chip.text}
    </span>
  )
  const tailShown = tail && <span className="next-class__part trip-countdown__tail">{tail}</span>
  if (missed) {
    return (
      <>
        <span className="trip-countdown__lead trip-countdown__missed">{lead}</span>
        {tailShown}
        {chipShown}
      </>
    )
  }
  return (
    <>
      <span className="next-class__title trip-countdown__lead">{lead}</span>
      {chipShown}
      {tailShown}
    </>
  )
}

/**
 * A part that went out for room comes back only with this much to spare, so a pill's words
 * changing by a letter as a minute ticks over ("in 10 min", "in 9 min") can't flip it in and out.
 */
const SLACK_PX = 16

const cut = (element: Element | null | undefined): boolean =>
  element instanceof HTMLElement && element.scrollWidth > element.clientWidth + 1

/**
 * The clock-and-pills row is short of room: a pill there has dropped a part (Next class) or
 * wrapped one out of sight (Next bus, the shuttle), or has its name cut short, or the row
 * itself is cut off (the Bus pill never shrinks). Not the weather's own parts: it gives way
 * first, by design. Nor a bubble's: another pill's card is open and it shows only its icon.
 */
function rowShort(row: Element): boolean {
  if (cut(row)) return true
  return [...row.children].some(
    (pill) =>
      pill.classList.contains('next-class') &&
      !pill.classList.contains('next-class--bubble') &&
      !pill.classList.contains('weather') &&
      (pill.querySelector('.next-class__part[hidden]') !== null ||
        [...pill.querySelectorAll<HTMLElement>('.next-bus__parts')].some(
          (wrapped) => wrapped.scrollHeight > wrapped.clientHeight + 1
        ) ||
        cut(pill.querySelector('.next-class__title')))
  )
}

/** The row's pills fitted to the room they have now (each pill's own useDropToFit). */
function refitRow(row: Element): void {
  for (const pill of row.children) if (pill instanceof HTMLElement) refit(pill)
}

/** Row morphs already waited on, so a frame's refit doesn't wait on one twice. */
const waitedOn = new WeakSet<Animation>()

/**
 * While the row's pills ease to new widths (a card opening or closing), their parts stay as
 * they were: the countdown waits for them to land, then fits. True while it's waiting.
 */
function waitForRow(row: Element, then: () => void): boolean {
  const morphs = [...row.children].flatMap((pill) =>
    pill.getAnimations().filter((animation) => animation.id === 'pill-morph')
  )
  for (const morph of morphs) {
    if (waitedOn.has(morph)) continue
    waitedOn.add(morph)
    // Cancelled: the next morph took over, and is waited on in turn.
    morph.finished.then(then, () => undefined)
  }
  return morphs.length > 0
}

/**
 * Keeps the lead; drops the chip, then the arrival, whole, while the pills on the left are short
 * of room with them shown (the user's class name outranks them). Each try refits the pills, so
 * the answer doesn't hang on how they were fitted before; a part comes back only with room to
 * spare.
 */
function fitCountdown(countdown: HTMLElement, row: Element, later: () => void): void {
  if (isMorphing(countdown) || waitForRow(row, later)) return
  const droppable = [
    countdown.querySelector<HTMLElement>('.trip-countdown__chip'),
    countdown.querySelector<HTMLElement>('.trip-countdown__tail')
  ].filter((part): part is HTMLElement => part !== null)
  const droppedBefore = droppable.filter((part) => part.hidden).length
  const drop = (count: number): void => {
    droppable.forEach((part, index) => {
      part.hidden = index < count
    })
  }
  let dropped = 0
  for (; dropped < droppable.length; dropped++) {
    drop(dropped)
    // The slack stands in for room the part would need on top: the row gets that much less.
    countdown.style.marginLeft = dropped < droppedBefore ? `${SLACK_PX}px` : ''
    refitRow(row)
    const short = rowShort(row)
    countdown.style.marginLeft = ''
    if (!short) break
  }
  drop(dropped)
  refitRow(row)
}

const rowOf = (element: HTMLElement): Element | null =>
  element.closest('.top-bar')?.querySelector('.top-bar__left') ?? null

/**
 * The countdown's parts fitted to the room, and the button eased from one shape to the other
 * (FLIP on width, like the pills; instant with reduced motion). The width it's drawn at is kept
 * up as it changes (a minute ticking over, a part dropped, mid-morph), so a new shape starts
 * from exactly where the old one is.
 */
function useCountdownFit(ref: RefObject<HTMLButtonElement | null>, shape: Shape): void {
  const drawnWidth = useRef<number | null>(null)
  const shown = useRef(shape)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const watch = new ResizeObserver(() => {
      drawnWidth.current = element.offsetWidth
    })
    watch.observe(element)
    return () => watch.disconnect()
  }, [ref])

  // Only while the countdown shows: the bar, its own size, and each pill in the row (and pills
  // coming and going) can change the room it has.
  useLayoutEffect(() => {
    const element = ref.current
    const bar = element?.closest('.top-bar')
    const row = element && rowOf(element)
    if (shape !== 'countdown' || !element || !bar || !row) return
    const fit = (): void => fitCountdown(element, row, fit)
    // Fitted in the next frame, not inside the observer's callback: it resizes the pills the
    // same observers watch, which the browser then reports as a loop it had to cut short.
    let frame = 0
    const fitSoon = (): void => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        fit()
      })
    }
    fit()
    const watch = new ResizeObserver(fitSoon)
    watch.observe(element)
    watch.observe(bar)
    for (const pill of row.children) watch.observe(pill)
    const pills = new MutationObserver(() => {
      for (const pill of row.children) watch.observe(pill)
      fitSoon()
    })
    pills.observe(row, { childList: true })
    return () => {
      cancelAnimationFrame(frame)
      watch.disconnect()
      pills.disconnect()
    }
  }, [ref, shape])

  useLayoutEffect(() => {
    const element = ref.current
    const was = shown.current
    shown.current = shape
    if (!element || was === shape) return
    const from = drawnWidth.current
    stopMorph(element)
    const row = rowOf(element)
    const fit = (): void => {
      if (row && element.classList.contains('trip-countdown')) fitCountdown(element, row, fit)
    }
    fit()
    const to = element.offsetWidth
    drawnWidth.current = to
    // The first answer from main is how things already are, not a change to show.
    if (was === 'starting' || from === null || reducedMotion.matches) return
    morphWidth(element, from, to)
    // Its parts stayed as they were while it eased; fitted to the room once it lands.
    const morph = element.getAnimations().find((animation) => animation.id === 'pill-morph')
    morph?.finished.then(fit, () => undefined)
  }, [ref, shape])
}

/** ⌘F (Ctrl+F on Windows) on the Focus Screen opens the card, with its field taking the keys. */
function useFindKey(onOpen: Open): void {
  const latest = useRef(onOpen)
  useLayoutEffect(() => {
    latest.current = onOpen
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const press = {
        key: event.key,
        code: event.code,
        repeat: event.repeat,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        target: event.target instanceof HTMLElement ? event.target : null
      }
      if (!isFindKey(press)) return
      event.preventDefault()
      latest.current(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
