// Every IPC channel and payload type lives here, shared by main, preload and renderer.
// Keep this file free of runtime imports: the sandboxed preload bundles it.
import type {
  CalendarCommand,
  CalendarState,
  ClassPlaceInfo,
  School,
  SchoolCommand,
  SchoolState
} from './services/calendar/types'
import type { DisplayChoice, PhotoResult, ScreenCare } from './services/display/types'
import type { HotkeyState } from './services/hotkeys/types'
import type { AutoSyncState, PrepareCommand, PrepareState } from './services/autosync/types'
import type {
  CoverEditorCommand,
  CoverEditorState,
  CoverMotionState
} from './services/cover-motion/types'
import type { LyricsPickerCommand, LyricsPickerState } from './services/lyrics/pickerTypes'
import type { ColorEditorCommand, ColorEditorState } from './services/lyrics/singers/editorTypes'
import type { LyricsCommand, LyricsState } from './services/lyrics/types'
import type { MusicCommand, PlaybackState } from './services/music/types'
import type { CardId } from './services/settings/layout'
import type { Settings, SettingsPatch } from './services/settings/schema'
import type { CardMenu, CardStatuses } from './services/status/types'
import type { TimerCommand, TimerCompletion, TimerLength, TimerState } from './services/timer/types'
import type {
  BusRouteInfo,
  BusRouteLive,
  TransitCommand,
  TransitState,
  TransitStop
} from './services/transit/types'
import type {
  CanvasFormRequest,
  CanvasFormResult,
  HomeworkFormOpen,
  HomeworkRequest,
  HomeworkResult,
  TodoCommand,
  TodoConnectForm,
  TodoState
} from './services/todos/types'
import type { Place, TripCommand, TripState } from './services/trips/types'
import type { WeatherCommand, WeatherState } from './services/weather/types'

export type {
  CalendarAccess,
  CalendarCommand,
  CalendarInfo,
  CalendarState,
  ClassMapPicture,
  ClassPlaceInfo,
  ClassEvent,
  GoogleCalendarStatus,
  School,
  SchoolCommand,
  SchoolState
} from './services/calendar/types'
export type { DisplayChoice, PhotoResult, ScreenCare } from './services/display/types'
export type { HotkeyAction, HotkeyState, HotkeyStatus } from './services/hotkeys/types'
export type {
  AutoSyncProblem,
  AutoSyncState,
  PlaylistKind,
  PrepareBlocker,
  PrepareCommand,
  PrepareEnd,
  PrepareState
} from './services/autosync/types'
export type {
  Lyrics,
  LyricsColors,
  LyricsCommand,
  LyricsSource,
  LyricsState,
  LyricsStatus,
  RomajiSource,
  SyncedLine,
  SyncedWord
} from './services/lyrics/types'
export type {
  MusicCommand,
  MusicProblem,
  PlaybackState,
  PlayerId,
  RepeatMode,
  Track,
  UpNext
} from './services/music/types'
export type {
  BackgroundMode,
  CoverLight,
  CoverStyle,
  DisplaySettings,
  HotkeySettings,
  KeepAwake,
  LyricsStyle,
  MusicSettings,
  NextBusSettings,
  NextClassSettings,
  Settings,
  SettingsPatch,
  ShowOn,
  SpinSpeed,
  TemperatureUnit,
  ThemePreset,
  ThemeSettings,
  TimerDirection,
  TimerSettings,
  TimerStyle,
  WeatherSettings,
  WidgetSettings
} from './services/settings/schema'
export type {
  ClassPlace,
  HomePreview,
  Place,
  TripCommand,
  TripFrom,
  TripPlan,
  TripRide,
  TripState,
  TripStep,
  TripWhen
} from './services/trips/types'
export type { CardId, CardLayout, CardVisibility, GridRect } from './services/settings/layout'
export type {
  LocationAccess,
  WeatherCommand,
  WeatherHour,
  WeatherKind,
  WeatherReading,
  WeatherState
} from './services/weather/types'
export type { CoverRecipe, MotionKind, RecipePart } from './services/cover-motion/recipe'
export type {
  LyricsPickerCommand,
  LyricsPickerState,
  PickerRow,
  PickerTag
} from './services/lyrics/pickerTypes'
export type {
  ColorEditorCommand,
  ColorEditorState,
  ListenState
} from './services/lyrics/singers/editorTypes'
export type {
  CodedLine,
  CodedWord,
  ColorEdit,
  ShownLine,
  SingerRef,
  SongColors
} from './services/lyrics/singers/types'
export type {
  CoverEditorCommand,
  CoverEditorState,
  CoverMotionState,
  CoverScene,
  ScenePart
} from './services/cover-motion/types'
export type {
  CardMenu,
  CardMenuEntry,
  CardStatus,
  CardStatuses,
  StatusTone
} from './services/status/types'
export type {
  PomodoroPhase,
  TimerCommand,
  TimerCompletion,
  TimerLength,
  TimerMode,
  TimerState,
  TimerStatus
} from './services/timer/types'
export type {
  BusArrival,
  BusRouteBus,
  BusRouteInfo,
  BusRouteLive,
  BusRouteOther,
  MapSpot,
  ShuttleService,
  TransitCommand,
  TransitRoute,
  TransitState,
  TransitStop
} from './services/transit/types'
export type {
  CanvasFormField,
  CanvasFormRequest,
  CanvasFormResult,
  ExamItem,
  HomeworkEntry,
  HomeworkFormOpen,
  HomeworkInput,
  HomeworkKind,
  HomeworkRequest,
  HomeworkResult,
  TodoCommand,
  TodoConnectForm,
  TodoConnection,
  TodoDue,
  TodoItem,
  TodoProblem,
  TodoSourceId,
  TodoSourceState,
  TodoState
} from './services/todos/types'

