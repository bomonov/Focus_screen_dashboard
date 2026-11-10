import { MAX_BUS_STOPS } from '../transit/types'
import { MAX_LENGTH_SEC } from '../timer/lengths'
import { CARD_IDS, parseLayout, settleLayout, type CardId, type CardLayout } from './layout'

/** Where the Focus Screen shows up. */
export type ShowOn =
  /** Fullscreen on the first non-main display when one is connected, otherwise a floating window. */
  | { kind: 'auto' }
  /** Fullscreen on one specific display. The label lets us find it again if macOS renumbers ids. */
  | { kind: 'display'; id: number; label: string }
  | { kind: 'floating' }

export interface DisplaySettings {
  showOn: ShowOn
  /** Dim to the clock and album art after this many minutes with no music and no timer; 0 = never. */
  idleDimMinutes: number
  /** Moves the whole layout a few pixels every few minutes, so nothing stays lit in one spot. */
  burnInShift: boolean
  /** Keeps the Focus Screen above other windows on its display. */
  alwaysOnTop: boolean
  /** Hides the pointer once it stops moving over the Focus Screen. */
  hideCursor: boolean
  keepAwake: KeepAwake
}

/**
 * When the screens are kept from sleeping. 'busy' is while music plays or a timer runs: kept
 * awake for good, the Mac would also never lock itself when you walk away.
 */
export type KeepAwake = 'busy' | 'always' | 'never'

/** The Customize screen's theme presets: Sun Devil Night, Maroon & Gold, Daylight, OLED Dim. */
export type ThemePreset = 'night' | 'maroon' | 'day' | 'oled'
/** What sits behind the cards. */
/** "living": the cover's colors drifting slowly behind the cards. */
export type BackgroundMode = 'solid' | 'art' | 'living' | 'photo'

export interface ThemeSettings {
  preset: ThemePreset
  accent: string
  background: BackgroundMode
  /** Takes the accent from the current album cover while a song has one. */
  accentFromArt: boolean
  /** See-through, frosted cards ("liquid glass") on the Focus Screen; best over a picture. */
  glass: boolean
  /** How big the right-click menu is drawn, 1 being its usual size (QUICK_MENU_SCALE). */
  quickMenuScale: number
}

/** Which cards and bars are on the Focus Screen. */
export interface WidgetSettings {
  music: boolean
  todos: boolean
  timer: boolean
  clock: boolean
  /**
   * The next class from the class calendars, in the top bar (macOS). Off until it's turned on,
   * because turning it on asks macOS for calendar access.
   */
  nextClass: boolean
  /** The next Valley Metro bus at the picked stops, in the top bar. Off until it's turned on. */
  nextBus: boolean
  /**
   * The weather where the Mac is, in the top bar (macOS). Off until it's turned on, because
   * turning it on asks macOS for Location.
   */
  weather: boolean
  /**
   * The trip planner's search bubble by Customize (and a kept trip's countdown). Off until it's
   * turned on, because on a Mac its "from where you are" asks macOS for Location.
   */
  trips: boolean
  /** Where each card sits; null is the mockup's arrangement for whichever cards are on. */
  layout: CardLayout | null
}

export interface NextClassSettings {
  /** The calendars that hold classes (EventKit calendar ids); none picked shows nothing. */
  calendars: string[]
  /** Whose buildings the class map knows: ASU's own list, or another school's from OpenStreetMap. */
  school: { name: string; country: string }
}

export interface NextBusSettings {
  /** Stop ids from Valley Metro's schedule (stops.txt), in the order picked. */
  stops: string[]
  /** Only these routes' buses; empty means every route at the picked stops. */
  routes: string[]
  /**
   * The Bus pill's order, set by dragging in its list (route and stop, as the pill keys its
   * pages). Empty: soonest first. Routes not in it come after, soonest first.
   */
  order: string[]
}

export type TemperatureUnit = 'f' | 'c'

export interface WeatherSettings {
  /** How temperatures are shown; they're kept in °C everywhere else. */
  unit: TemperatureUnit
}

export interface TripSettings {
  /** A trip to the next class plans to get there this many whole minutes before it starts. */
  arriveEarlyMin: number
}

