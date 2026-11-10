import { useEffect, useRef, useState } from 'react'
import type { TemperatureUnit, WeatherReading } from '../../../main/ipc'
import { useNow } from '../../hooks/useNow'
import { useWeather } from '../../hooks/useWeather'
import type { Box } from '../cardMenu/cardMenuMotion'
import { stageClasses, usePillStage } from '../nextClass/pillStage'
import { useDropToFit } from '../nextClass/useDropToFit'
import { useHoldToOpen } from '../nextClass/useHoldToOpen'
import { WeatherCard } from './WeatherCard'
import { temperature, weatherPillView } from './weatherView'
import { WeatherIcon } from './WeatherIcon'
// The same pill as Next class and Next bus beside it.
import '../nextClass/NextClass.css'
import './Weather.css'

/**
 * The top bar's "☀ 98° · Tempe": the weather where this Mac is. Held down (or Enter), it opens
 * a card with today and the next six hours.
 */
export function WeatherPill({ unit }: { unit: TemperatureUnit }): React.JSX.Element | null {
  const state = useWeather()
  const view = weatherPillView(state, Math.floor(useNow().getTime() / 1000))
  const stage = usePillStage()
  const [card, setCard] = useState<{
    from: Box
    keyboard: boolean
    returnFocus: HTMLElement | null
    /** What it opened on: kept up if the reading goes while it's open. */
    reading: WeatherReading
    place: string | null
  } | null>(null)
  const pill = useRef<HTMLElement | null>(null)
  // Its place goes before any part of the class or bus pills.
  useDropToFit(pill, '.next-class__part', '.next-class__title', true)
  const setPill = (element: HTMLElement | null): void => {
    pill.current = element
  }

  async function open(keyboard: boolean): Promise<void> {
    if (card || view?.kind !== 'reading') return
    const { reading, place } = view
    stage.setOpen('weather')
    // A frame for the row to land, so the card grows out of where the pill ends up.
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const element = pill.current
    if (!element) {
      stage.closed('weather')
      return
    }
    setCard({ from: stage.finalBox(element), keyboard, returnFocus: element, reading, place })
  }
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  })
  const canOpen = view?.kind === 'reading'
  const { register } = stage
  useEffect(
    () => (canOpen ? register('weather', () => void openRef.current(false)) : undefined),
    [canOpen, register]
  )
  const hold = useHoldToOpen((keyboard) => void open(keyboard), !canOpen || card !== null)

  // Kept on screen till it has shrunk back, with the newest reading while there is one.
  const shown = card && (
    <WeatherCard
      reading={view?.kind === 'reading' ? view.reading : card.reading}
      place={view?.kind === 'reading' ? view.place : card.place}
      unit={unit}
      from={card.from}
      keyboard={card.keyboard}
      returnFocus={card.returnFocus}
      onPressOutside={stage.pressAt}
      onClosed={() => {
        setCard(null)
        stage.closed('weather')
      }}
    />
  )
  if (!view) return shown || null
  const staged = stageClasses(stage, 'weather')

  if (view.kind !== 'reading') {
    const text = view.kind === 'setup' ? view.text : 'Weather unavailable'
    const action = view.kind === 'setup' ? view.action : 'retry'
    return (
      <>
        <button
          ref={setPill}
          type="button"
          className={['next-class', 'next-class--setup', 'weather', ...staged].join(' ')}
          title={action === 'retry' ? 'Click to try again' : undefined}
          data-pill="weather"
          onClick={() => window.focusScreen.sendWeatherCommand({ kind: action })}
        >
          <WeatherIcon kind={null} isDay className="pill-icon weather__icon" />
          <span className="weather__setup-text">{text}</span>
        </button>
        {shown}
      </>
    )
  }

  const { reading, place } = view
  const classes = ['next-class', 'weather', ...staged]
  if (hold.pressing) classes.push('next-class--pressing')
  if (card) classes.push('next-class--open')
  return (
    <>
      <button
        ref={setPill}
        type="button"
        className={classes.join(' ')}
        title={[reading.words, place, 'Hold to see today'].filter(Boolean).join(' · ')}
        aria-haspopup="dialog"
        aria-expanded={card !== null}
        data-pill="weather"
        {...hold.handlers}
      >
        <WeatherIcon
          kind={reading.kind}
          isDay={reading.isDay}
          className="pill-icon weather__icon"
        />
        <span className="next-class__title">{temperature(reading.tempC, unit)}</span>
        {place && <span className="next-class__part">{place}</span>}
      </button>
      {shown}
    </>
  )
}
