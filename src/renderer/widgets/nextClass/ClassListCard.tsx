import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ClassEvent } from '../../../main/ipc'
import type { Box } from '../cardMenu/cardMenuMotion'
import { timeFormat } from '../clockFormat'
import { PencilIcon } from '../icons'
import { PeekCard, type PeekCardHandle } from '../peek/PeekCard'
import { ClassPlace } from './ClassPlace'
import { askPlaces, dropPin, placeLabel, shownPlace, type ShownPlace } from './classPlaces'
import { classLength, type ClassWeekDay, type ClassWeekRow } from './classWeek'
import type { RowTags } from './dueTags'
import { MORPH_EASING } from './pillMorph'
import { useHoldToOpen } from './useHoldToOpen'
import './ClassMapCard.css'
import './ClassListCard.css'

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

/** The list turning into a class's map, and back. */
const SWAP_MS = 280
/** How far the incoming view slides in from, in rem. */
const SLIDE_REM = 1.5
const TITLE = 'Your classes this week'

const timeAt = (epochSec: number): string => timeFormat.format(new Date(epochSec * 1000))

/** The map a held row turned the card into. */
interface Shown {
  place: ShownPlace
  heading: string
  location: string
  id: string
}

/** The week's classes' places: those asked as the list opened, asked again as classes change. */
function usePlaces(
  locations: readonly string[],
  first: ReadonlyMap<string, ShownPlace | null>
): ReadonlyMap<string, ShownPlace | null> {
  const key = [...new Set(locations)].join('\n')
  const [places, setPlaces] = useState(first)
  useEffect(() => {
    let live = true
    void askPlaces(key.split('\n')).then((answers) => {
      if (live) setPlaces(answers)
    })
    return () => {
      live = false
    }
  }, [key])
  return places
}

interface ClassRowProps {
  row: ClassWeekRow
  color: string | null
  /** It meets somewhere with a map card: held (or Enter), it shows it. */
  canHold: boolean
  /** The user's own homework and exams for this class due soon, on its next meeting only. */
  tags: RowTags | undefined
  buttonRef(button: HTMLButtonElement | null): void
  onHold(keyboard: boolean): void
}

function ClassRow({
  row,
  color,
  canHold,
  tags,
  buttonRef,
  onHold
}: ClassRowProps): React.JSX.Element {
  const hold = useHoldToOpen(onHold, !canHold)
  const { event } = row
  const classes = ['class-list__row']
  if (row.past) classes.push('class-list__row--past')
  if (row.lit) classes.push('class-list__row--lit')
  if (hold.pressing) classes.push('class-list__row--pressing')
  const parts = (
    <>
      <span
        className="class-list__dot"
        style={color ? { background: color } : undefined}
        aria-hidden="true"
      />
      <span className="class-list__what">
        <span className="class-list__name">{event.title || 'Class'}</span>
        {event.location && <span className="class-list__room">{event.location}</span>}
        {tags && (
          <span className="class-list__tags">
            {tags.shown.map((tag) => (
              <span
                key={tag.id}
                className={`class-list__tag class-list__tag--${tag.kind}${tag.overdue ? ' class-list__tag--overdue' : ''}`}
              >
                {tag.kind === 'homework' && <PencilIcon />}
                <span className="class-list__tag-text">{tag.text}</span>
              </span>
            ))}
            {tags.more > 0 && <span className="class-list__tag-more">+{tags.more} more</span>}
          </span>
        )}
      </span>
      <span className="class-list__when">
        <span className="class-list__time">{timeAt(event.start)}</span>
        <span className="class-list__length">
          {classLength(Math.round((event.end - event.start) / 60))}
        </span>
      </span>
    </>
  )
  return (
    <li className={classes.join(' ')} aria-current={row.lit ? 'true' : undefined}>
      {canHold ? (
        <button
          ref={buttonRef}
          type="button"
          className="class-list__button"
          title="Hold to see where it is"
          aria-haspopup="dialog"
          {...hold.handlers}
        >
          {parts}
        </button>
      ) : (
        // Online, or nowhere to show: nothing to hold for, so not a button.
        <div className="class-list__button">{parts}</div>
      )}
    </li>
  )
}

interface ClassListCardProps {
  /** Today through a week on, by day (`classWeek`). */
  days: readonly ClassWeekDay[]
  /** Where their locations are, asked before the list opened (`askPlaces`). */
  places: ReadonlyMap<string, ShownPlace | null>
  /** A class's calendar color for its dot, or null for the accent. */
  colorOf(event: ClassEvent): string | null
  /** What's nearly due for each class's next meeting, by event id (`dueTags`). */
  tags?: ReadonlyMap<string, RowTags>
  /** The pill's box: the card grows out of it and shrinks back into it. */
  from: Box
  keyboard: boolean
  returnFocus: HTMLElement | null
  onPressOutside?(x: number, y: number): void
  onClosed(): void
}

/**
 * The week's classes, by day, on a card that drops from the Next class pill (a double-click,
 * the user's idea): today's that are over dimmed, the pill's lit. Held (or Enter), a row turns
 * the card into that class's map, the same as the pill's own card; "Week" or Esc turns it back.
 */