export type TimerStyle = 'ring' | 'bar' | 'flip'
/** Count down shows time left; count up shows time spent. Stopwatch always counts up. */
export type TimerDirection = 'down' | 'up'

export interface TimerSettings {
  style: TimerStyle
  direction: TimerDirection
  /** Lengths in whole seconds, 1 s to 23:59:59 (`TIMER_LENGTH_LIMITS`). */
  focusSec: number
  breakSec: number
  countdownSec: number
  /**
   * The same lengths in whole minutes, only so an older build keeps them after a rollback (it
   * reads these and drops the seconds). Always worked out from the seconds; never read while
   * there are seconds.
   */
  focusMinutes: number
  breakMinutes: number
  countdownMinutes: number
  chime: boolean
  autoStartBreaks: boolean
}

/** How fast the record turns while a song plays. */
export type SpinSpeed = 'normal' | 'slow' | 'still'
/** The cover on a spinning record, or the square cover itself, gently animated. */
export type CoverStyle = 'record' | 'animated'
/**
 * Light across the animated cover; its picture never moves. Sheen: a glint of light across it
 * now and then. Sparkle: a few specks drifting up as well. (Its glow behind it is `coverGlow`.)
 */
export type CoverLight = 'none' | 'sheen' | 'sparkle'
/** Synced: the line being sung with the ones around it. Full: the whole text, current line lit. */
export type LyricsStyle = 'synced' | 'full'

/** Which player the music card follows: whichever is playing, or just one (added by Bek). */
export type MusicSource = 'auto' | 'appleMusic' | 'youtube'

export interface MusicSettings {
  source: MusicSource
  /** The YouTube video itself in the card, in place of the cover (Bek's fork). */
  showVideo: boolean
  cover: CoverStyle
  spinSpeed: SpinSpeed
  coverLight: CoverLight
  /**
   * The animated cover's colors glowing softly behind it, its backlight. Off by default: the user
   * asked for it gone, or at least a switch (2026-10-22).
   */
  coverGlow: boolean
  /** Parts of the animated cover moving on their own (wave, hair, sky), where a cover has them. */
  movingParts: boolean
  /** How far those parts move: the user found 1.5 right. It scales distance, never the rhythm. */
  motionStrength: number
  /** The Lyrics button. Off means no lookups at all. */
  showLyrics: boolean
  lyricsStyle: LyricsStyle
  /** "Now playing · Apple Music" rather than just "Now playing". */
  showPlayerName: boolean
  /** Times lyrics LRCLIB only has as plain text, by listening to the song on this Mac. */
  autoSync: boolean
  /** Romaji under Japanese lyrics, from VocaDB, which gets the song's title for it. */
  romaji: boolean
  /**
   * Prepares the paused YouTube Music playlist, muted, while nobody uses the Mac, and stops the
   * moment someone does.
   */
  prepareWhenAway: boolean
  /**
   * Timed lyrics in the cover's colors as they're sung (the user's pick, 2026-11-07), switched in
   * the lyrics box itself. Off: the theme's text color.
   */
  albumInk: boolean
}

/** Keyboard shortcuts that work while another app is in front. */
export interface HotkeySettings {
  enabled: boolean
}

export interface TodoSettings {
  /** Apple Reminders is opt-in: nothing asks macOS for access until it's connected. */
  reminders: boolean
}

export interface Settings {
  version: 1
  display: DisplaySettings
  theme: ThemeSettings
  widgets: WidgetSettings
  timer: TimerSettings
  music: MusicSettings
  hotkeys: HotkeySettings
  todos: TodoSettings
  nextClass: NextClassSettings
  nextBus: NextBusSettings
  weather: WeatherSettings
  trips: TripSettings
}

/**
 * What the Customize screen may change. `todos` isn't here: a source is turned on by
 * connecting it, which goes through its provider, not by flipping a setting.
 */
export interface SettingsPatch {
  display?: Partial<DisplaySettings>
  theme?: Partial<ThemeSettings>
  widgets?: Partial<WidgetSettings>
  timer?: Partial<TimerSettings>
  music?: Partial<MusicSettings>
  hotkeys?: Partial<HotkeySettings>
  nextClass?: Partial<NextClassSettings>
  nextBus?: Partial<NextBusSettings>
  weather?: Partial<WeatherSettings>
  trips?: Partial<TripSettings>
}

