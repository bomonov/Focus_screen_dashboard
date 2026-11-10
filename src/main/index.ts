import { spawn } from 'child_process'
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  nativeImage,
  nativeTheme,
  powerMonitor,
  powerSaveBlocker,
  session,
  shell,
  type MenuItemConstructorOptions
} from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { IpcChannel, type CardMenu, type EventChannels, type TimerState } from './ipc'
import { handle, handleFrom, on, sendEvent } from './ipcRoutes'
import {
  installAppMenu,
  cardMenuItems,
  quickMenuItems,
  popupEditMenu,
  type MenuContext
} from './menu'
import {
  alignerScriptPath,
  coverMotionScriptPath,
  audioHelperPath,
  autosyncSamplesDir,
  isDev,
  remindersHelperPath
} from './paths'
import { isMac } from './platform'
import { denyAllPermissions, hardenContents } from './security'
import { calendarHelper } from './services/calendar/helper'
import { parseCalendarCommand, parseSchoolCommand } from './services/calendar/parse'
import { BUILDINGS_URL } from './services/calendar/campus'
import { createClassMapService } from './services/calendar/classMap'
import { OVERPASS_URL } from './services/calendar/osmCampus'
import { createSchoolMaps } from './services/calendar/schoolMap'
import { createSchoolStatus } from './services/calendar/schoolStatus'
import { makeMapPicture } from './services/calendar/mapPicture'
import { createGoogleCalendar } from './services/calendar/google'
import { createCalendarService } from './services/calendar/service'
import { openBackgroundPhoto } from './services/display/backgroundPhoto'
import { createFocusWindowController } from './services/display/controller'
import { createCustomizeWindowController } from './services/display/customizeWindow'
import { createKeepAwake } from './services/display/keepAwake'
import { createLyricsEditorWindowController } from './services/display/lyricsEditorWindow'
import { createSongCapture, type SongCapture } from './services/autosync/capture'
import { createAlignerClient } from './services/autosync/aligner'
import { createAudioHelperClient, type AudioHelperClient } from './services/autosync/client'
import { createFollowClient } from './services/autosync/follow'
import { alignerWorker, audioHelper } from './services/autosync/helper'
import { createAwayPreparer } from './services/autosync/away'
import { createPrepareService, parsePrepareCommand } from './services/autosync/prepare'
import { coverFingerprint, coverKey, squareCover } from './services/cover-motion/coverKey'
import { coverWorker } from './services/cover-motion/helper'
import { createCoverMotionService, parseCoverEditorCommand } from './services/cover-motion/service'
import { createCoverStore } from './services/cover-motion/store'
import { createSongRecording, SAMPLE_RATE } from './services/autosync/recording'
import { saveSample } from './services/autosync/samples'
import { createAutoSyncService } from './services/autosync/service'
import { openAutoSyncedStore } from './services/autosync/store'
import { clearWavs } from './services/autosync/wav'
import { createScreenCare } from './services/display/screenCare'
import { createHotkeyService } from './services/hotkeys/service'
import { toArtworkDataUrl } from './services/music/artwork'
import { createExtensionAdapter } from './services/music/extension-ws/adapter'
import { createMusicAdapters } from './services/music/factory'
import { createMockMusicAdapter } from './services/music/mock/adapter'
import { parseMusicCommand } from './services/music/parse'
import { createMusicService } from './services/music/service'
import type { PlayerId } from './services/music/types'
import { fetchBinary, fetchJson, fetchText, requestJson } from './services/http'
import { openLyricsCache } from './services/lyrics/cache'
import { createLrclibProvider, LRCLIB_MAX_BYTES, LRCLIB_TIMEOUT_MS } from './services/lyrics/lrclib'
import { createSongLyrics } from './services/lyrics/chain'
import {
  openRomajiStore,
  savedRomajiStamp,
  savedRomanizations
} from './services/lyrics/romajiStore'
import { createRomajiMaker } from './services/lyrics/madeRomaji/client'
import { forkMaker } from './services/lyrics/madeRomaji/process'
import { openLearnedReadings, openMadeRomajiStore } from './services/lyrics/madeRomaji/store'
import romajiMakerPath from './services/lyrics/madeRomaji/worker?modulePath'
import { createVocadb, VOCADB_MAX_BYTES, VOCADB_TIMEOUT_MS } from './services/lyrics/vocadb'
import { createDemoLyricsProvider } from './services/lyrics/mock/provider'
import { openOffsetStore } from './services/lyrics/offsets'
import { openPickStore } from './services/lyrics/picks'
import { createLyricsPicker, parseLyricsPickerCommand } from './services/lyrics/picker'
import { parseLyricsCommand } from './services/lyrics/parse'
import { createLyricsService } from './services/lyrics/service'
import { createColorEditor } from './services/lyrics/singers/editor'
import { canColorCode, mayRunFromEditor } from './services/lyrics/singers/editorAccess'
import { parseColorEditorCommand } from './services/lyrics/singers/editorCommand'
import { openSingerPictures } from './services/lyrics/singers/pictures'
import { openSongColorsStore } from './services/lyrics/singers/store'
import { noTapNote, openSingerTap } from './services/lyrics/singers/tap'
import { safeStorageEncryptor } from './services/secrets/safeStorage'
import { openSecretStore } from './services/secrets/store'
import { CARD_IDS } from './services/settings/layout'
import { applySettingsPatch, type ThemePreset } from './services/settings/schema'
import { openSettingsStore } from './services/settings/store'
import { parseTimerCommand } from './services/timer/parse'
import { remindersHelper } from './services/todos/apple-reminders/helper'
import { createRemindersProvider } from './services/todos/apple-reminders/provider'
import { cardMenuEntries } from './services/status/cardMenu'
import { createStatusService } from './services/status/service'
import { createHaptics } from './services/timer/haptics'
import { createPendingEdit } from './services/timer/pendingEdit'
import { createTimerService } from './services/timer/service'
import { createBusRouteService } from './services/transit/busRoute'
import { demoFeed, demoStopList, demoVehicles } from './services/transit/mock'
import { parseTransitCommand } from './services/transit/parse'
import { createTransitService } from './services/transit/service'
import { makeRouteMapPicture } from './services/transit/routePicture'
import {
  createValleyMetroFeed,
  createValleyMetroVehicles,
  downloadSchedule
} from './services/transit/valleyMetro'
import { locationHelper } from './services/weather/helper'
import { helperLocation } from './services/weather/location'
import { demoLocation, demoWeather } from './services/weather/mock'
import { createOpenMeteo } from './services/weather/openMeteo'
import { parseWeatherCommand } from './services/weather/parse'
import { createWeatherService } from './services/weather/service'
import { sharedLocation } from './services/weather/sharedLocation'
import { createApplePlaces } from './services/trips/applePlaces'
import { createTripPlanner } from './services/trips/client'
import { buildingPlaces } from './services/trips/localSearch'
import { demoTrips } from './services/trips/mock'
import { nextClassPlace } from './services/trips/nextClass'
import { parseTripCommand } from './services/trips/parse'
import { openPlaces } from './services/trips/places'
import { placesHelper } from './services/trips/placesHelper'
import { forkPlanner } from './services/trips/process'
import { createTripService } from './services/trips/service'
import tripWorkerPath from './services/trips/worker?modulePath'
import { confirmCanvasDisconnect } from './services/todos/canvas/dialogs'
import { openFeedMarks } from './services/todos/canvas/feedMarks'
import { handleCanvasForm } from './services/todos/canvas/form'
import {
  CANVAS_FEED_MAX_BYTES,
  CANVAS_MAX_BYTES,
  CANVAS_TIMEOUT_MS,
  createCanvasProvider
} from './services/todos/canvas/provider'
import {
  chooseGoogleClientFile,
  confirmGoogleCalendarDisconnect,
  confirmGoogleDisconnect,
  connectGoogleCalendar,
  connectGoogleTasks
} from './services/todos/google/connectDialogs'
import { listenForRedirect } from './services/todos/google/loopback'
import {
  createGoogleTasksProvider,
  GOOGLE_MAX_BYTES,
  GOOGLE_TIMEOUT_MS
} from './services/todos/google/provider'
import { createMockTodoProviders } from './services/todos/mock/provider'
import { openHomeworkBook } from './services/todos/homework/book'
import { confirmHomeworkDelete } from './services/todos/homework/dialogs'
import { createHomeworkProvider } from './services/todos/homework/provider'
import { homeworkMenuItems } from './services/todos/homework/menu'
import { handleHomeworkRequest } from './services/todos/homework/requests'
import {
  parseCanvasFormRequest,
  parseHomeworkRequest,
  parseHomeworkTarget,
  parseTodoCommand
} from './services/todos/parse'
import { createTodoService } from './services/todos/service'
import { createAppTray, type AppTray, type TrayContext } from './tray'