/** What a right-click landed on, when it has its own items above the quick menu's. */
export interface QuickMenuTarget {
  /** One of the user's own homeworks or exams, by its id: Edit… and Delete. */
  kind: 'homework'
  id: string
}

/** Where the Focus Screen is right now, for the top bar's "Display 2 · Focus Screen" pill. */
export interface PlacementInfo {
  kind: 'fullscreen' | 'floating'
  /** "Display 2" or "Floating window" */
  label: string
}

export const IpcChannel = {
  settingsGet: 'settings:get',
  settingsChanged: 'settings:changed',
  settingsUpdate: 'settings:update',
  placementGet: 'display:get-placement',
  placementChanged: 'display:placement-changed',
  displayChoicesGet: 'display:get-choices',
  displayChoicesChanged: 'display:choices-changed',
  screenCareGet: 'display:get-screen-care',
  screenCareChanged: 'display:screen-care-changed',
  displayActivity: 'display:activity',
  layoutEditingGet: 'display:get-layout-editing',
  layoutEditingChanged: 'display:layout-editing-changed',
  layoutEditingSet: 'display:set-layout-editing',
  backgroundPhotoGet: 'display:get-background-photo',
  backgroundPhotoChoose: 'display:choose-background-photo',
  backgroundPhotoChanged: 'display:background-photo-changed',
  hotkeysGet: 'hotkeys:get',
  hotkeysChanged: 'hotkeys:changed',
  customizeOpen: 'customize:open',
  customizeClose: 'customize:close',
  timerGet: 'timer:get',
  timerChanged: 'timer:changed',
  timerCommand: 'timer:command',
  timerChime: 'timer:chime',
  timerEditLength: 'timer:edit-length',
  timerEditTake: 'timer:edit-take',
  timerHaptic: 'timer:haptic',
  musicGet: 'music:get',
  musicChanged: 'music:changed',
  musicCommand: 'music:command',
  musicOpenAutomationSettings: 'music:open-automation-settings',
  musicPairBrowser: 'music:pair-browser',
  lyricsGet: 'lyrics:get',
  lyricsChanged: 'lyrics:changed',
  lyricsCommand: 'lyrics:command',
  autosyncGet: 'autosync:get',
  autosyncChanged: 'autosync:changed',
  autosyncOpenSettings: 'autosync:open-settings',
  prepareGet: 'prepare:get',
  prepareChanged: 'prepare:changed',
  prepareCommand: 'prepare:command',
  todosGet: 'todos:get',
  todosChanged: 'todos:changed',
  todosCommand: 'todos:command',
  todosConnectForm: 'todos:connect-form',
  todosCanvasForm: 'todos:canvas-form',
  todosHomework: 'todos:homework',
  todosHomeworkForm: 'todos:homework-form',
  calendarGet: 'calendar:get',
  calendarChanged: 'calendar:changed',
  calendarCommand: 'calendar:command',
  calendarPlace: 'calendar:place',
  calendarOpenMap: 'calendar:open-map',
  schoolGet: 'school:get',
  schoolChanged: 'school:changed',
  schoolSearch: 'school:search',
  schoolCommand: 'school:command',
  transitGet: 'transit:get',
  transitChanged: 'transit:changed',
  transitSearch: 'transit:search',
  transitCommand: 'transit:command',
  transitRoute: 'transit:route',
  transitWatch: 'transit:watch',
  transitBus: 'transit:bus',
  weatherGet: 'weather:get',
  weatherChanged: 'weather:changed',
  weatherCommand: 'weather:command',
  tripsGet: 'trips:get',
  tripsChanged: 'trips:changed',
  tripsCommand: 'trips:command',
  tripsSearch: 'trips:search',
  tripsSearchApple: 'trips:search-apple',
  statusGet: 'status:get',
  statusChanged: 'status:changed',
  statusCardMenu: 'status:card-menu',
  statusCardMenuPick: 'status:card-menu-pick',
  quickMenu: 'menu:quick',
  coverMotionGet: 'cover-motion:get',
  coverMotionChanged: 'cover-motion:changed',
  coverEditorGet: 'cover-editor:get',
  coverEditorChanged: 'cover-editor:changed',
  coverEditorCommand: 'cover-editor:command',
  lyricsPickerGet: 'lyrics-picker:get',
  lyricsPickerChanged: 'lyrics-picker:changed',
  lyricsPickerCommand: 'lyrics-picker:command',
  lyricsColorsGet: 'lyrics-colors:get',
  lyricsColorsChanged: 'lyrics-colors:changed',
  lyricsColorsCommand: 'lyrics-colors:command'
} as const