export function ClassListCard({
  days,
  places: firstPlaces,
  colorOf,
  tags,
  from,
  keyboard,
  returnFocus,
  onPressOutside,
  onClosed
}: ClassListCardProps): React.JSX.Element {
  const cardRef = useRef<PeekCardHandle>(null)
  const viewsRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const focusRef = useRef<HTMLButtonElement | null>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const openRef = useRef<HTMLButtonElement>(null)
  const pinRef = useRef<HTMLSpanElement>(null)
  const pulseRef = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState<Shown | null>(null)
  /** Before the card turns: how tall it was and which way the new view comes in. */
  const turning = useRef<{ height: number; way: 1 | -1; keyboard: boolean } | null>(null)
  /** The list's scroll and the row whose map it was, to come back to. */
  const left = useRef<{ scroll: number; id: string } | null>(null)
  const asked = useRef(0)
  const places = usePlaces(
    days.flatMap((day) => day.rows.map((row) => row.event.location)),
    firstPlaces
  )

  const canHold = (row: ClassWeekRow): boolean => places.get(row.event.location) != null
  const rows = days.flatMap((day) => day.rows)
  // Opened from the keyboard, it starts on the pill's class, else the next one.
  const focusId =
    (
      rows.find((row) => row.lit && canHold(row)) ??
      rows.find((row) => !row.past && canHold(row)) ??
      rows.find(canHold)
    )?.event.id ?? null

  async function showPlace(row: ClassWeekRow, day: string, keyboard: boolean): Promise<void> {
    const ask = ++asked.current
    // Asked again as it opens: the map may have been made since the list asked.
    const place = shownPlace(await window.focusScreen.getClassPlace(row.event.location))
    if (ask !== asked.current || !place) return
    turning.current = { height: viewsRef.current?.offsetHeight ?? 0, way: 1, keyboard }
    left.current = { scroll: scrollerRef.current?.scrollTop ?? 0, id: row.event.id }
    setShown({
      place,
      heading: `${row.event.title || 'Class'} · ${day} ${timeAt(row.event.start)}`,
      location: row.event.location,
      id: row.event.id
    })
  }

  function back(): void {
    asked.current += 1
    turning.current = { height: viewsRef.current?.offsetHeight ?? 0, way: -1, keyboard: false }
    setShown(null)
  }

  // The card turned: the new view slides in as the card's height eases to it, the pin drops,
  // and the focus lands where it should (the map's button, or back on the row it came from).
  useLayoutEffect(() => {
    const turn = turning.current
    if (!turn) return
    turning.current = null
    let stopPin: (() => void) | undefined
    if (shown) {
      if (turn.keyboard) (openRef.current ?? backRef.current)?.focus({ preventScroll: true })
      stopPin = dropPin(pinRef.current, pulseRef.current)
    } else if (left.current) {
      const { scroll, id } = left.current
      left.current = null
      if (scrollerRef.current) scrollerRef.current.scrollTop = scroll
      buttons.current.get(id)?.focus({ preventScroll: true })
    }
    const views = viewsRef.current
    const view = views?.firstElementChild
    if (!views || !(view instanceof HTMLElement) || reducedMotion.matches) return stopPin
    const timing = { duration: SWAP_MS, easing: MORPH_EASING }
    views.classList.add('class-list__views--turning')
    const grow = views.animate(
      [{ height: `${turn.height}px` }, { height: `${views.offsetHeight}px` }],
      timing
    )
    grow.onfinish = () => views.classList.remove('class-list__views--turning')
    const slide = view.animate(
      [{ transform: `translateX(${turn.way * SLIDE_REM}rem)`, opacity: 0 }, { opacity: 1 }],
      timing
    )
    return () => {
      stopPin?.()
      grow.cancel()
      slide.cancel()
      views.classList.remove('class-list__views--turning')
    }
  }, [shown])

  return (
    <PeekCard
      handle={cardRef}
      className="class-list"
      label={shown ? placeLabel(shown.place, shown.heading) : TITLE}
      from={from}
      keyboard={keyboard}
      focus={focusRef}
      returnFocus={returnFocus}
      onPressOutside={onPressOutside}
      onEscape={() => {
        if (!shown) return false
        back()
        return true
      }}
      onClosed={onClosed}
    >
      <div ref={viewsRef} className="class-list__views">
        {shown ? (
          <div key={shown.id} className="class-list__view">
            <button
              ref={backRef}
              type="button"
              className="class-list__back"
              aria-label="Back to the week"
              onClick={back}
            >
              <span className="class-list__back-pill">
                <svg viewBox="0 0 8 14" aria-hidden="true">
                  <path d="M6.5 1.5 1.5 7l5 5.5" />
                </svg>
                Week
              </span>
            </button>
            <ClassPlace
              place={shown.place}
              heading={shown.heading}
              location={shown.location}
              pinRef={pinRef}
              pulseRef={pulseRef}
              buttonRef={openRef}
              onOpened={() => cardRef.current?.close()}
            />
          </div>
        ) : (
          <div className="class-list__view">
            <p className="peek-card__heading class-list__heading">{TITLE}</p>
            {days.length === 0 ? (
              <p className="class-list__empty">No classes in the next week</p>
            ) : (
              <div ref={scrollerRef} className="class-list__days">
                {days.map((day) => (
                  <section key={day.day} className="class-list__day">
                    <h3 className="class-list__day-name">
                      <span className="class-list__day-when">{day.name}</span> {day.date}
                    </h3>
                    <ol className="class-list__rows">
                      {day.rows.map((row) => (
                        <ClassRow
                          key={row.event.id}
                          row={row}
                          color={colorOf(row.event)}
                          canHold={canHold(row)}
                          tags={tags?.get(row.event.id)}
                          buttonRef={(button) => {
                            const { id } = row.event
                            if (button) buttons.current.set(id, button)
                            else buttons.current.delete(id)
                            if (id === focusId) focusRef.current = button
                          }}
                          onHold={(keyboard) => void showPlace(row, day.name, keyboard)}
                        />
                      ))}
                    </ol>
                  </section>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </PeekCard>
  )
}