/** Coming back to the window re-reads the to-do list unless it's fresher than this. */
const FOCUS_REFRESH_MIN_AGE_SEC = 30
/**
 * Before preparing a playlist while nobody's there, the browser is listened to this long; below
 * this level (16-bit RMS; music runs in the thousands) it counts as quiet.
 */
const QUIET_CHECK_MS = 2000
const QUIET_LEVEL = 30

/** Daylight is the one light theme; native menus, dialogs and title bars follow it. */
function nativeThemeFor(preset: ThemePreset): 'light' | 'dark' {
  return preset === 'day' ? 'light' : 'dark'
}

/** Opens a page of System Settings › Privacy & Security, e.g. "Privacy_Reminders". */
function openPrivacyPane(anchor: string, label: string): void {
  shell
    .openExternal(`x-apple.systempreferences:com.apple.preference.security?${anchor}`)
    .catch((error: unknown) => console.warn(`[${label}] Could not open System Settings.`, error))
}

function start(): void {
  denyAllPermissions(session.defaultSession)

  const userData = app.getPath('userData')
  const settings = openSettingsStore(join(userData, 'settings.json'))
  nativeTheme.themeSource = nativeThemeFor(settings.get().theme.preset)
  const timer = createTimerService({ filePath: join(userData, 'timer.json'), settings })
  const secrets = openSecretStore(join(userData, 'secrets.json'), safeStorageEncryptor)
  const focus = createFocusWindowController(settings)
  const customize = createCustomizeWindowController(focus)
  const lyricsEditor = createLyricsEditorWindowController(focus)
  const screenCare = createScreenCare({ settings })
  const backgroundPhoto = openBackgroundPhoto(join(userData, 'background.jpg'))
  // YouTube Music in Chrome or Safari, through our extension; works the same on every OS.
  const youtubeMusic = createExtensionAdapter({ secrets })
  const music = createMusicService({
    // On a tie (both paused, neither played yet this run), a YouTube Music tab someone opened
    // says more than a music app that's merely running.
    adapters: [youtubeMusic, ...createMusicAdapters()],
    // Dev builds only: a full screen without opening a music app. Never shipped to users.
    demo: isDev ? createMockMusicAdapter() : null,
    toArtwork: toArtworkDataUrl
  })
  // Which player the card follows (Customize › Music › Plays from), added by Bek.
  const playersFor = (source: string): PlayerId[] | null =>
    source === 'appleMusic'
      ? ['appleMusic']
      : source === 'youtube'
        ? ['ytmChrome', 'ytmSafari']
        : null
  music.setAllowedPlayers?.(playersFor(settings.get().music.source))
  const lrclib = createLrclibProvider((url) =>
    fetchJson(url, { maxBytes: LRCLIB_MAX_BYTES, timeoutMs: LRCLIB_TIMEOUT_MS })
  )
  // Lyrics only for songs LRCLIB hasn't got at all (mostly Vocaloid and related Japanese
  // songs), and romaji for Japanese songs whoever has their lyrics. It gets the title only.
  const vocadb = createVocadb((url) =>
    fetchJson(url, { maxBytes: VOCADB_MAX_BYTES, timeoutMs: VOCADB_TIMEOUT_MS })
  )
  const songLyrics = createSongLyrics(lrclib, vocadb)
  // The user's own choice of lyrics per song, from "Pick Other Lyrics…".
  const lyricsPicks = openPickStore(join(userData, 'lyrics-picks.json'))
  const demoLyrics = createDemoLyricsProvider()
  const autoSynced = openAutoSyncedStore(join(userData, 'lyrics-autosync'))
  const romajiDirectory = join(userData, 'lyrics-romaji')
  // Romaji for the lines VocaDB has none for, made on this computer from kuromoji's dictionary
  // (in a process of its own, as it's large), reading words the way the saved VocaDB romaji does.
  const romajiMaker = createRomajiMaker({
    start: () => forkMaker(romajiMakerPath),
    learning: {
      stamp: () => savedRomajiStamp(romajiDirectory),
      songs: () => savedRomanizations(romajiDirectory),
      saved: openLearnedReadings(join(userData, 'lyrics-romaji-learned.json'))
    }
  })
  // One instance of each, shared by the lyrics service and the color-coding editor: a store
  // only tells the listeners on the instance that wrote, and the timing fixes are read from memory.
  const lyricsOffsets = openOffsetStore(join(userData, 'lyrics-offsets.json'))
  const singerColorsDirectory = join(userData, 'lyrics-singers')
  const singerColors = openSongColorsStore(singerColorsDirectory)
  const lyrics = createLyricsService({
    music,
    visible: settings.get().music.showLyrics,
    // The demo's songs are made up; LRCLIB would never have them.
    providerFor: (player) => (player === 'demo' ? demoLyrics : songLyrics),
    cache: openLyricsCache(join(userData, 'lyrics')),
    offsets: lyricsOffsets,
    // The user's singer colors, one file per song.
    colors: singerColors,
    picks: lyricsPicks,
    fetchVersion: (id) => songLyrics.byId(id),
    autoSynced,
    pageLyrics: youtubeMusic.pageLyrics,
    romaji: {
      store: openRomajiStore(romajiDirectory),
      lookUp: vocadb.romaji,
      enabled: settings.get().music.romaji,
      made: {
        store: openMadeRomajiStore(join(userData, 'lyrics-romaji-made')),
        make: (lines) => romajiMaker.make(lines)
      }
    }
  })
  const google = createGoogleTasksProvider({
    secrets,
    request: (url, request) =>
      requestJson(url, request, { maxBytes: GOOGLE_MAX_BYTES, timeoutMs: GOOGLE_TIMEOUT_MS }),
    listen: listenForRedirect,
    openBrowser: (url) => shell.openExternal(url)
  })
  // Canvas data only ever goes to the screen and back to the user's own Canvas site.
  const canvas = createCanvasProvider({
    secrets,
    request: (url, request) =>
      requestJson(url, request, { maxBytes: CANVAS_MAX_BYTES, timeoutMs: CANVAS_TIMEOUT_MS }),
    fetchFeed: (url) =>
      fetchText(url, { maxBytes: CANVAS_FEED_MAX_BYTES, timeoutMs: CANVAS_TIMEOUT_MS }),
    marks: openFeedMarks(join(userData, 'canvas-feed-done.json'))
  })
  // Reminders lives in EventKit, which only macOS has; elsewhere the source doesn't exist.
  const reminders = isMac
    ? createRemindersProvider({
        startHelper: remindersHelper(remindersHelperPath),
        enabled: settings.get().todos.reminders,
        saveEnabled: (on) => {
          settings.update((s) => ({ ...s, todos: { ...s.todos, reminders: on } }))
        },
        openSystemSettings: () => openPrivacyPane('Privacy_Reminders', 'todos')
      })
    : null
  // The user's own homework and exams: only ever in homework.json, never sent anywhere. A
  // ticked homework leaves the file at once (the user's condition for keeping class names there).
  const homeworkBook = openHomeworkBook({ filePath: join(userData, 'homework.json') })
  const homework = createHomeworkProvider(homeworkBook)
  const todos = createTodoService({
    providers: reminders ? [canvas, homework, reminders, google] : [canvas, homework, google],
    // Dev builds only, like the demo player.
    demo: isDev ? createMockTodoProviders() : null
  })
  // The dot in each card's corner: green connected, red needs a look.
  const status = createStatusService({ music, todos, browsers: youtubeMusic.links })
  // Next class reads Calendar through the same helper app as Reminders, in its calendar mode.
  // Google Calendar for Next class: read-only, signed in apart from Google Tasks.
  const googleCalendar = createGoogleCalendar({
    secrets,
    request: (url, request) =>
      requestJson(url, request, { maxBytes: GOOGLE_MAX_BYTES, timeoutMs: GOOGLE_TIMEOUT_MS }),
    listen: listenForRedirect,
    openBrowser: (url) => shell.openExternal(url)
  })
  const calendar = createCalendarService({
    settings,
    supported: isMac,
    startHelper: isMac ? calendarHelper(remindersHelperPath) : null,
    demo: isDev,
    openSystemSettings: () => openPrivacyPane('Privacy_Calendars', 'calendar'),
    google: googleCalendar
  })
  // Dev builds can start on the made-up classes, for working on Next class and its map.
  if (isDev && process.env.FOCUS_SCREEN_DEMO_CLASSES === '1') calendar.setDemoEnabled(true)
  // The homework form's class chips: the class calendars' event titles, only what Next class
  // already reads. A picked one is saved with the homework (approved by the user, 2026-10-27).
  homework.setCalendarClasses(calendar.get().events.map((event) => event.title))
  calendar.subscribe((state) => homework.setCalendarClasses(state.events.map((e) => e.title)))
  // Where a class meets: ASU's public building list (the same download for everyone) and an
  // Apple Maps picture of the building, made by the helper ahead of time and kept.
  // Other schools' buildings come from OpenStreetMap, once, when the user asks in Customize:
  // the request holds only the school's name and country.
  const schoolMaps = createSchoolMaps({
    directory: app.getPath('userData'),
    fetchCampus: (query) =>
      requestJson(
        OVERPASS_URL,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`
        },
        { maxBytes: 20_000_000, timeoutMs: 150_000 }
      )
  })
  const school = (): { name: string; country: string } => settings.get().nextClass.school
  const schoolStatus = createSchoolStatus({
    school,
    schoolMaps,
    // The calendars' account addresses, to suggest a school; they never leave this Mac.
    emails: () =>
      calendar
        .get()
        .calendars.flatMap((info) => [info.source, info.id.replace(/^google:/, '')])
        .filter((value) => /^[^@\s]+@[a-z0-9.-]+$/i.test(value))
  })
  const classMap = createClassMapService({
    school,
    schoolMaps,
    directory: app.getPath('userData'),
    fetchBuildings: async () => {
      const response = await fetchJson(BUILDINGS_URL, { maxBytes: 3_000_000, timeoutMs: 30_000 })
      return response.status === 200 ? response.body : null
    },
    makePicture:
      isMac && existsSync(remindersHelperPath)
        ? (request) => makeMapPicture(remindersHelperPath, request)
        : null,
    dark: () => settings.get().theme.preset !== 'day'
  })
  const prepareClassMaps = (): void => {
    if (settings.get().widgets.nextClass) {
      classMap.prepare(calendar.get().events.map((event) => event.location))
    }
  }
  calendar.subscribe(prepareClassMaps)
  calendar.subscribe(() => schoolStatus.suggest())
  schoolMaps.subscribe(prepareClassMaps)
  settings.subscribe(() => schoolStatus.refresh())
  prepareClassMaps()
  schoolStatus.suggest()
  // Next bus: Valley Metro's data from the City of Phoenix's Open Data portal and its live feed
  // host. The same requests for everyone: the picked stops never leave this computer.
  const transitJson = (url: string): Promise<{ status: number; body: unknown }> =>
    fetchJson(url, { maxBytes: 2_000_000, timeoutMs: 20_000 })
  const transit = createTransitService({
    settings,
    directory: userData,
    // Trip Updates are ~400 KB a read; the schedule's zip ~13 MB, once a month at most.
    feed: createValleyMetroFeed(transitJson, (url) =>
      fetchBinary(url, { maxBytes: 10_000_000, timeoutMs: 30_000 })
    ),
    downloadSchedule: () =>
      downloadSchedule(
        transitJson,
        (url) => fetchBinary(url, { maxBytes: 60_000_000, timeoutMs: 300_000 }),
        Math.floor(Date.now() / 1000)
      ),
    // Dev builds only, like the demo classes.
    demo: isDev
      ? { feed: demoFeed(Date.now), stopList: demoStopList(Math.floor(Date.now() / 1000)) }
      : null
  })
  if (isDev && process.env.FOCUS_SCREEN_DEMO_BUSES === '1') transit.setDemoEnabled(true)
  // The weather pill: Open-Meteo gets only the rounded position, and only while the pill can
  // be seen. The helper's location mode runs only while something holds a handle on it: weather
  // when it's on (and, below, the trip planner while it needs a fix).
  const locationStart = isMac ? locationHelper(remindersHelperPath) : null
  // One helper for everything that wants to know where the Mac is: each takes its own handle,
  // and the helper stops with the last.
  const macLocation = locationStart ? sharedLocation(() => helperLocation(locationStart)) : null
  const weather = createWeatherService({
    settings,
    startLocation: macLocation,
    // ~10 KB a read, never in the disk cache: its address is the rounded position.
    source: createOpenMeteo(
      (url) => fetchJson(url, { maxBytes: 200_000, timeoutMs: 15_000, noStore: true }),
      Date.now
    ),
    demo: isDev ? { location: demoLocation, source: demoWeather(Date.now) } : null
  })
  if (isDev && process.env.FOCUS_SCREEN_DEMO_WEATHER === '1') weather.setDemoEnabled(true)
  // The trip card: planned on this Mac from Valley Metro's schedule. Apple's place search gets
  // only the typed text (applePlaces.ts); where the Mac is stays here.
  const placesStart =
    isMac && existsSync(remindersHelperPath) ? placesHelper(remindersHelperPath) : null
  const trips = createTripService({
    settings,
    transit,
    planner: (path) => createTripPlanner({ start: () => forkPlanner(tripWorkerPath, path) }),
    location: macLocation,
    places: openPlaces(join(userData, 'trip-places.json')),
    apple: placesStart ? () => createApplePlaces(placesStart) : null,
    classes: {
      next: () =>
        nextClassPlace(calendar.get().events, Math.floor(Date.now() / 1000), (location) =>
          classMap.position(location)
        )
    },
    buildings: async () => buildingPlaces(await classMap.buildings()),
    demo: isDev ? demoTrips(Date.now) : null
  })
  if (isDev && process.env.FOCUS_SCREEN_DEMO_TRIPS === '1') trips.setDemoEnabled(true)
  // The held Bus pill's route card: Apple Maps gets only a box around the bus's path, and
  // Vehicle Locations (~100 KB) is read every 15 s only while a card is open.
  const busRoute = createBusRouteService({
    directory: userData,
    transit,
    makePicture:
      isMac && existsSync(remindersHelperPath)
        ? (request) => makeRouteMapPicture(remindersHelperPath, request)
        : null,
    dark: () => settings.get().theme.preset !== 'day',
    vehicles: createValleyMetroVehicles(transitJson, (url) =>
      fetchBinary(url, { maxBytes: 5_000_000, timeoutMs: 20_000 })
    ),
    demoVehicles: isDev ? demoVehicles(Date.now) : null
  })
  const connectGoogle = (win: BrowserWindow | null): void => {
    connectGoogleTasks(google, win).catch((error: unknown) =>
      console.warn('[todos] Google Tasks sign-in failed.', error)
    )
  }
  const connectReminders = (): void => {
    reminders
      ?.connect()
      .catch((error: unknown) => console.warn('[todos] Could not connect Apple Reminders.', error))
  }
  // A token can't be typed into a native dialog, so the window that asked shows a form instead:
  // the to-do card on the Focus Screen, or the Canvas row in Customize.
  const connectCanvas = (win: BrowserWindow | null): void => {
    if (canvas.connection() !== 'disconnected' || !win) return
    sendEvent(win.webContents, IpcChannel.todosConnectForm, {
      source: 'canvas',
      address: canvas.address()
    })
  }
  const disconnectCanvas = (win: BrowserWindow | null): void => {
    confirmCanvasDisconnect(canvas, win).catch((error: unknown) =>
      console.warn('[todos] Could not disconnect Canvas.', error)
    )
  }
  const disconnectGoogle = (win: BrowserWindow | null): void => {
    confirmGoogleDisconnect(google, win).catch((error: unknown) =>
      console.warn('[todos] Could not disconnect Google Tasks.', error)
    )
  }
  const pairBrowser = (win: BrowserWindow | null): void => {
    const code = youtubeMusic.startPairing()
    const options = {
      message: 'Connect your browser',
      detail:
        `Click the Focus Screen extension in Chrome or Safari and enter this code:\n\n` +
        `${code.slice(0, 3)} ${code.slice(3)}\n\nThe code works for 5 minutes.`,
      buttons: ['Done']
    }
    void (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options))
  }
  const setLyricsVisible = (showLyrics: boolean): void => {
    settings.update((s) => ({ ...s, music: { ...s.music, showLyrics } }))
  }
  // Moving hidden lyrics would change their timing without anyone seeing it.
  const nudgeLyrics = (direction: 'earlier' | 'later'): void => {
    if (settings.get().music.showLyrics) lyrics.command({ kind: 'nudgeOffset', direction })
  }
  const keepAwake = createKeepAwake({
    settings,
    blocker: {
      start: () => powerSaveBlocker.start('prevent-display-sleep'),
      stop: (id) => powerSaveBlocker.stop(id)
    }
  })
  const hotkeys = createHotkeyService({
    settings,
    registrar: {
      register: (accelerator, run) => globalShortcut.register(accelerator, run),
      unregister: (accelerator) => globalShortcut.unregister(accelerator)
    },
    mac: isMac,
    actions: {
      playPause: () => music.command({ kind: 'playPause' }),
      nextTrack: () => music.command({ kind: 'next' }),
      previousTrack: () => music.command({ kind: 'previous' }),
      // The timer card's own button: Pause while running, otherwise Start, Resume or Restart.
      toggleTimer: () =>
        timer.command({ kind: timer.get().status === 'running' ? 'pause' : 'start' }),
      lyricsEarlier: () => nudgeLyrics('earlier'),
      lyricsLater: () => nudgeLyrics('later'),
      toggleFocusScreen: () => focus.setShown(!focus.isShown())
    }
  })
  // Dev builds only, for now: records every song so lyric aligners can be measured on them.
  let samples: { client: AudioHelperClient; capture: SongCapture } | null = null
  // macOS only: the audio helper is a Core Audio tap. The aligner is the user's own install.
  const startAudioHelper = isMac ? audioHelper(audioHelperPath) : null
  const startAligner = isMac ? alignerWorker(alignerScriptPath, join(userData, 'aligner')) : null
  const autosync = createAutoSyncService({
    music,
    lyrics,
    enabled: settings.get().music.autoSync,
    supported: isMac,
    helper: startAudioHelper ? () => createAudioHelperClient(startAudioHelper) : null,
    aligner: startAligner ? () => createAlignerClient(startAligner) : null,
    // Live sync on the first play is still being researched (lyrics-sync/): dev builds only, and
    // only with FOCUS_SCREEN_LIVE_SYNC=1, until the worker follows songs well enough to show.
    follow:
      startAligner && isDev && process.env.FOCUS_SCREEN_LIVE_SYNC === '1'
        ? (onEvent) => createFollowClient(startAligner, onEvent)
        : null,
    store: autoSynced,
    tempDir: join(app.getPath('temp'), 'focus-screen-autosync'),
    // Dev builds keep a song that couldn't be timed, with its lyrics, to try again offline.
    onRejected: isDev
      ? ({ trackId, samples }) => {
          const shown = lyrics.get()
          const track = music.get().track
          const recording = createSongRecording(samples.length / SAMPLE_RATE)
          recording.write(0, samples)
          try {
            const base = saveSample(
              autosyncSamplesDir,
              {
                player: music.get().player?.id ?? 'demo',
                track:
                  track?.id === trackId
                    ? track
                    : {
                        id: trackId,
                        title: 'failed',
                        artist: '',
                        album: '',
                        durationSec: recording.durationSec,
                        artwork: null
                      },
                recording
              },
              shown.trackId === trackId ? shown.lyrics : null
            )
            console.log(`[autosync] Kept the recording for a closer look: ${base}.wav`)
          } catch (error) {
            console.warn('[autosync] Could not keep the recording.', error)
          }
        }
      : undefined
  })
  // "Pick Other Lyrics…": the song's versions on LRCLIB (with VocaDB's names for it) to choose
  // from, shown on the Focus Screen; a pick is kept per song by the lyrics service.
  const lyricsPicker = createLyricsPicker({
    lyrics,
    songs: songLyrics,
    picks: lyricsPicks,
    visible: () => settings.get().music.showLyrics,
    listen: () => {
      const timing = autosync.get()
      if (timing.problem === 'unsupported') return 'unsupported'
      return timing.enabled && timing.problem === null ? 'ready' : 'off'
    }
  })
  // The Color-Code Lyrics editor's session. It listens to the player's audio (for the waveform
  // and "Time by listening") only while its window is open, through a helper of its own on a Mac
  // that has the audio helper built; closing the window ends the session and the recording.
  const listenTempDir = join(app.getPath('temp'), 'focus-screen-listen')
  // A WAV a crash left mid-run goes now, not whenever the editor is next opened.
  clearWavs(listenTempDir)
  const colorEditor = createColorEditor({
    store: singerColors,
    music,
    lyrics,
    offsets: lyricsOffsets,
    openTap: openSingerTap,
    noTapNote: noTapNote(),
    pictures: openSingerPictures(singerColorsDirectory),
    window: () => lyricsEditor.getWindow(),
    // Its own aligner, so a run never waits behind a song of auto-sync's (R6), and its own
    // folder: auto-sync's clears its WAVs as it starts, which would take a run's mid-align.
    listen: {
      aligner: startAligner ? () => createAlignerClient(startAligner) : null,
      tempDir: listenTempDir
    }
  })
  // The animated cover's moving parts: cut out by a Python worker the user installs
  // (npm run setup:covers), kept per cover in userData, drawn live by the page.
  const coverMotionRuntime = join(userData, 'cover-motion')
  const coverMotion = createCoverMotionService({
    supported: isMac,
    store: createCoverStore(join(coverMotionRuntime, 'library')),
    startWorker: isMac ? coverWorker(coverMotionScriptPath, coverMotionRuntime) : null,
    music,
    settings,
    decode(dataUrl) {
      const image = nativeImage.createFromDataURL(dataUrl)
      if (image.isEmpty()) return null
      return {
        key: coverKey(image),
        square: squareCover(image),
        fingerprint: coverFingerprint(image)
      }
    },
    readDataUrl(path) {
      try {
        const type = path.endsWith('.png') ? 'image/png' : 'image/jpeg'
        return `data:${type};base64,${readFileSync(path).toString('base64')}`
      } catch {
        return null
      }
    }
  })
  // Preparing a playlist: YouTube Music plays it muted, and auto-sync times what needs it.
  const prepare = createPrepareService({
    music,
    lyrics,
    autoSync: autosync,
    showLyrics: () => settings.get().music.showLyrics,
    // Straight to YouTube Music: the screen may show another player for a moment.
    command: (player, command) => {
      void youtubeMusic.command(player, command).catch(() => null)
    },
    // A helper of its own holds the mute; stopping it (or the app quitting) gives the sound back.
    async mute(bundles) {
      if (!startAudioHelper) return null
      const client = createAudioHelperClient(startAudioHelper)
      const result = await client.mute(true, bundles)
      if (!result.ok) {
        console.warn(`[prepare] Couldn't mute the player: ${result.error}`)
        client.dispose()
        return null
      }
      return () => client.dispose()
    },
    // The display may sleep, but the Mac has to stay up to keep playing.
    keepAwake() {
      const id = powerSaveBlocker.start('prevent-app-suspension')
      return () => powerSaveBlocker.stop(id)
    }
  })
  // The same, started on its own while nobody uses the Mac, so the browser is never muted on
  // someone. Dev builds can shorten the wait to try it (FOCUS_SCREEN_AWAY_AFTER_SEC=30).
  const awayAfterSec = Number(process.env.FOCUS_SCREEN_AWAY_AFTER_SEC)
  const away = createAwayPreparer({
    prepare,
    music,
    armed: () => settings.get().music.prepareWhenAway,
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
    // Two seconds of the browser's level; the audio itself goes nowhere.
    async isQuiet(bundles) {
      if (!startAudioHelper) return false
      const client = createAudioHelperClient(startAudioHelper)
      let squares = 0
      let count = 0
      client.onAudio((_at, samples) => {
        for (const sample of samples) squares += sample * sample
        count += samples.length
      })
      try {
        const result = await client.start(bundles)
        // No audio process at all: nothing is playing in it.
        if (!result.ok) return result.error === 'noProcess'
        await new Promise((resolve) => setTimeout(resolve, QUIET_CHECK_MS))
        return count > 0 && Math.sqrt(squares / count) < QUIET_LEVEL
      } finally {
        client.dispose()
      }
    },
    ...(isDev && awayAfterSec > 0 ? { awayAfterSec } : {})
  })
  const toggleSamples = (): void => {
    if (samples) {
      samples.capture.dispose()
      samples.client.dispose()
      samples = null
    } else if (startAudioHelper) {
      const client = createAudioHelperClient(startAudioHelper)
      client.onAccess((status) => {
        if (status === 'denied') {
          console.warn('[autosync] Focus Screen Audio may not record: allow it in System Settings.')
        }
      })
      const capture = createSongCapture({
        music,
        helper: client,
        wants: () => true,
        onProgress: (coverage) =>
          console.log(`[autosync] ${Math.round(coverage * 100)}% of this song heard.`),
        onComplete: (song) => {
          const shown = lyrics.get()
          try {
            const base = saveSample(
              autosyncSamplesDir,
              song,
              shown.trackId === song.track.id ? shown.lyrics : null
            )
            console.log(`[autosync] Saved ${base}.wav`)
          } catch (error) {
            console.warn('[autosync] Could not save the recording.', error)
          }
        }
      })
      samples = { client, capture }
    } else {
      console.warn('[autosync] Run `npm run build:audio` first.')
    }
    installAppMenu(menuContext())
  }
  let editingLayout = false
  const setEditingLayout = (on: boolean): void => {
    if (on === editingLayout) return
    editingLayout = on
    if (on) {
      focus.setShown(true)
      // Otherwise the first click there only brings the window forward, and Esc goes elsewhere.
      focus.getWindow()?.focus()
    }
    screenCare.setBusy('layout', on)
    toWindows(IpcChannel.layoutEditingChanged, on)
    installAppMenu(menuContext())
  }
  const resetLayout = (): void => {
    settings.update((s) => ({ ...s, widgets: { ...s.widgets, layout: null } }))
  }

  let tray: AppTray | null = null
  const trayContext = (): TrayContext => ({
    shown: focus.isShown(),
    toggleAccelerator: hotkeys.acceleratorFor('toggleFocusScreen'),
    setShown: (shown) => focus.setShown(shown),
    openCustomize: () => customize.open(),
    preparing: prepare.get().running,
    stopPreparing: () => prepare.stop()
  })

  /**
   * Every window shows the same state: the Focus Screen, and Customize and the lyrics editor
   * while they're open (the editor wears the theme and follows the song). The editor's own
   * session state is the one thing that goes to its window alone.
   */
  const toWindows = <K extends keyof EventChannels>(
    channel: K,
    payload: EventChannels[K]
  ): void => {
    for (const win of [focus.getWindow(), customize.getWindow(), lyricsEditor.getWindow()]) {
      if (win) sendEvent(win.webContents, channel, payload)
    }
  }
  /** The window a menu click belongs to: Customize when it's in front, else the Focus Screen. */
  const frontWindow = (): BrowserWindow | null => {
    const win = customize.getWindow()
    return win?.isFocused() ? win : focus.getWindow()
  }

  const pendingEdit = createPendingEdit()
  // The trackpad's tick when a timer wheel lands on 0: the Swift helper's haptics mode (macOS).
  const haptics = createHaptics({
    start: () => {
      if (!isMac) throw new Error('No trackpad haptics here')
      const child = spawn(remindersHelperPath, ['--haptics'], {
        stdio: ['pipe', 'ignore', 'ignore']
      })
      // A helper that's missing or gone is no tick, never a crash.
      child.on('error', () => {})
      child.stdin.on('error', () => {})
      return {
        write: (line) => {
          if (child.stdin.writable) child.stdin.write(line)
        },
        onExit: (listener) => child.on('exit', listener),
        kill: () => {
          child.stdin.end()
          child.kill()
        }
      }
    }
  })
  /** A length can be set on the card before a run starts or once it's over, never mid-run. */
  const lengthEditable = (state: TimerState): boolean =>
    state.status === 'idle' || state.status === 'finished'

  const menuContext = (): MenuContext => ({
    displays: focus.getDisplays(),
    placement: focus.getPlacement(),
    showOn: settings.get().display.showOn,
    choose: (showOn) => {
      settings.update((s) => ({ ...s, display: { ...s.display, showOn } }))
    },
    focusShown: focus.isShown(),
    setFocusShown: (shown) => focus.setShown(shown),
    toggleAccelerator: hotkeys.acceleratorFor('toggleFocusScreen'),
    timer: settings.get().timer,
    setTimer: (change) => {
      settings.update((s) => ({ ...s, timer: { ...s.timer, ...change } }))
    },
    timerEdit: {
      shown: settings.get().widgets.timer,
      enabled: lengthEditable(timer.get()),
      open: (length) => {
        if (!lengthEditable(timer.get())) return
        // The wheels open on the Focus Screen's card, so that has to be up and in front.
        focus.setShown(true)
        focus.getWindow()?.focus()
        timer.command({
          kind: 'selectMode',
          mode: length === 'countdown' ? 'countdown' : 'pomodoro'
        })
        pendingEdit.set(length, Date.now() / 1000)
        const win = focus.getWindow()
        if (win) sendEvent(win.webContents, IpcChannel.timerEditLength, length)
      }
    },
    music: settings.get().music,
    setMusic: (change) => {
      settings.update((s) => ({ ...s, music: { ...s.music, ...change } }))
    },
    layout: {
      editing: editingLayout,
      setEditing: setEditingLayout,
      custom: settings.get().widgets.layout !== null,
      reset: resetLayout
    },
    openCustomize: () => customize.open(),
    connectBrowser: () => pairBrowser(frontWindow()),
    lyrics: {
      setVisible: setLyricsVisible,
      nudge: (direction) => lyrics.command({ kind: 'nudgeOffset', direction }),
      reset: () => lyrics.command({ kind: 'resetOffset' }),
      pickOther: () => {
        // The list opens on the Focus Screen, so that has to be up, and in front: a glass card
        // closes when its window isn't (as Edit Layout found).
        focus.setShown(true)
        focus.getWindow()?.focus()
        void lyricsPicker.command({ kind: 'open' })
      },
      canPickOther: lyricsPicker.canOpen(),
      // The editor is its own window, not a card on the Focus Screen: opened again it follows
      // the song that's on now.
      colorCode: () => {
        lyricsEditor.open()
        colorEditor.open()
      },
      canColorCode: canColorCode(lyrics.get())
    },
    demoMusic: music.hasDemo
      ? {
          enabled: music.isDemoEnabled(),
          toggle: () => {
            music.setDemoEnabled(!music.isDemoEnabled())
            installAppMenu(menuContext())
          }
        }
      : null,
    todos: {
      canvas: canvas.connection(),
      connectCanvas: () => connectCanvas(frontWindow()),
      disconnectCanvas: () => disconnectCanvas(frontWindow()),
      google: google.connection(),
      hasGoogleClient: google.hasClient(),
      connectGoogle: () => connectGoogle(frontWindow()),
      cancelGoogle: () => google.cancelConnect(),
      disconnectGoogle: () => disconnectGoogle(frontWindow()),
      reminders: reminders?.connection() ?? null,
      connectReminders,
      disconnectReminders: () => reminders?.disconnect(),
      chooseGoogleClient: () => {
        chooseGoogleClientFile(google, frontWindow())
          .then(() => installAppMenu(menuContext()))
          .catch((error: unknown) => console.warn('[todos] Could not read the client file.', error))
      },
      refresh: todos.get().sources.some((source) => source.connection === 'connected')
        ? () => todos.refresh()
        : null
    },
    demoClasses: calendar.hasDemo
      ? {
          enabled: calendar.isDemoEnabled(),
          toggle: () => {
            calendar.setDemoEnabled(!calendar.isDemoEnabled())
            installAppMenu(menuContext())
          }
        }
      : null,
    demoBuses: transit.hasDemo
      ? {
          enabled: transit.isDemoEnabled(),
          toggle: () => {
            transit.setDemoEnabled(!transit.isDemoEnabled())
            installAppMenu(menuContext())
          }
        }
      : null,
    demoWeather: weather.hasDemo
      ? {
          enabled: weather.isDemoEnabled(),
          toggle: () => {
            weather.setDemoEnabled(!weather.isDemoEnabled())
            installAppMenu(menuContext())
          }
        }
      : null,
    demoTrips: trips.hasDemo
      ? {
          enabled: trips.isDemoEnabled(),
          toggle: () => {
            trips.setDemoEnabled(!trips.isDemoEnabled())
            installAppMenu(menuContext())
          }
        }
      : null,
    demoTodos: todos.hasDemo
      ? {
          enabled: todos.isDemoEnabled(),
          toggle: () => {
            todos.setDemoEnabled(!todos.isDemoEnabled())
            installAppMenu(menuContext())
          }
        }
      : null,
    autosyncSamples:
      isDev && startAudioHelper ? { enabled: samples !== null, toggle: toggleSamples } : null
  })

  handle(IpcChannel.settingsGet, () => settings.get())
  handle(IpcChannel.placementGet, () => focus.getPlacementInfo())
  handle(IpcChannel.displayChoicesGet, () => focus.getDisplayChoices())
  handle(IpcChannel.screenCareGet, () => screenCare.get())
  handle(IpcChannel.layoutEditingGet, () => editingLayout)
  handle(IpcChannel.backgroundPhotoGet, () => backgroundPhoto.get())
  handle(IpcChannel.hotkeysGet, () => hotkeys.get())
  handle(IpcChannel.timerGet, () => timer.get())
  // Only the Focus Screen's card opens the wheels.
  handleFrom(IpcChannel.timerEditTake, (sender) =>
    sender === focus.getWindow()?.webContents ? pendingEdit.take(Date.now() / 1000) : null
  )
  handle(IpcChannel.musicGet, () => music.get())
  handle(IpcChannel.lyricsGet, () => lyrics.get())
  handle(IpcChannel.todosGet, () => todos.get())
  handle(IpcChannel.calendarGet, () => calendar.get())
  handle(IpcChannel.statusGet, () => status.get())
  /** The glass menu on screen (a dot's or the right-click one): what its entries run. */
  let cardMenu: { token: number; actions: Map<string, () => void> } | null = null
  let cardMenuToken = 0
  /** A newer opening replaces the menu before, so a late pick from it does nothing. */
  const glassMenu = (items: MenuItemConstructorOptions[], lines: string[]): CardMenu => {
    const built = cardMenuEntries(items, isMac)
    cardMenuToken += 1
    cardMenu = { token: cardMenuToken, actions: built.actions }
    return { token: cardMenuToken, lines, entries: built.entries }
  }
  handleFrom(IpcChannel.statusCardMenu, (sender, card) => {
    // The dots are only on the Focus Screen.
    const win = BrowserWindow.fromWebContents(sender)
    const id = CARD_IDS.find((known) => known === card)
    if (!win || win !== focus.getWindow() || !id) return null
    return glassMenu(cardMenuItems(menuContext(), id), status.get()[id].lines)
  })
  /** A right-click on one of the user's own homeworks or exams: its Edit… and Delete first. */
  const homeworkTargetItems = (raw: unknown, win: BrowserWindow): MenuItemConstructorOptions[] => {
    const id = parseHomeworkTarget(raw)
    const found = id ? homeworkBook.find(id) : null
    if (!found) return []
    const { entry } = found
    return homeworkMenuItems(entry, {
      edit: found.ticked
        ? null
        : () =>
            sendEvent(win.webContents, IpcChannel.todosHomeworkForm, { kind: entry.kind, entry }),
      remove: () => {
        void handleHomeworkRequest(homeworkBook, { kind: 'delete', id: entry.id }, (shown) =>
          confirmHomeworkDelete(win, shown)
        )
      }
    })
  }
  handleFrom(IpcChannel.quickMenu, (sender, target) => {
    const win = BrowserWindow.fromWebContents(sender)
    if (!win || win !== focus.getWindow()) return null
    return glassMenu(
      [...homeworkTargetItems(target, win), ...quickMenuItems(menuContext(), win)],
      []
    )
  })
  on(IpcChannel.statusCardMenuPick, (event, token, entry) => {
    if (BrowserWindow.fromWebContents(event.sender) !== focus.getWindow()) return
    if (!cardMenu || token !== cardMenu.token || typeof entry !== 'string') return
    const action = cardMenu.actions.get(entry)
    // One pick per opening, like a native menu.
    cardMenu = null
    action?.()
  })
  on(IpcChannel.calendarCommand, (event, raw) => {
    const command = parseCalendarCommand(raw)
    const win = BrowserWindow.fromWebContents(event.sender)
    switch (command?.kind) {
      case 'openPrivacySettings':
        calendar.openPrivacySettings()
        break
      case 'connectGoogle':
        connectGoogleCalendar(googleCalendar, win).catch((error: unknown) =>
          console.warn('[calendar] Google Calendar sign-in failed.', error)
        )
        break
      case 'disconnectGoogle':
        confirmGoogleCalendarDisconnect(googleCalendar, win).catch((error: unknown) =>
          console.warn('[calendar] Could not disconnect Google Calendar.', error)
        )
        break
    }
  })
  handle(IpcChannel.calendarPlace, (raw) =>
    typeof raw === 'string' ? classMap.place(raw.slice(0, 200)) : null
  )
  on(IpcChannel.calendarOpenMap, (_event, raw) => {
    // Main builds the address: ASU's map for a building in its list, or Apple Maps at a
    // building in the school's map. Nothing the page says becomes an address.
    const url = classMap.mapUrl(typeof raw === 'string' ? raw.slice(0, 200) : null)
    if (url) void shell.openExternal(url)
  })
  handle(IpcChannel.schoolGet, () => schoolStatus.get())
  handle(IpcChannel.schoolSearch, (raw) =>
    typeof raw === 'string' ? schoolStatus.search(raw) : Promise.resolve([])
  )
  on(IpcChannel.schoolCommand, (_event, raw) => {
    const command = parseSchoolCommand(raw)
    const picked = school()
    if (command?.kind === 'download') void schoolMaps.download(picked)
    if (command?.kind === 'remove') schoolMaps.remove(picked)
  })
  handle(IpcChannel.transitGet, () => transit.get())
  handle(IpcChannel.transitSearch, (raw) =>
    typeof raw === 'string' ? transit.search(raw.slice(0, 100)) : []
  )
  on(IpcChannel.transitCommand, (_event, raw) => {
    const command = parseTransitCommand(raw)
    if (command?.kind === 'download') void transit.download()
    if (command?.kind === 'remove') transit.remove()
    if (command?.kind === 'retry') transit.retry()
  })
  handle(IpcChannel.weatherGet, () => weather.get())
  on(IpcChannel.weatherCommand, (_event, raw) => {
    const command = parseWeatherCommand(raw)
    if (command?.kind === 'retry') weather.retry()
    if (command?.kind === 'requestAccess') weather.requestAccess()
    if (command?.kind === 'openLocationSettings') {
      openPrivacyPane('Privacy_LocationServices', 'weather')
    }
  })
  handle(IpcChannel.tripsGet, () => trips.get())
  on(IpcChannel.tripsCommand, (_event, raw) => {
    const command = parseTripCommand(raw)
    if (!command) return
    if (command.kind === 'openLocationSettings') {
      openPrivacyPane('Privacy_LocationServices', 'trips')
      return
    }
    trips.command(command)
  })
  // The text is cut before use; it's never logged.
  handle(IpcChannel.tripsSearch, (raw) =>
    typeof raw === 'string' ? trips.searchLocal(raw.slice(0, 100)) : []
  )
  handle(IpcChannel.tripsSearchApple, (raw) =>
    typeof raw === 'string' ? trips.searchApple(raw.slice(0, 100)) : []
  )
  handle(IpcChannel.transitRoute, (raw) =>
    typeof raw === 'string' ? busRoute.route(raw.slice(0, 300)) : null
  )
  on(IpcChannel.transitWatch, (_event, raw) =>
    busRoute.watch(typeof raw === 'string' ? raw.slice(0, 300) : null)
  )
  handle(IpcChannel.todosCanvasForm, (raw) => {
    const request = parseCanvasFormRequest(raw)
    if (!request) return { ok: false, message: 'Something went wrong. Try again.', field: null }
    return handleCanvasForm(canvas, request, (url) => shell.openExternal(url))
  })
  handleFrom(IpcChannel.todosHomework, (sender, raw) => {
    const request = parseHomeworkRequest(raw)
    if (!request) return { ok: false, message: 'Something went wrong. Try again.' }
    return handleHomeworkRequest(homeworkBook, request, (entry) =>
      confirmHomeworkDelete(BrowserWindow.fromWebContents(sender), entry)
    )
  })
  handle(IpcChannel.backgroundPhotoChoose, async () => {
    const result = await backgroundPhoto.choose(customize.getWindow() ?? focus.getWindow())
    if (result.ok) settings.update((s) => ({ ...s, theme: { ...s.theme, background: 'photo' } }))
    return result
  })
  on(IpcChannel.settingsUpdate, (_event, patch) => {
    settings.update((s) => applySettingsPatch(s, patch))
  })
  on(IpcChannel.displayActivity, () => screenCare.activity())
  on(IpcChannel.layoutEditingSet, (_event, on) => {
    if (typeof on === 'boolean') setEditingLayout(on)
  })
  on(IpcChannel.customizeOpen, () => customize.open())
  on(IpcChannel.customizeClose, (event) => {
    if (event.sender === customize.getWindow()?.webContents) customize.close()
  })
  on(IpcChannel.musicPairBrowser, (event) => {
    pairBrowser(BrowserWindow.fromWebContents(event.sender))
  })
  on(IpcChannel.timerHaptic, (_event, raw) => {
    if (raw === 'warm') haptics.warm()
    else if (raw === 'tick' || raw === 'firm') haptics.tick(raw === 'firm')
  })
  on(IpcChannel.timerCommand, (_event, raw) => {
    const command = parseTimerCommand(raw)
    if (command) timer.command(command)
  })
  on(IpcChannel.musicCommand, (_event, raw) => {
    const command = parseMusicCommand(raw)
    if (command) music.command(command)
  })
  on(IpcChannel.lyricsCommand, (_event, raw) => {
    const command = parseLyricsCommand(raw)
    if (!command) return
    if (command.kind === 'setVisible') setLyricsVisible(command.on)
    else if (command.kind === 'setAlbumInk')
      settings.update((s) => ({ ...s, music: { ...s.music, albumInk: command.on } }))
    else lyrics.command(command)
  })
  on(IpcChannel.todosCommand, (event, raw) => {
    const command = parseTodoCommand(raw)
    if (!command) return
    const win = BrowserWindow.fromWebContents(event.sender)
    switch (command.kind) {
      case 'setDone':
        todos.setDone(command.id, command.done)
        break
      case 'refresh':
        todos.refresh()
        break
      case 'connect':
        if (command.source === 'google') connectGoogle(win)
        if (command.source === 'canvas') connectCanvas(win)
        if (command.source === 'reminders') connectReminders()
        break
      case 'disconnect':
        if (command.source === 'google') disconnectGoogle(win)
        if (command.source === 'canvas') disconnectCanvas(win)
        // Nothing to confirm: reconnecting takes one click, and macOS keeps its permission.
        if (command.source === 'reminders') reminders?.disconnect()
        break
      case 'cancelConnect':
        if (command.source === 'google') google.cancelConnect()
        break
      case 'openPrivacySettings':
        if (command.source === 'reminders') reminders?.openPrivacySettings()
        break
    }
  })
  on(IpcChannel.musicOpenAutomationSettings, () => {
    if (isMac) openPrivacyPane('Privacy_Automation', 'music')
  })
  handle(IpcChannel.autosyncGet, () => autosync.get())
  // "Screen & System Audio Recording", where the audio-only permission is listed too.
  on(IpcChannel.autosyncOpenSettings, () => {
    if (isMac) openPrivacyPane('Privacy_ScreenCapture', 'autosync')
  })
  handle(IpcChannel.prepareGet, () => prepare.get())
  handle(IpcChannel.coverMotionGet, () => coverMotion.get())
  handle(IpcChannel.coverEditorGet, () => coverMotion.editor.get())
  handle(IpcChannel.lyricsPickerGet, () => lyricsPicker.get())
  handle(IpcChannel.lyricsColorsGet, () => colorEditor.state())
  on(IpcChannel.lyricsPickerCommand, (_event, raw) => {
    const command = parseLyricsPickerCommand(raw)
    if (command) void lyricsPicker.command(command)
  })
  on(IpcChannel.lyricsColorsCommand, (event, raw) => {
    // Only the editor's own window drives it; the Focus Screen's page has no say.
    if (event.sender !== lyricsEditor.getWindow()?.webContents) return
    const command = parseColorEditorCommand(raw)
    if (command && mayRunFromEditor(command, colorEditor.state().open)) {
      colorEditor.command(command)
    }
  })
  on(IpcChannel.coverEditorCommand, (_event, raw) => {
    const command = parseCoverEditorCommand(raw)
    if (command) void coverMotion.editor.command(command)
  })
  on(IpcChannel.prepareCommand, (_event, raw) => {
    const command = parsePrepareCommand(raw)
    if (command?.kind === 'start') void prepare.start()
    if (command?.kind === 'stop') prepare.stop()
  })

  app.on('browser-window-created', (_event, win) => {
    // Text fields keep the native Cut/Copy/Paste menu. Anywhere else on the Focus Screen the page
    // opens the glass quick menu itself (and cancels this one); Customize is all buttons already.
    win.webContents.on('context-menu', (_event, params) => {
      if (params.isEditable) popupEditMenu(win)
    })
  })

  let menuLayoutCustom = settings.get().widgets.layout !== null
  // The Timer menu shows the lengths and whether "Set on the Timer Card…" can be used now.
  let timerMenuKey = ''
  const refreshTimerMenu = (): void => {
    const now = settings.get()
    const key = JSON.stringify([now.timer, now.widgets.timer, lengthEditable(timer.get())])
    if (key === timerMenuKey) return
    timerMenuKey = key
    installAppMenu(menuContext())
  }
  settings.subscribe((next) => {
    // A theme between day and night wants the other map; Next class turned on wants them at all.
    prepareClassMaps()
    busRoute.prepare()
    autosync.setEnabled(next.music.autoSync)
    music.setAllowedPlayers?.(playersFor(next.music.source))
    lyrics.setVisible(next.music.showLyrics)
    lyrics.setRomaji(next.music.romaji)
    prepare.refresh()
    nativeTheme.themeSource = nativeThemeFor(next.theme.preset)
    toWindows(IpcChannel.settingsChanged, next)
    refreshTimerMenu()
    // Reset Layout follows whether there's a layout to reset.
    if ((next.widgets.layout !== null) !== menuLayoutCustom) {
      menuLayoutCustom = next.widgets.layout !== null
      installAppMenu(menuContext())
    }
  })
  timer.subscribe((state) => {
    screenCare.setBusy('timer', state.status === 'running')
    keepAwake.setBusy('timer', state.status === 'running')
    toWindows(IpcChannel.timerChanged, state)
    refreshTimerMenu()
  })
  // Only the Focus Screen plays the chime, so it never sounds twice.
  timer.onChime((completion) => {
    const win = focus.getWindow()
    if (win) sendEvent(win.webContents, IpcChannel.timerChime, completion)
  })
  music.subscribe((state) => {
    screenCare.setBusy('music', state.playing)
    keepAwake.setBusy('music', state.playing)
    toWindows(IpcChannel.musicChanged, state)
  })
  lyrics.subscribe((state) => toWindows(IpcChannel.lyricsChanged, state))
  calendar.subscribe((state) => toWindows(IpcChannel.calendarChanged, state))
  schoolStatus.subscribe((state) => toWindows(IpcChannel.schoolChanged, state))
  transit.subscribe((state) => toWindows(IpcChannel.transitChanged, state))
  weather.subscribe((state) => toWindows(IpcChannel.weatherChanged, state))
  trips.subscribe((state) => toWindows(IpcChannel.tripsChanged, state))
  // Only the Focus Screen shows the route card.
  busRoute.subscribe((bus) => {
    const win = focus.getWindow()
    if (win) sendEvent(win.webContents, IpcChannel.transitBus, bus)
  })
  // The live feed and the weather are read only while their pills can be seen: not hidden, not
  // dimmed.
  const updateTransitVisible = (): void => {
    const visible = focus.isShown() && !screenCare.get().dimmed
    transit.setVisible(visible)
    weather.setVisible(visible)
    trips.setVisible(visible)
    // A card nobody can see needs no bus positions (the page closes it too, on blur).
    if (!visible) busRoute.watch(null)
  }
  status.subscribe((state) => toWindows(IpcChannel.statusChanged, state))
  autosync.subscribe((state) => toWindows(IpcChannel.autosyncChanged, state))
  coverMotion.subscribe((state) => toWindows(IpcChannel.coverMotionChanged, state))
  coverMotion.editor.subscribe((state) => toWindows(IpcChannel.coverEditorChanged, state))
  lyricsPicker.subscribe((state) => toWindows(IpcChannel.lyricsPickerChanged, state))
  // The editor's state goes to its own window and to nothing else; the Focus Screen gets the
  // colors through the lyrics. Closing the window ends the session, and with it the recording.
  colorEditor.subscribe((state) => {
    const win = lyricsEditor.getWindow()
    if (win) sendEvent(win.webContents, IpcChannel.lyricsColorsChanged, state)
  })
  // Coloring a song is using the screen too: the Focus Screen shows each change live.
  lyricsEditor.onChange((open) => {
    if (!open) colorEditor.close()
    screenCare.setBusy('lyricsEditor', open)
  })
  // "Pick Other Lyrics…" and "Color-Code Lyrics…" follow whether there's a song to work on.
  let menuCanPick = lyricsPicker.canOpen()
  let menuCanColor = canColorCode(lyrics.get())
  lyrics.subscribe((state) => {
    const canPick = lyricsPicker.canOpen()
    const canColor = canColorCode(state)
    if (canPick === menuCanPick && canColor === menuCanColor) return
    menuCanPick = canPick
    menuCanColor = canColor
    installAppMenu(menuContext())
  })
  let trayPreparing = false
  prepare.subscribe((state) => {
    toWindows(IpcChannel.prepareChanged, state)
    // The menu bar offers Stop while a run is on.
    if (state.running !== trayPreparing) {
      trayPreparing = state.running
      tray?.update(trayContext())
    }
  })
  screenCare.subscribe((state) => {
    toWindows(IpcChannel.screenCareChanged, state)
    updateTransitVisible()
  })
  backgroundPhoto.subscribe((photo) => toWindows(IpcChannel.backgroundPhotoChanged, photo))
  // Changing settings in Customize counts as using the screen.
  customize.onChange((open) => screenCare.setBusy('customize', open))
  // The To-do menu says Connect, Cancel or Disconnect, so it follows the sign-in.
  let todoMenuKey = ''
  todos.subscribe((state) => {
    toWindows(IpcChannel.todosChanged, state)
    const key = JSON.stringify([
      canvas.connection(),
      reminders?.connection() ?? null,
      google.connection(),
      google.hasClient(),
      state.sources.map((source) => source.connection)
    ])
    if (key !== todoMenuKey) {
      todoMenuKey = key
      installAppMenu(menuContext())
    }
  })
  // The brief: to-dos refresh when the window regains focus. Waking up counts too.
  app.on('browser-window-focus', () => todos.refreshIfOlderThan(FOCUS_REFRESH_MIN_AGE_SEC))
  powerMonitor.on('resume', () => {
    todos.refresh()
    calendar.refresh()
    transit.refresh()
    weather.refresh()
    trips.refresh()
  })

  hotkeys.subscribe((state) => {
    installAppMenu(menuContext())
    tray?.update(trayContext())
    toWindows(IpcChannel.hotkeysChanged, state)
  })

  focus.onChange(() => {
    // Nobody can arrange cards they can't see.
    if (!focus.isShown()) setEditingLayout(false)
    keepAwake.setShown(focus.isShown())
    updateTransitVisible()
    tray?.update(trayContext())
    installAppMenu(menuContext())
    toWindows(IpcChannel.placementChanged, focus.getPlacementInfo())
    toWindows(IpcChannel.displayChoicesChanged, focus.getDisplayChoices())
  })

  focus.start()
  updateTransitVisible()
  tray = createAppTray(trayContext())
  // With a menu bar or tray icon to come back through, closing the window doesn't quit
  // (Windows apps quit with their last window otherwise).
  app.on('window-all-closed', () => {
    if (!isMac && !tray) app.quit()
  })
  app.on('activate', () => focus.ensureWindow())
  app.on('second-instance', () => focus.ensureWindow())
  app.on('will-quit', () => {
    samples?.capture.dispose()
    samples?.client.dispose()
    // Gives the sound back at once if a playlist was being prepared.
    away.dispose()
    prepare.dispose()
    coverMotion.dispose()
    lyricsPicker.dispose()
    // Saves what's waiting and lets go of the audio helper.
    colorEditor.dispose()
    autosync.dispose()
    hotkeys.dispose()
    keepAwake.dispose()
    tray?.destroy()
    timer.dispose()
    haptics.dispose()
    screenCare.dispose()
    lyrics.dispose()
    romajiMaker.dispose()
    status.dispose()
    todos.dispose()
    calendar.dispose()
    busRoute.dispose()
    transit.dispose()
    weather.dispose()
    trips.dispose()
    // Stops the osascript pollers; they'd also die on their own once our end of the pipe closes.
    music.dispose()
  })
}

// One Focus Screen at a time; launching again just brings the existing one back.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('web-contents-created', (_event, contents) => hardenContents(contents))
  app
    .whenReady()
    .then(start)
    .catch((error: unknown) => {
      console.error('[app] Failed to start.', error)
      app.quit()
    })
}
