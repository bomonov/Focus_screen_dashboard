import type { TemperatureUnit, WeatherReading } from '../../../main/ipc'
import { useNow } from '../../hooks/useNow'
import type { Box } from '../cardMenu/cardMenuMotion'
import { PeekCard } from '../peek/PeekCard'
import { nextHours, temperature } from './weatherView'
import { WeatherIcon } from './WeatherIcon'
import './WeatherCard.css'

/** "3 PM", or "15" where the clock is 24-hour (the system's own format, like the top bar's). */
const hourFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric' })

interface WeatherCardProps {
  reading: WeatherReading
  place: string | null
  unit: TemperatureUnit
  /** The pill's box: the card grows out of it and shrinks back into it. */
  from: Box
  /** Opened with the keyboard: the card itself gets the focus. */
  keyboard: boolean
  returnFocus: HTMLElement | null
  onPressOutside?(x: number, y: number): void
  onClosed(): void
}

/** Today where this Mac is, on a card grown out of the weather pill (mockup B). */
export function WeatherCard({
  reading,
  place,
  unit,
  from,
  keyboard,
  returnFocus,
  onPressOutside,
  onClosed
}: WeatherCardProps): React.JSX.Element {
  const hours = nextHours(reading.hours, Math.floor(useNow().getTime() / 1000))
  const degrees = (celsius: number): string => temperature(celsius, unit)

  return (
    <PeekCard
      className="weather-card"
      label={place ? `Weather in ${place}` : 'Weather'}
      from={from}
      keyboard={keyboard}
      returnFocus={returnFocus}
      onPressOutside={onPressOutside}
      onClosed={onClosed}
    >
      <>
        <div className="weather-card__now">
          <WeatherIcon kind={reading.kind} isDay={reading.isDay} className="weather-card__icon" />
          <span className="weather-card__temp">{degrees(reading.tempC)}</span>
          <div className="weather-card__words">
            {reading.words && <span className="weather-card__condition">{reading.words}</span>}
            <span>Feels like {degrees(reading.feelsLikeC)}</span>
            <span>
              High {degrees(reading.highC)} · Low {degrees(reading.lowC)}
            </span>
          </div>
        </div>
        {hours.length > 0 && (
          <ol className="weather-card__hours" aria-label="The next hours">
            {hours.map((hour) => (
              <li key={hour.at} className="weather-card__hour">
                <span className="weather-card__hour-label">
                  {hourFormat.format(new Date(hour.at * 1000))}
                </span>
                <WeatherIcon
                  kind={hour.kind}
                  isDay={hour.isDay}
                  className="weather-card__hour-icon"
                />
                <span className="weather-card__hour-temp">{degrees(hour.tempC)}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="weather-card__credit">Weather: Open-Meteo</p>
      </>
    </PeekCard>
  )
}
