import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type {
  BusRouteBus,
  BusRouteInfo,
  BusRouteLive,
  BusRouteOther,
  MapSpot
} from '../../../main/ipc'
import type { Box } from '../cardMenu/cardMenuMotion'
import { MORPH_EASING, MORPH_SEC } from '../nextClass/pillMorph'
import type { SwipeHandlers } from '../nextClass/usePillSwipe'
import { PeekCard, type PeekCardHandle } from '../peek/PeekCard'
import { PIN_DROP, PIN_DROP_TIMING, PULSE, PULSE_TIMING } from '../peek/pinMotion'
import { BusIcon } from './BusIcon'
import './BusRouteCard.css'

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

/** The path is drawn in a 1000-wide box with the map's shape. */
const VIEW_WIDTH = 1000
/** Arrows along the path, this far apart, sliding this fast toward where the bus goes. */
const ARROW_GAP = 64
const ARROW_SPEED = 40
/** A long route runs far off the map: past this many, the arrows spread out instead. */
const MAX_ARROWS = 90
/** How long the card waits for the bus's first position before saying there's none. */
const FIND_BUS_MS = 4000
/** How far a swiped-to route's map and words come in from, the way the swipe went. */
const PAGE_IN_PX = 32

interface BusRouteCardProps {
  handle?: React.Ref<PeekCardHandle>
  info: BusRouteInfo
  /**
   * The pill was swiped to another route and its map is on the way: the old one steps out of
   * sight meanwhile, so it doesn't spring back into place first.
   */
  paging?: boolean
  /** Which side a swiped-to route comes in from: 1 the right ('next'), -1 the left. */
  enter?: number
  /** The pill's swipe, carried on over the card. */
  gestures?: SwipeHandlers
  /** "4 min", "Due": the pill's own countdown. */
  when: string
  /** The pill's box: the card grows out of it and shrinks back into it. */
  from: Box
  keyboard: boolean
  returnFocus: HTMLElement | null
  onPressOutside?(x: number, y: number): void
  onClosed(): void
}

/**
 * Where the card's bus is, and the route's other buses going the same way, while the card is
 * open: main reads Vehicle Locations till it closes.
 */
function useCardBus(arrivalId: string): {
  bus: BusRouteBus | null
  others: BusRouteOther[]
  looked: boolean
} {
  const [live, setLive] = useState<BusRouteLive | null>(null)
  const [looked, setLooked] = useState(false)
  useEffect(() => {
    const unsubscribe = window.focusScreen.onBusMoved(setLive)
    window.focusScreen.watchBus(arrivalId)
    const wait = setTimeout(() => setLooked(true), FIND_BUS_MS)
    return () => {
      clearTimeout(wait)
      unsubscribe()
      window.focusScreen.watchBus(null)
    }
  }, [arrivalId])
  // A card swiped to another route shows none of the last one's buses meanwhile.
  const mine = live?.arrivalId === arrivalId ? live : null
  return { bus: mine?.bus ?? null, others: mine?.others ?? [], looked }
}

/**
 * The card's own bus, gliding from one reported spot to the next. Waiting at the stop, it sits
 * beside the pin (on the side with more room) rather than on top of it.
 */
function CardBus({ bus, stop }: { bus: BusRouteBus; stop: MapSpot }): React.JSX.Element {
  const waiting = bus.coming && bus.atStop
  const [x, y] = waiting ? stop : bus.at
  const classes = ['bus-route__bus']
  if (!bus.coming) classes.push('bus-route__bus--past')
  if (waiting) classes.push(stop[0] > 0.6 ? 'bus-route__bus--wait-left' : 'bus-route__bus--wait')
  return (
    <span className={classes.join(' ')} style={{ left: `${x * 100}%`, top: `${y * 100}%` }}>
      <BusIcon className="bus-route__bus-icon" />
    </span>
  )
}

/**
 * A coming bus's route, on a card grown out of the held Bus pill: the map around its path, the
 * stretch it comes along dimmer and the stretch it goes on to bright, arrows sliding the way it
 * goes, a pin on the stop, and (from Valley Metro's Vehicle Locations) the bus itself.
 */