export const DEFAULT_ACCENT = '#FFC627'

/** The right-click menu's size, as a share of its usual size (Customize's slider). */
export const QUICK_MENU_SCALE = { min: 0.7, max: 1.2 }

/** Every timer length: 1 second to 23:59:59. */
export const TIMER_LENGTH_LIMITS = { min: 1, max: MAX_LENGTH_SEC } as const

/** The minute limits builds before 2026-10-26 enforced; anything outside them they reset. */
const OLD_MINUTE_LIMITS = {
  focusMinutes: { min: 1, max: 240 },
  breakMinutes: { min: 1, max: 60 },
  countdownMinutes: { min: 1, max: 1440 }
} as const

export const IDLE_DIM_LIMITS = { min: 0, max: 240 } as const

/** How early a class trip may aim to arrive, whole minutes. */
export const ARRIVE_EARLY_LIMITS = { min: 0, max: 30 } as const

export function defaultDisplaySettings(): DisplaySettings {
  return {
    showOn: { kind: 'auto' },
    idleDimMinutes: 5,
    burnInShift: true,
    // A floating window that stays on top covers whatever you're working in.
    alwaysOnTop: false,
    hideCursor: true,
    keepAwake: 'busy'
  }
}

export function defaultThemeSettings(): ThemeSettings {
  return {
    preset: 'night',
    accent: DEFAULT_ACCENT,
    background: 'solid',
    accentFromArt: false,
    glass: false,
    quickMenuScale: 1
  }
}

export function defaultWidgetSettings(): WidgetSettings {
  return {
    music: true,
    todos: true,
    timer: true,
    clock: true,
    nextClass: false,
    nextBus: false,
    weather: false,
    trips: false,
    layout: null
  }
}

export function defaultTimerSettings(): TimerSettings {
  return {
    style: 'ring',
    direction: 'down',
    focusSec: 25 * 60,
    breakSec: 5 * 60,
    countdownSec: 10 * 60,
    focusMinutes: 25,
    breakMinutes: 5,
    countdownMinutes: 10,
    chime: true,
    autoStartBreaks: false
  }
}

/** The moving parts' strength the user picked (2026-10-21), and how far it may be turned. */
export const DEFAULT_MOTION_STRENGTH = 1.5
const MOTION_STRENGTH = { min: 0.5, max: 2.5 }

export function defaultMusicSettings(): MusicSettings {
  return {
    source: 'auto',
    showVideo: true,
    cover: 'record',
    spinSpeed: 'normal',
    coverLight: 'sheen',
    coverGlow: false,
    movingParts: true,
    motionStrength: DEFAULT_MOTION_STRENGTH,
    showLyrics: true,
    lyricsStyle: 'synced',
    showPlayerName: true,
    // It records the music player, so it waits for a yes.
    autoSync: false,
    // Asked for by the user (2026-10-16), title-only requests to VocaDB included.
    romaji: true,
    // It plays and mutes the browser on its own, so it waits for a yes too.
    prepareWhenAway: false,
    albumInk: false
  }
}

export function defaultHotkeySettings(): HotkeySettings {
  return { enabled: true }
}

export function defaultTodoSettings(): TodoSettings {
  return { reminders: false }
}

export function defaultNextBusSettings(): NextBusSettings {
  return { stops: [], routes: [], order: [] }
}

/** °F: the user is in Arizona. */
export function defaultWeatherSettings(): WeatherSettings {
  return { unit: 'f' }
}

/** Five minutes: time to find the room and sit down. */
export function defaultTripSettings(): TripSettings {
  return { arriveEarlyMin: 5 }
}

export function defaultNextClassSettings(): NextClassSettings {
  return { calendars: [], school: { name: 'Arizona State University', country: 'US' } }
}

const MAX_SCHOOL_NAME = 200

function parseSchoolSetting(
  value: unknown,
  base: NextClassSettings['school']
): NextClassSettings['school'] {
  const raw = section(value)
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const country = typeof raw.country === 'string' ? raw.country : ''
  return name && name.length <= MAX_SCHOOL_NAME && /^[A-Z]{2}$/.test(country)
    ? { name, country }
    : base
}