/** Renderer → main requests that return a value (ipcRenderer.invoke / ipcMain.handle). */
export interface InvokeChannels {
  [IpcChannel.settingsGet]: { args: []; result: Settings }
  [IpcChannel.placementGet]: { args: []; result: PlacementInfo }
  [IpcChannel.displayChoicesGet]: { args: []; result: DisplayChoice[] }
  [IpcChannel.screenCareGet]: { args: []; result: ScreenCare }
  [IpcChannel.layoutEditingGet]: { args: []; result: boolean }
  [IpcChannel.backgroundPhotoGet]: { args: []; result: string | null }
  [IpcChannel.backgroundPhotoChoose]: { args: []; result: PhotoResult }
  [IpcChannel.hotkeysGet]: { args: []; result: HotkeyState }
  [IpcChannel.timerGet]: { args: []; result: TimerState }
  /** The waiting "Set on the Timer Card…" request, if any; taking it clears it. */
  [IpcChannel.timerEditTake]: { args: []; result: TimerLength | null }
  [IpcChannel.musicGet]: { args: []; result: PlaybackState }
  [IpcChannel.lyricsGet]: { args: []; result: LyricsState }
  [IpcChannel.autosyncGet]: { args: []; result: AutoSyncState }
  [IpcChannel.prepareGet]: { args: []; result: PrepareState }
  [IpcChannel.todosGet]: { args: []; result: TodoState }
  [IpcChannel.todosCanvasForm]: { args: [CanvasFormRequest]; result: CanvasFormResult }
  [IpcChannel.todosHomework]: { args: [HomeworkRequest]; result: HomeworkResult }
  [IpcChannel.calendarGet]: { args: []; result: CalendarState }
  /** A class's location: the ASU building and its map; null when that can't be known. */
  [IpcChannel.calendarPlace]: { args: [string]; result: ClassPlaceInfo | null }
  [IpcChannel.schoolGet]: { args: []; result: SchoolState }
  /** Schools in the bundled list matching what was typed. */
  [IpcChannel.schoolSearch]: { args: [string]; result: School[] }
  [IpcChannel.transitGet]: { args: []; result: TransitState }
  [IpcChannel.weatherGet]: { args: []; result: WeatherState }
  [IpcChannel.tripsGet]: { args: []; result: TripState }
  /** The Mac's own places matching what was typed. */
  [IpcChannel.tripsSearch]: { args: [string]; result: Place[] }
  /** Apple's places for what was typed (the text only goes to Apple, never a position). */
  [IpcChannel.tripsSearchApple]: { args: [string]; result: Place[] }
  [IpcChannel.coverMotionGet]: { args: []; result: CoverMotionState }
  [IpcChannel.coverEditorGet]: { args: []; result: CoverEditorState }
  [IpcChannel.lyricsPickerGet]: { args: []; result: LyricsPickerState }
  [IpcChannel.lyricsColorsGet]: { args: []; result: ColorEditorState }
  /** Stops in the stop list matching what was typed. */
  [IpcChannel.transitSearch]: { args: [string]; result: TransitStop[] }
  /** A coming bus's route card (an arrival's id); null when it's gone or has no path. */
  [IpcChannel.transitRoute]: { args: [string]; result: BusRouteInfo | null }
  [IpcChannel.statusGet]: { args: []; result: CardStatuses }
  /** null when the request isn't from the Focus Screen. */
  [IpcChannel.statusCardMenu]: { args: [CardId]; result: CardMenu | null }
  /** The right-click menu, as glass-menu data; null when the request isn't from the Focus Screen. */
  [IpcChannel.quickMenu]: { args: [QuickMenuTarget | null]; result: CardMenu | null }
}