export function BusRouteCard({
  handle,
  info,
  paging = false,
  enter = 1,
  gestures,
  when,
  from,
  keyboard,
  returnFocus,
  onPressOutside,
  onClosed
}: BusRouteCardProps): React.JSX.Element {
  const pinRef = useRef<HTMLSpanElement>(null)
  const pulseRef = useRef<HTMLSpanElement>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const pathRef = useRef<SVGPathElement>(null)
  const [length, setLength] = useState(0)
  const { bus, others, looked } = useCardBus(info.arrivalId)
  const pathId = `bus-route-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`

  const height = VIEW_WIDTH / info.aspect
  const point = ([x, y]: MapSpot): string =>
    `${(x * VIEW_WIDTH).toFixed(1)},${(y * height).toFixed(1)}`
  const points = (spots: MapSpot[]): string => spots.map(point).join(' ')
  // The whole way, for the arrows to slide along: up to the stop, then on.
  const whole = [...info.behind, ...info.ahead.slice(1)]
  const wholePath = whole.length > 1 ? `M${whole.map(point).join('L')}` : ''

  useLayoutEffect(() => {
    setLength(pathRef.current?.getTotalLength() ?? 0)
  }, [wholePath])

  // Swiped to another route while open: it comes in the way the swipe went, its pin dropping.
  const shownRoute = useRef(info.arrivalId)
  const enterRef = useRef(enter)
  useLayoutEffect(() => {
    enterRef.current = enter
  })
  useLayoutEffect(() => {
    if (shownRoute.current === info.arrivalId) return
    shownRoute.current = info.arrivalId
    if (reducedMotion.matches) return
    for (const part of [mapRef.current, textRef.current]) {
      part?.animate(
        [
          { transform: `translateX(${enterRef.current * PAGE_IN_PX}px)`, opacity: 0 },
          { transform: 'none', opacity: 1 }
        ],
        { duration: MORPH_SEC * 1000, easing: MORPH_EASING }
      )
    }
    pinRef.current?.animate(PIN_DROP, PIN_DROP_TIMING)
    const pulse = pulseRef.current?.animate(PULSE, PULSE_TIMING)
    return () => pulse?.cancel()
  }, [info.arrivalId])

  // Still arrows for anyone who'd rather not see them move.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !reducedMotion.matches) return
    svg.setCurrentTime(0)
    svg.pauseAnimations()
  }, [length])

  const count = Math.min(MAX_ARROWS, Math.floor(length / ARROW_GAP))
  const seconds = length / ARROW_SPEED
  // Light rail and the streetcar come this way too: the words fit a train as well as a bus.
  const liveText = bus
    ? !bus.coming
      ? 'Already past this stop'
      : bus.atStop
        ? `Waiting at ${info.stopName}`
        : 'Live position from Valley Metro'
    : !info.live || looked
      ? 'No live position right now'
      : 'Finding where it is…'

  return (
    <PeekCard
      handle={handle}
      gestures={gestures}
      className="bus-route"
      label={`${info.route}${info.headsign ? ` to ${info.headsign}` : ''}, from ${info.stopName}`}
      from={from}
      keyboard={keyboard}
      returnFocus={returnFocus}
      onPressOutside={onPressOutside}
      onClosed={onClosed}
      onPlaced={() => {
        if (reducedMotion.matches) return
        pinRef.current?.animate(PIN_DROP, PIN_DROP_TIMING)
        const pulse = pulseRef.current?.animate(PULSE, PULSE_TIMING)
        return () => pulse?.cancel()
      }}
    >
      <>
        <div
          ref={mapRef}
          className={`peek-card__map bus-route__map${paging ? ' bus-route--paging' : ''}`}
          style={{ aspectRatio: info.aspect }}
        >
          {info.picture && (
            <img className="peek-card__image" src={info.picture} alt="" draggable={false} />
          )}
          <svg
            ref={svgRef}
            className="bus-route__lines"
            viewBox={`0 0 ${VIEW_WIDTH} ${height.toFixed(1)}`}
            aria-hidden="true"
          >
            <polyline className="bus-route__casing" points={points(whole)} />
            <polyline className="bus-route__behind" points={points(info.behind)} />
            <polyline className="bus-route__ahead" points={points(info.ahead)} />
            <path ref={pathRef} id={pathId} d={wholePath} fill="none" stroke="none" />
            {count > 0 &&
              Array.from({ length: count }, (_, index) => (
                <g key={index} className="bus-route__arrow">
                  <path d="M-6 -7 L4 0 L-6 7" className="bus-route__arrow-shade" />
                  <path d="M-6 -7 L4 0 L-6 7" />
                  <animateMotion
                    dur={`${seconds.toFixed(2)}s`}
                    begin={`${(-(index * seconds) / count).toFixed(2)}s`}
                    repeatCount="indefinite"
                    rotate="auto"
                  >
                    <mpath href={`#${pathId}`} />
                  </animateMotion>
                </g>
              ))}
          </svg>
          {/* Under the pin: one passing the stop doesn't hide it. */}
          {others.map((other) => (
            <span
              key={other.id}
              className="bus-route__bus bus-route__bus--other"
              style={{ left: `${other.at[0] * 100}%`, top: `${other.at[1] * 100}%` }}
            >
              <BusIcon className="bus-route__bus-icon" />
            </span>
          ))}
          <span
            className="map-spot"
            style={{ left: `${info.stop[0] * 100}%`, top: `${info.stop[1] * 100}%` }}
          >
            <span ref={pulseRef} className="map-pulse" />
            <span ref={pinRef} className="map-pin" />
          </span>
          {bus && <CardBus bus={bus} stop={info.stop} />}
        </div>
        <div ref={textRef} className={`peek-card__text${paging ? ' bus-route--paging' : ''}`}>
          <p className="peek-card__heading">{info.stopName}</p>
          <p className="peek-card__title">{info.route}</p>
          <p className="peek-card__detail">
            {[info.headsign && `to ${info.headsign}`, when].filter(Boolean).join(' · ')}
          </p>
          <p className={`bus-route__live${bus ? ' bus-route__live--on' : ''}`}>{liveText}</p>
        </div>
      </>
    </PeekCard>
  )
}