export function defaultSettings(): Settings {
  return {
    version: 1,
    display: defaultDisplaySettings(),
    theme: defaultThemeSettings(),
    widgets: defaultWidgetSettings(),
    timer: defaultTimerSettings(),
    music: defaultMusicSettings(),
    hotkeys: defaultHotkeySettings(),
    todos: defaultTodoSettings(),
    nextClass: defaultNextClassSettings(),
    nextBus: defaultNextBusSettings(),
    weather: defaultWeatherSettings(),
    trips: defaultTripSettings()
  }
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseShowOn(value: unknown, fallback: ShowOn): ShowOn {
  if (!isRecord(value)) return fallback
  switch (value.kind) {
    case 'auto':
      return { kind: 'auto' }
    case 'floating':
      return { kind: 'floating' }
    case 'display':
      if (
        typeof value.id === 'number' &&
        Number.isFinite(value.id) &&
        typeof value.label === 'string'
      ) {
        return { kind: 'display', id: value.id, label: value.label }
      }
      return fallback
    default:
      return fallback
  }
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.find((option) => option === value) ?? fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** A whole number within `limits`; anything else is the fallback. */
function wholeWithin(
  value: unknown,
  limits: { min: number; max: number },
  fallback: number
): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= limits.min &&
    value <= limits.max
    ? value
    : fallback
}

/** A number within `limits`, to the hundredth (a slider's step); anything else is the fallback. */
function hundredths(
  value: unknown,
  limits: { min: number; max: number },
  fallback: number
): number {
  return typeof value === 'number' && value >= limits.min && value <= limits.max
    ? Math.round(value * 100) / 100
    : fallback
}

/** A number held to its limits, in steps of 0.1; anything that isn't a number keeps the fallback. */
function clampedTenths(
  value: unknown,
  limits: { min: number; max: number },
  fallback: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.round(Math.min(Math.max(value, limits.min), limits.max) * 10) / 10
}

function section(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function parseDisplaySettings(value: unknown, base: DisplaySettings): DisplaySettings {
  const raw = section(value)
  return {
    showOn: parseShowOn(raw.showOn, base.showOn),
    idleDimMinutes: wholeWithin(raw.idleDimMinutes, IDLE_DIM_LIMITS, base.idleDimMinutes),
    burnInShift: bool(raw.burnInShift, base.burnInShift),
    alwaysOnTop: bool(raw.alwaysOnTop, base.alwaysOnTop),
    hideCursor: bool(raw.hideCursor, base.hideCursor),
    keepAwake: oneOf(raw.keepAwake, ['busy', 'always', 'never'], base.keepAwake)
  }
}

function parseThemeSettings(value: unknown, base: ThemeSettings): ThemeSettings {
  const raw = section(value)
  return {
    preset: oneOf(raw.preset, ['night', 'maroon', 'day', 'oled'], base.preset),
    accent: typeof raw.accent === 'string' && HEX_COLOR.test(raw.accent) ? raw.accent : base.accent,
    background: oneOf(raw.background, ['solid', 'art', 'living', 'photo'], base.background),
    accentFromArt: bool(raw.accentFromArt, base.accentFromArt),
    glass: bool(raw.glass, base.glass),
    quickMenuScale: hundredths(raw.quickMenuScale, QUICK_MENU_SCALE, base.quickMenuScale)
  }
}

function parseWidgetSettings(
  value: unknown,
  base: WidgetSettings,
  keep: readonly CardId[]
): WidgetSettings {
  const raw = section(value)
  const visible = {
    music: bool(raw.music, base.music),
    todos: bool(raw.todos, base.todos),
    timer: bool(raw.timer, base.timer)
  }
  const layout = raw.layout === null ? null : (parseLayout(raw.layout) ?? base.layout)
  return {
    ...visible,
    clock: bool(raw.clock, base.clock),
    nextClass: bool(raw.nextClass, base.nextClass),
    nextBus: bool(raw.nextBus, base.nextBus),
    weather: bool(raw.weather, base.weather),
    trips: bool(raw.trips, base.trips),
    layout: layout && settleLayout(layout, visible, keep)
  }
}

/**
 * A length in seconds. A file saved before lengths had seconds has only minutes: those are read
 * once (a whole day, the old countdown's longest, becomes 23:59:59). Seconds that are there but
 * invalid fall back to `fallback`, never to the minutes beside them, which are only a rounded copy.
 */
function lengthSec(seconds: unknown, minutes: unknown, fallback: number): number {
  const { min, max } = TIMER_LENGTH_LIMITS
  if (seconds !== undefined) return wholeWithin(seconds, TIMER_LENGTH_LIMITS, fallback)
  const fromMinutes = wholeWithin(minutes, { min: 1, max: Number.MAX_SAFE_INTEGER }, 0) * 60
  return fromMinutes > 0 ? Math.min(Math.max(fromMinutes, min), max) : fallback
}

/** Whole minutes for an older build: rounded, at least 1, within what it accepts. */
function roundedMinutes(seconds: number, limits: { min: number; max: number }): number {
  return Math.min(Math.max(Math.round(seconds / 60), limits.min), limits.max)
}

function parseTimerSettings(value: unknown, base: TimerSettings): TimerSettings {
  const raw = section(value)
  const focusSec = lengthSec(raw.focusSec, raw.focusMinutes, base.focusSec)
  const breakSec = lengthSec(raw.breakSec, raw.breakMinutes, base.breakSec)
  const countdownSec = lengthSec(raw.countdownSec, raw.countdownMinutes, base.countdownSec)
  return {
    style: oneOf(raw.style, ['ring', 'bar', 'flip'], base.style),
    direction: oneOf(raw.direction, ['down', 'up'], base.direction),
    focusSec,
    breakSec,
    countdownSec,
    focusMinutes: roundedMinutes(focusSec, OLD_MINUTE_LIMITS.focusMinutes),
    breakMinutes: roundedMinutes(breakSec, OLD_MINUTE_LIMITS.breakMinutes),
    countdownMinutes: roundedMinutes(countdownSec, OLD_MINUTE_LIMITS.countdownMinutes),
    chime: bool(raw.chime, base.chime),
    autoStartBreaks: bool(raw.autoStartBreaks, base.autoStartBreaks)
  }
}

function parseMusicSettings(value: unknown, base: MusicSettings): MusicSettings {
  const raw = section(value)
  return {
    showVideo: bool(raw.showVideo, base.showVideo),
    source: oneOf(raw.source, ['auto', 'appleMusic', 'youtube'], base.source),
    cover: oneOf(raw.cover, ['record', 'animated'], base.cover),
    spinSpeed: oneOf(raw.spinSpeed, ['normal', 'slow', 'still'], base.spinSpeed),
    // "glow" (the glow alone) was its name before the glow got its own switch.
    coverLight:
      raw.coverLight === 'glow'
        ? 'none'
        : oneOf(raw.coverLight, ['none', 'sheen', 'sparkle'], base.coverLight),
    coverGlow: bool(raw.coverGlow, base.coverGlow),
    movingParts: bool(raw.movingParts, base.movingParts),
    motionStrength: clampedTenths(raw.motionStrength, MOTION_STRENGTH, base.motionStrength),
    showLyrics: bool(raw.showLyrics, base.showLyrics),
    lyricsStyle: oneOf(raw.lyricsStyle, ['synced', 'full'], base.lyricsStyle),
    showPlayerName: bool(raw.showPlayerName, base.showPlayerName),
    autoSync: bool(raw.autoSync, base.autoSync),
    romaji: bool(raw.romaji, base.romaji),
    prepareWhenAway: bool(raw.prepareWhenAway, base.prepareWhenAway),
    albumInk: bool(raw.albumInk, base.albumInk)
  }
}

function parseHotkeySettings(value: unknown, base: HotkeySettings): HotkeySettings {
  const raw = section(value)
  return { enabled: bool(raw.enabled, base.enabled) }
}

/** EventKit ids are well under this; a longer string isn't one. */
const MAX_CALENDAR_ID_CHARS = 600
const MAX_CLASS_CALENDARS = 50

function parseNextClassSettings(value: unknown, base: NextClassSettings): NextClassSettings {
  const raw = section(value)
  const school = parseSchoolSetting(raw.school, base.school)
  if (!Array.isArray(raw.calendars)) return { calendars: base.calendars, school }
  const ids = raw.calendars.filter(
    (id): id is string =>
      typeof id === 'string' && id.length > 0 && id.length <= MAX_CALENDAR_ID_CHARS
  )
  return { calendars: [...new Set(ids)].slice(0, MAX_CLASS_CALENDARS), school }
}

/** GTFS ids are short; a longer string isn't one. */
const MAX_TRANSIT_ID_CHARS = 100
const MAX_BUS_ROUTES = 50
/** Every route at ten stops, near enough. */
const MAX_BUS_ORDER = 60

function transitIds(value: unknown, max: number, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  const ids = value.filter(
    (id): id is string =>
      typeof id === 'string' && id.length > 0 && id.length <= MAX_TRANSIT_ID_CHARS
  )
  return [...new Set(ids)].slice(0, max)
}

function parseNextBusSettings(value: unknown, base: NextBusSettings): NextBusSettings {
  const raw = section(value)
  return {
    stops: transitIds(raw.stops, MAX_BUS_STOPS, base.stops),
    routes: transitIds(raw.routes, MAX_BUS_ROUTES, base.routes),
    order: transitIds(raw.order, MAX_BUS_ORDER, base.order)
  }
}

function parseWeatherSettings(value: unknown, base: WeatherSettings): WeatherSettings {
  const raw = section(value)
  return { unit: raw.unit === 'f' || raw.unit === 'c' ? raw.unit : base.unit }
}

/** A slider's value held to its limits and rounded to a whole minute; a non-number keeps the base. */
function parseTripSettings(value: unknown, base: TripSettings): TripSettings {
  const raw = section(value)
  const early = raw.arriveEarlyMin
  if (typeof early !== 'number' || !Number.isFinite(early))
    return { arriveEarlyMin: base.arriveEarlyMin }
  const { min, max } = ARRIVE_EARLY_LIMITS
  return { arriveEarlyMin: Math.round(Math.min(Math.max(early, min), max)) }
}

function parseTodoSettings(value: unknown, base: TodoSettings): TodoSettings {
  const raw = section(value)
  return { reminders: bool(raw.reminders, base.reminders) }
}

/**
 * Turns whatever is in settings.json into valid Settings. Each field falls back to `base` (the
 * defaults) on its own, so one bad value doesn't wipe the rest of the user's choices. Cards in
 * `keep` hold their spot when a card that comes back on lands on top of them.
 */
export function parseSettings(
  raw: unknown,
  base: Settings = defaultSettings(),
  keep: readonly CardId[] = []
): Settings {
  const root = section(raw)
  return {
    version: 1,
    display: parseDisplaySettings(root.display, base.display),
    theme: parseThemeSettings(root.theme, base.theme),
    widgets: parseWidgetSettings(root.widgets, base.widgets, keep),
    timer: parseTimerSettings(root.timer, base.timer),
    music: parseMusicSettings(root.music, base.music),
    hotkeys: parseHotkeySettings(root.hotkeys, base.hotkeys),
    todos: parseTodoSettings(root.todos, base.todos),
    nextClass: parseNextClassSettings(root.nextClass, base.nextClass),
    nextBus: parseNextBusSettings(root.nextBus, base.nextBus),
    weather: parseWeatherSettings(root.weather, base.weather),
    trips: parseTripSettings(root.trips, base.trips)
  }
}

const PATCHABLE = [
  'display',
  'theme',
  'widgets',
  'timer',
  'music',
  'hotkeys',
  'nextClass',
  'nextBus',
  'weather',
  'trips'
] as const

/**
 * Applies a change sent by the Customize screen. The patch is untrusted: anything that isn't a
 * valid value for its field leaves that field as it was, and `todos` can't be patched at all.
 */
export function applySettingsPatch(current: Settings, patch: unknown): Settings {
  if (!isRecord(patch)) return current
  const merged: Record<string, unknown> = { ...current }
  for (const key of PATCHABLE) {
    const change = patch[key]
    if (isRecord(change)) merged[key] = { ...current[key], ...change }
  }
  // A card turned back on finds room around the ones already showing, not the other way round.
  const showing = CARD_IDS.filter((id) => current.widgets[id])
  return parseSettings(merged, current, showing)
}