/** Renderer → main fire-and-forget messages (ipcRenderer.send / ipcMain.on). */
export interface SendChannels {
  [IpcChannel.settingsUpdate]: [SettingsPatch]
  [IpcChannel.displayActivity]: []
  [IpcChannel.layoutEditingSet]: [boolean]
  [IpcChannel.customizeOpen]: []
  [IpcChannel.customizeClose]: []
  [IpcChannel.timerCommand]: [TimerCommand]
  /** The trackpad's tick for the length wheels (`TimerHaptic`). */
  [IpcChannel.timerHaptic]: [TimerHaptic]
  [IpcChannel.musicCommand]: [MusicCommand]
  [IpcChannel.musicOpenAutomationSettings]: []
  [IpcChannel.musicPairBrowser]: []
  [IpcChannel.lyricsCommand]: [LyricsCommand]
  [IpcChannel.autosyncOpenSettings]: []
  [IpcChannel.prepareCommand]: [PrepareCommand]
  [IpcChannel.todosCommand]: [TodoCommand]
  [IpcChannel.calendarCommand]: [CalendarCommand]
  /** A place answer's mapKey (or null): opens ASU's map, or Apple Maps at the building. */
  [IpcChannel.calendarOpenMap]: [string | null]
  [IpcChannel.schoolCommand]: [SchoolCommand]
  [IpcChannel.transitCommand]: [TransitCommand]
  [IpcChannel.weatherCommand]: [WeatherCommand]
  [IpcChannel.tripsCommand]: [TripCommand]
  [IpcChannel.coverEditorCommand]: [CoverEditorCommand]
  [IpcChannel.lyricsPickerCommand]: [LyricsPickerCommand]
  /** Only the Color-Code Lyrics window may send these; main drops them from any other page. */
  [IpcChannel.lyricsColorsCommand]: [ColorEditorCommand]
  /** The route card opened on this arrival, or closed (null): bus positions are read between. */
  [IpcChannel.transitWatch]: [string | null]
  /** The menu's token and the picked entry's id. */
  [IpcChannel.statusCardMenuPick]: [number, string]
}

