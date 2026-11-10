import { useRef } from 'react'
import type { Box } from '../cardMenu/cardMenuMotion'
import { PeekCard, type PeekCardHandle } from '../peek/PeekCard'
import { ClassPlace } from './ClassPlace'
import { dropPin, placeLabel, type ShownPlace } from './classPlaces'
import './ClassMapCard.css'

interface ClassMapCardProps {
  place: ShownPlace
  /** "BIO 181 · 9:00 AM" */
  heading: string
  /** The calendar's own words, shown when ASU's list doesn't know the room. */
  location: string
  /** The pill's box: the card grows out of it and shrinks back into it. */
  from: Box
  /** Opened with the keyboard: the button gets the focus. */
  keyboard: boolean
  returnFocus: HTMLElement | null
  onPressOutside?(x: number, y: number): void
  onClosed(): void
}

/**
 * Where the next class is: a piece of the campus map with a pin on the building, its name and
 * room, and a way to ASU's own map, on a card grown out of the Next class pill.
 */
export function ClassMapCard({
  place,
  heading,
  location,
  from,
  keyboard,
  returnFocus,
  onPressOutside,
  onClosed
}: ClassMapCardProps): React.JSX.Element {
  const pinRef = useRef<HTMLSpanElement>(null)
  const pulseRef = useRef<HTMLSpanElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const cardRef = useRef<PeekCardHandle>(null)

  return (
    <PeekCard
      handle={cardRef}
      className="class-map"
      label={placeLabel(place, heading)}
      from={from}
      keyboard={keyboard}
      focus={buttonRef}
      returnFocus={returnFocus}
      onPressOutside={onPressOutside}
      onClosed={onClosed}
      onPlaced={() => dropPin(pinRef.current, pulseRef.current)}
    >
      <ClassPlace
        place={place}
        heading={heading}
        location={location}
        pinRef={pinRef}
        pulseRef={pulseRef}
        buttonRef={buttonRef}
        onOpened={() => cardRef.current?.close()}
      />
    </PeekCard>
  )
}
