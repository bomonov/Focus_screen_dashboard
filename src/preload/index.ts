import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import {
  IpcChannel,
  type EventChannels,
  type FocusScreenApi,
  type InvokeChannels,
  type SendChannels
} from '../main/ipc'

function invoke<K extends keyof InvokeChannels>(
  channel: K,
  ...args: InvokeChannels[K]['args']
): Promise<InvokeChannels[K]['result']> {
  return ipcRenderer.invoke(channel, ...args)
}

function send<K extends keyof SendChannels>(channel: K, ...args: SendChannels[K]): void {
  ipcRenderer.send(channel, ...args)
}

function subscribe<K extends keyof EventChannels>(
  channel: K,
  listener: (payload: EventChannels[K]) => void
): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: EventChannels[K]): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

// The renderer gets these named functions only, never ipcRenderer itself.
const api: FocusScreenApi = {
  getSettings: () => invoke(IpcChannel.settingsGet),
  onSettingsChanged: (listener) => subscribe(IpcChannel.settingsChanged, listener),
  updateSettings: (patch) => send(IpcChannel.settingsUpdate, patch),
  getPlacement: () => invoke(IpcChannel.placementGet),
  onPlacementChanged: (listener) => subscribe(IpcChannel.placementChanged, listener),
  getDisplayChoices: () => invoke(IpcChannel.displayChoicesGet),
  onDisplayChoicesChanged: (listener) => subscribe(IpcChannel.displayChoicesChanged, listener),
  getScreenCare: () => invoke(IpcChannel.screenCareGet),
  onScreenCareChanged: (listener) => subscribe(IpcChannel.screenCareChanged, listener),
  reportActivity: () => send(IpcChannel.displayActivity),
  getLayoutEditing: () => invoke(IpcChannel.layoutEditingGet),
  onLayoutEditingChanged: (listener) => subscribe(IpcChannel.layoutEditingChanged, listener),
  setLayoutEditing: (on) => send(IpcChannel.layoutEditingSet, on),
  getBackgroundPhoto: () => invoke(IpcChannel.backgroundPhotoGet),
  chooseBackgroundPhoto: () => invoke(IpcChannel.backgroundPhotoChoose),
  onBackgroundPhotoChanged: (listener) => subscribe(IpcChannel.backgroundPhotoChanged, listener),
  getHotkeys: () => invoke(IpcChannel.hotkeysGet),
  onHotkeysChanged: (listener) => subscribe(IpcChannel.hotkeysChanged, listener),
  openCustomize: () => send(IpcChannel.customizeOpen),
  closeCustomize: () => send(IpcChannel.customizeClose),
  getTimer: () => invoke(IpcChannel.timerGet),
  onTimerChanged: (listener) => subscribe(IpcChannel.timerChanged, listener),
  onTimerChime: (listener) => subscribe(IpcChannel.timerChime, listener),
  onTimerEditLength: (listener) => subscribe(IpcChannel.timerEditLength, listener),
  takeTimerEdit: () => invoke(IpcChannel.timerEditTake),
  sendTimerCommand: (command) => send(IpcChannel.timerCommand, command),
  timerHaptic: (what) => send(IpcChannel.timerHaptic, what),
  getMusic: () => invoke(IpcChannel.musicGet),
  onMusicChanged: (listener) => subscribe(IpcChannel.musicChanged, listener),
  sendMusicCommand: (command) => send(IpcChannel.musicCommand, command),
  openAutomationSettings: () => send(IpcChannel.musicOpenAutomationSettings),
  pairBrowser: () => send(IpcChannel.musicPairBrowser),
  getLyrics: () => invoke(IpcChannel.lyricsGet),
  onLyricsChanged: (listener) => subscribe(IpcChannel.lyricsChanged, listener),
  sendLyricsCommand: (command) => send(IpcChannel.lyricsCommand, command),
  getAutoSync: () => invoke(IpcChannel.autosyncGet),
  onAutoSyncChanged: (listener) => subscribe(IpcChannel.autosyncChanged, listener),
  openAudioCaptureSettings: () => send(IpcChannel.autosyncOpenSettings),
  getPrepare: () => invoke(IpcChannel.prepareGet),
  onPrepareChanged: (listener) => subscribe(IpcChannel.prepareChanged, listener),
  sendPrepareCommand: (command) => send(IpcChannel.prepareCommand, command),
  getCoverMotion: () => invoke(IpcChannel.coverMotionGet),
  onCoverMotionChanged: (listener) => subscribe(IpcChannel.coverMotionChanged, listener),
  getCoverEditor: () => invoke(IpcChannel.coverEditorGet),
  onCoverEditorChanged: (listener) => subscribe(IpcChannel.coverEditorChanged, listener),
  sendCoverEditorCommand: (command) => send(IpcChannel.coverEditorCommand, command),
  getLyricsPicker: () => invoke(IpcChannel.lyricsPickerGet),
  onLyricsPickerChanged: (listener) => subscribe(IpcChannel.lyricsPickerChanged, listener),
  sendLyricsPickerCommand: (command) => send(IpcChannel.lyricsPickerCommand, command),
  getLyricsColorEditor: () => invoke(IpcChannel.lyricsColorsGet),
  onLyricsColorEditorChanged: (listener) => subscribe(IpcChannel.lyricsColorsChanged, listener),
  sendLyricsColorEditorCommand: (command) => send(IpcChannel.lyricsColorsCommand, command),
  getTodos: () => invoke(IpcChannel.todosGet),
  onTodosChanged: (listener) => subscribe(IpcChannel.todosChanged, listener),
  sendTodoCommand: (command) => send(IpcChannel.todosCommand, command),
  onTodoConnectForm: (listener) => subscribe(IpcChannel.todosConnectForm, listener),
  sendCanvasForm: (request) => invoke(IpcChannel.todosCanvasForm, request),
  sendHomework: (request) => invoke(IpcChannel.todosHomework, request),
  onHomeworkForm: (listener) => subscribe(IpcChannel.todosHomeworkForm, listener),
  getCalendar: () => invoke(IpcChannel.calendarGet),
  getClassPlace: (location) => invoke(IpcChannel.calendarPlace, location),
  openClassMap: (mapKey) => send(IpcChannel.calendarOpenMap, mapKey),
  onCalendarChanged: (listener) => subscribe(IpcChannel.calendarChanged, listener),
  sendCalendarCommand: (command) => send(IpcChannel.calendarCommand, command),
  getSchool: () => invoke(IpcChannel.schoolGet),
  onSchoolChanged: (listener) => subscribe(IpcChannel.schoolChanged, listener),
  searchSchools: (query) => invoke(IpcChannel.schoolSearch, query),
  sendSchoolCommand: (command) => send(IpcChannel.schoolCommand, command),
  getTransit: () => invoke(IpcChannel.transitGet),
  onTransitChanged: (listener) => subscribe(IpcChannel.transitChanged, listener),
  searchBusStops: (query) => invoke(IpcChannel.transitSearch, query),
  sendTransitCommand: (command) => send(IpcChannel.transitCommand, command),
  getBusRoute: (arrivalId) => invoke(IpcChannel.transitRoute, arrivalId),
  watchBus: (arrivalId) => send(IpcChannel.transitWatch, arrivalId),
  onBusMoved: (listener) => subscribe(IpcChannel.transitBus, listener),
  getWeather: () => invoke(IpcChannel.weatherGet),
  onWeatherChanged: (listener) => subscribe(IpcChannel.weatherChanged, listener),
  sendWeatherCommand: (command) => send(IpcChannel.weatherCommand, command),
  getTrips: () => invoke(IpcChannel.tripsGet),
  onTripsChanged: (listener) => subscribe(IpcChannel.tripsChanged, listener),
  sendTripCommand: (command) => send(IpcChannel.tripsCommand, command),
  searchPlaces: (text) => invoke(IpcChannel.tripsSearch, text),
  searchApplePlaces: (text) => invoke(IpcChannel.tripsSearchApple, text),
  getCardStatuses: () => invoke(IpcChannel.statusGet),
  onCardStatusesChanged: (listener) => subscribe(IpcChannel.statusChanged, listener),
  getCardMenu: (card) => invoke(IpcChannel.statusCardMenu, card),
  getQuickMenu: (target) => invoke(IpcChannel.quickMenu, target),
  pickCardMenu: (token, id) => send(IpcChannel.statusCardMenuPick, token, id),
  pathForFile: (file) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('focusScreen', api)