/**
 * What the length wheels tell main for the trackpad's tick: they opened ('warm'), or one landed
 * on 0 ('tick', or 'firm' when it came fast).
 */
export type TimerHaptic = 'warm' | 'tick' | 'firm'

/** Main → renderer pushes (webContents.send / ipcRenderer.on). */
export interface EventChannels {
  [IpcChannel.settingsChanged]: Settings
  [IpcChannel.placementChanged]: PlacementInfo
  [IpcChannel.displayChoicesChanged]: DisplayChoice[]
  [IpcChannel.screenCareChanged]: ScreenCare
  [IpcChannel.layoutEditingChanged]: boolean
  [IpcChannel.backgroundPhotoChanged]: string | null
  [IpcChannel.hotkeysChanged]: HotkeyState
  [IpcChannel.timerChanged]: TimerState
  /** A run just ended and the chime setting is on: the renderer plays the sound. */
  [IpcChannel.timerChime]: TimerCompletion
  /**
   * A Timer menu's "Set on the Timer Card…" is waiting: the card takes it (`takeTimerEdit`),
   * which it also does as it mounts, since a window opened for it isn't listening yet.
   */
  [IpcChannel.timerEditLength]: TimerLength
  [IpcChannel.musicChanged]: PlaybackState
  [IpcChannel.lyricsChanged]: LyricsState
  [IpcChannel.autosyncChanged]: AutoSyncState
  [IpcChannel.prepareChanged]: PrepareState
  [IpcChannel.todosChanged]: TodoState
  /** A Connect button or menu item for a source that signs in with a form in the card. */
  [IpcChannel.todosConnectForm]: TodoConnectForm
  /** The right-click menu's Edit…: the Focus Screen's To-do card opens its homework form. */
  [IpcChannel.todosHomeworkForm]: HomeworkFormOpen
  [IpcChannel.calendarChanged]: CalendarState
  [IpcChannel.schoolChanged]: SchoolState
  [IpcChannel.transitChanged]: TransitState
  [IpcChannel.weatherChanged]: WeatherState
  [IpcChannel.tripsChanged]: TripState
  /** The playing cover's moving parts (or none). */
  [IpcChannel.coverMotionChanged]: CoverMotionState
  /** The moving parts editor in Customize. */
  [IpcChannel.coverEditorChanged]: CoverEditorState
  [IpcChannel.lyricsPickerChanged]: LyricsPickerState
  /** Sent to the Color-Code Lyrics window only. */
  [IpcChannel.lyricsColorsChanged]: ColorEditorState
  /** Where the open route card's bus is; null when it isn't known. Focus Screen only. */
  [IpcChannel.transitBus]: BusRouteLive | null
  [IpcChannel.statusChanged]: CardStatuses
}

