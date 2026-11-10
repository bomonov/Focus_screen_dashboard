import type { WeatherKind } from '../../../main/ipc'

const CLOUD = 'M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 18z'
/** The same cloud, lifted to leave room for rain, snow or lightning under it. */
const HIGH_CLOUD = 'M7 14h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 14z'
/** A smaller cloud low on the right, in front of a sun or moon. */
const FRONT_CLOUD = 'M10 20h8a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1.3A2.9 2.9 0 0 0 10 20z'

function Sun(): React.JSX.Element {
  return (
    <>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
    </>
  )
}

const MOON = 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z'

/** The parts of an icon, each in its own colour class (see Weather.css). */
function shapes(kind: WeatherKind | null, isDay: boolean): React.JSX.Element {
  switch (kind) {
    case 'clear':
      return isDay ? (
        <g className="weather-icon__sun">
          <Sun />
        </g>
      ) : (
        <path className="weather-icon__moon" d={MOON} />
      )
    case 'partlyCloudy':
      return (
        <>
          {isDay ? (
            <g className="weather-icon__sun">
              <circle cx="8.5" cy="8.5" r="3" />
              <path d="M8.5 2.5v1.2M2.5 8.5h1.2M4.3 4.3l.9.9M12.7 4.3l-.9.9M4.3 12.7l.9-.9" />
            </g>
          ) : (
            <path
              className="weather-icon__moon"
              d="M13 9.5A5.5 5.5 0 1 1 7 3.2a4.3 4.3 0 0 0 6 6.3z"
            />
          )}
          <path className="weather-icon__cloud" d={FRONT_CLOUD} />
        </>
      )
    case 'fog':
      return <path className="weather-icon__cloud" d="M4 8h16M6 12h12M4 16h16M8 20h8" />
    case 'rain':
      return (
        <g className="weather-icon__rain">
          <path d={HIGH_CLOUD} />
          <path d="M8 17.5l-1 3M12 17.5l-1 3M16 17.5l-1 3" />
        </g>
      )
    case 'snow':
      return (
        <g className="weather-icon__snow">
          <path d={HIGH_CLOUD} />
          <path d="M8 18v.01M12 18v.01M16 18v.01M10 21v.01M14 21v.01" />
        </g>
      )
    case 'storm':
      return (
        <g className="weather-icon__storm">
          <path d={HIGH_CLOUD} />
          <path d="M12.5 14l-2 4h3l-2 4" />
        </g>
      )
    // Cloudy, or a code we don't know.
    default:
      return <path className="weather-icon__cloud" d={CLOUD} />
  }
}

/** A drawn icon for the weather, in the app's line style; day or night for clear skies. */
export function WeatherIcon({
  kind,
  isDay,
  className
}: {
  kind: WeatherKind | null
  isDay: boolean
  className?: string
}): React.JSX.Element {
  return (
    <svg
      className={['weather-icon', className].filter(Boolean).join(' ')}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes(kind, isDay)}
    </svg>
  )
}
