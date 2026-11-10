import type {
  Settings,
  SettingsPatch,
  TemperatureUnit,
  WeatherCommand,
  WeatherState
} from '../../../main/ipc'
import { useWeather } from '../../hooks/useWeather'
import { PillGroup, Section, ToggleRow, type PillOption } from './controls'

const UNITS: readonly PillOption<TemperatureUnit>[] = [
  { value: 'f', label: '°F' },
  { value: 'c', label: '°C' }
]

const send = (kind: WeatherCommand['kind']): void => window.focusScreen.sendWeatherCommand({ kind })

/**
 * Weather (macOS): the switch, Location for the helper, and °F or °C. Turning it on is what
 * asks macOS for Location, so nobody is asked out of the blue.
 */
export function WeatherSection({
  settings,
  update
}: {
  settings: Settings
  update: (patch: SettingsPatch) => void
}): React.JSX.Element {
  const weather = useWeather()
  const on = settings.widgets.weather
  return (
    <Section title="Weather">
      <div className="customize__rows">
        <ToggleRow
          label="Show weather"
          hint="Where this Mac is, from Location Services, in the top bar"
          on={on}
          onToggle={(next) => update({ widgets: { weather: next } })}
        />
        {on && weather && <LocationRows weather={weather} />}
        {on && (
          <PillGroup
            label="Temperature"
            options={UNITS}
            value={settings.weather.unit}
            onPick={(unit) => update({ weather: { unit } })}
          />
        )}
        {on && weather?.problem && <p className="customize__note">{weather.problem}</p>}
        <p className="customize__hint">
          Weather: Open-Meteo · only a rounded position (about 1 km) is sent, every 15 minutes while
          the Focus Screen shows the weather
        </p>
      </div>
    </Section>
  )
}

/** Where Location stands for the helper, and the way to change it. */
function LocationRows({ weather }: { weather: WeatherState }): React.JSX.Element {
  switch (weather.access) {
    case null:
      return <p className="customize__note">Starting…</p>
    case 'notDetermined':
      return (
        <div className="customize__row">
          <span className="customize__toggle-text">
            <span>Allow Location</span>
            <span className="customize__hint">macOS asks for “Focus Screen Reminders”</span>
          </span>
          <button type="button" className="customize__button" onClick={() => send('requestAccess')}>
            Allow…
          </button>
        </div>
      )
    case 'denied':
    case 'off':
      return (
        <div className="customize__row">
          <span className="customize__toggle-text">
            <span>
              {weather.access === 'off'
                ? 'Location Services is off on this Mac'
                : 'Let Focus Screen see where this Mac is'}
            </span>
            <span className="customize__hint">
              Privacy &amp; Security › Location Services
              {weather.access === 'denied' ? ' › Focus Screen Reminders' : ''}
            </span>
          </span>
          <button
            type="button"
            className="customize__button"
            onClick={() => send('openLocationSettings')}
          >
            Open System Settings
          </button>
        </div>
      )
    case 'restricted':
      return (
        <p className="customize__note">
          Location is blocked on this Mac (by Screen Time or a device profile).
        </p>
      )
    case 'granted':
      return (
        <p className="customize__note">
          {weather.demo ? 'Demo weather' : 'Using this Mac’s location'}
          {weather.place ? ` · ${weather.place}` : ''}
        </p>
      )
  }
}