/** Everything the preload exposes to the renderer as `window.focusScreen`. */
export interface FocusScreenApi {
  getSettings(): Promise<Settings>
  onSettingsChanged(listener: (settings: Settings) => void): () => void
  /** A Customize screen change; main checks every field before saving it. */
  updateSettings(patch: SettingsPatch): void
  getPlacement(): Promise<PlacementInfo>
  onPlacementChanged(listener: (placement: PlacementInfo) => void): () => void
  /** The Customize screen's "Show on" buttons. */
  getDisplayChoices(): Promise<DisplayChoice[]>
  onDisplayChoicesChanged(listener: (choices: DisplayChoice[]) => void): () => void
  /** Idle dim and burn-in shift for the Focus Screen. */
  getScreenCare(): Promise<ScreenCare>
  onScreenCareChanged(listener: (care: ScreenCare) => void): () => void
  /** The mouse moved or something was clicked on the Focus Screen: wake it from idle dim. */
  reportActivity(): void
  /** True while the cards on the Focus Screen are being moved and resized. */
  getLayoutEditing(): Promise<boolean>
  onLayoutEditingChanged(listener: (editing: boolean) => void): () => void
  /** Starts or ends arranging the cards; starting brings the Focus Screen up. */
  setLayoutEditing(on: boolean): void
  /** The saved background photo as a data URL, or null. */
  getBackgroundPhoto(): Promise<string | null>
  /** Opens a file dialog and keeps a copy of the chosen picture. */
  chooseBackgroundPhoto(): Promise<PhotoResult>
  onBackgroundPhotoChanged(listener: (photo: string | null) => void): () => void
  /** The global hotkeys, and which ones another app already has. */
  getHotkeys(): Promise<HotkeyState>
  onHotkeysChanged(listener: (hotkeys: HotkeyState) => void): () => void
  /** Opens the Customize window, or brings it forward. */
  openCustomize(): void
  /** Closes the window this page is in (the Customize window's Done button). */
  closeCustomize(): void
  getTimer(): Promise<TimerState>
  onTimerChanged(listener: (timer: TimerState) => void): () => void
  onTimerChime(listener: (completion: TimerCompletion) => void): () => void
  onTimerEditLength(listener: (length: TimerLength) => void): () => void
  takeTimerEdit(): Promise<TimerLength | null>
  sendTimerCommand(command: TimerCommand): void
  timerHaptic(what: TimerHaptic): void
  getMusic(): Promise<PlaybackState>
  onMusicChanged(listener: (music: PlaybackState) => void): () => void
  sendMusicCommand(command: MusicCommand): void
  /** Opens System Settings at Privacy & Security → Automation (macOS). */
  openAutomationSettings(): void
  /** Shows a pairing code for the YouTube Music browser extension. */
  pairBrowser(): void
  getLyrics(): Promise<LyricsState>
  onLyricsChanged(listener: (lyrics: LyricsState) => void): () => void
  /** Show/hide lyrics (saved in settings) and the per-song timing. */
  sendLyricsCommand(command: LyricsCommand): void
  /** Timing lyrics LRCLIB only has as plain text: whether it can, and what it's doing. */
  getAutoSync(): Promise<AutoSyncState>
  onAutoSyncChanged(listener: (state: AutoSyncState) => void): () => void
  /** Opens System Settings where Focus Screen Audio is allowed to hear other apps. */
  openAudioCaptureSettings(): void
  /** Preparing a playlist: YouTube Music plays it muted while songs that need timing get timed. */
  getPrepare(): Promise<PrepareState>
  onPrepareChanged(listener: (state: PrepareState) => void): () => void
  sendPrepareCommand(command: PrepareCommand): void
  getCoverMotion(): Promise<CoverMotionState>
  onCoverMotionChanged(listener: (state: CoverMotionState) => void): () => void
  getCoverEditor(): Promise<CoverEditorState>
  onCoverEditorChanged(listener: (state: CoverEditorState) => void): () => void
  sendCoverEditorCommand(command: CoverEditorCommand): void
  /** "Pick Other Lyrics…": the song's LRCLIB versions to choose from, opened from the menus. */
  getLyricsPicker(): Promise<LyricsPickerState>
  onLyricsPickerChanged(listener: (state: LyricsPickerState) => void): () => void
  sendLyricsPickerCommand(command: LyricsPickerCommand): void
  /** The Color-Code Lyrics window's session: the song's coding, waveform and what can be undone. */
  getLyricsColorEditor(): Promise<ColorEditorState>
  onLyricsColorEditorChanged(listener: (state: ColorEditorState) => void): () => void
  sendLyricsColorEditorCommand(command: ColorEditorCommand): void
  getTodos(): Promise<TodoState>
  onTodosChanged(listener: (todos: TodoState) => void): () => void
  /** Check-offs, refresh, and starting or cancelling a source's sign-in. */
  sendTodoCommand(command: TodoCommand): void
  /** Main asks the card to show a source's connect form. */
  onTodoConnectForm(listener: (form: TodoConnectForm) => void): () => void
  /** The Canvas form: connect with a token or the calendar feed, or open a help page. */
  sendCanvasForm(request: CanvasFormRequest): Promise<CanvasFormResult>
  /** The user's own homework and exams: add, edit, delete (main checks each and asks first). */
  sendHomework(request: HomeworkRequest): Promise<HomeworkResult>
  /** Main asks the card to open its homework form, filled in to edit. */
  onHomeworkForm(listener: (form: HomeworkFormOpen) => void): () => void
  /** Next class: the calendars, access, and the classes from today through a week on. */
  getCalendar(): Promise<CalendarState>
  /** Where a class meets (its ASU building and map), for the card held open from the pill. */
  getClassPlace(location: string): Promise<ClassPlaceInfo | null>
  /** Opens the building's map: ASU's campus map, or Apple Maps; ASU's map page without one. */
  openClassMap(mapKey: string | null): void
  onCalendarChanged(listener: (state: CalendarState) => void): () => void
  sendCalendarCommand(command: CalendarCommand): void
  /** The school whose buildings Next class's map knows, and its map's state. */
  getSchool(): Promise<SchoolState>
  onSchoolChanged(listener: (state: SchoolState) => void): () => void
  searchSchools(query: string): Promise<School[]>
  sendSchoolCommand(command: SchoolCommand): void
  /** Next bus: the stop list, the picked stops, and Valley Metro's coming buses. */
  getTransit(): Promise<TransitState>
  onTransitChanged(listener: (state: TransitState) => void): () => void
  searchBusStops(query: string): Promise<TransitStop[]>
  sendTransitCommand(command: TransitCommand): void
  /** Held Bus pill: the coming bus's path on the map; null when it has none. */
  getBusRoute(arrivalId: string): Promise<BusRouteInfo | null>
  /** The route card opened (or closed, null): its bus's position is pushed in between. */
  watchBus(arrivalId: string | null): void
  onBusMoved(listener: (live: BusRouteLive | null) => void): () => void
  /** The weather pill: where this Mac is (its town only) and Open-Meteo's forecast there. */
  getWeather(): Promise<WeatherState>
  onWeatherChanged(listener: (state: WeatherState) => void): () => void
  /** Retry, macOS's Location prompt, or System Settings' Location Services page. */
  sendWeatherCommand(command: WeatherCommand): void
  /** The trip card: where to, the trips planned, the one kept (nothing here is a position). */
  getTrips(): Promise<TripState>
  onTripsChanged(listener: (state: TripState) => void): () => void
  sendTripCommand(command: TripCommand): void
  /** The Mac's own places (buildings, stops, saved) matching the text. */
  searchPlaces(text: string): Promise<Place[]>
  /** Apple's places matching the text; none when there's no helper. */
  searchApplePlaces(text: string): Promise<Place[]>
  /** Each card's status dot: green connected, red needs a look, grey nothing to connect. */
  getCardStatuses(): Promise<CardStatuses>
  onCardStatusesChanged(listener: (statuses: CardStatuses) => void): () => void
  /** A dot was clicked: that card's menu, its status lines on top, for the glass menu to show. */
  getCardMenu(card: CardId): Promise<CardMenu | null>
  /** A right-click on the Focus Screen: the quick menu, for the glass menu to show. */
  getQuickMenu(target: QuickMenuTarget | null): Promise<CardMenu | null>
  /** Runs a picked entry of the menu `getCardMenu` or `getQuickMenu` gave (by its token). */
  pickCardMenu(token: number, id: string): void
  /**
   * Where a dropped file is on disk (the window can't tell: Electron answers). It's only ever
   * handed back to main as the place to read a picture from, and main checks it there.
   */
  pathForFile(file: File): string
}
