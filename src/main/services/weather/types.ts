// The weather pill's data, shared by main, preload and renderer through ipc.ts. Temperatures
// are °C everywhere; the renderer turns them into the user's unit as it draws them.

/** What an icon can show; day or night is separate. */
export type WeatherKind = 'clear' | 'partlyCloudy' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm'

/** Location Services for the helper; 'off' is Location Services turned off for the whole Mac. */
export type LocationAccess = 'granted' | 'denied' | 'restricted' | 'notDetermined' | 'off'

export interface LatLon {
  lat: number
  lon: number
}

export interface WeatherHour {
  /** The hour's start, epoch seconds. */
  at: number
  tempC: number
  kind: WeatherKind | null
  isDay: boolean
}

export interface Forecast {
  tempC: number
  feelsLikeC: number
  /** Today's, in the place's own time zone. */
  highC: number
  lowC: number
  kind: WeatherKind | null
  /** "Sunny", "Light rain"; null for a code we don't know. */
  words: string | null
  isDay: boolean
  /** Whole hours from the one under way, for 24 hours: the card picks the next six. */
  hours: WeatherHour[]
}

export interface WeatherReading extends Forecast {
  /** When it was read, epoch seconds: an hour later it's too old to show. */
  readAt: number
}

export interface WeatherState {
  /** False with no location source (not a Mac, or the helper isn't built) and no demo. */
  supported: boolean
  /** null while weather is off or the helper hasn't said. */
  access: LocationAccess | null
  place: string | null
  reading: WeatherReading | null
  /** Plain words for Customize after a failed read; null once one works. */
  problem: string | null
  demo: boolean
}

export type WeatherCommand =
  /** The pill clicked while the weather couldn't be read. */
  | { kind: 'retry' }
  /** macOS's Location prompt, if it hasn't been answered. */
  | { kind: 'requestAccess' }
  /** System Settings › Privacy & Security › Location Services. */
  | { kind: 'openLocationSettings' }
