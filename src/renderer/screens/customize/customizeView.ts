import type {
  AutoSyncState,
  CalendarInfo,
  HotkeyState,
  HotkeyStatus,
  KeepAwake,
  MusicSettings,
  PlaybackState,
  PlaylistKind,
  PrepareBlocker,
  PrepareEnd,
  PrepareState,
  TodoCommand,
  TodoSourceId,
  TodoSourceState,
  TodoState
} from '../../../main/ipc'
import { playlistKind } from '../../../main/services/autosync/types'
import { TODO_SOURCE_NAMES } from '../../../main/services/todos/types'
import { prepareCounts } from '../../widgets/music/prepareView'

/** 0 is Never. */
export const IDLE_PRESETS = [5, 15, 30, 0] as const

export const KEEP_AWAKE_CHOICES: readonly { value: KeepAwake; label: string; hint: string }[] = [
  {
    value: 'busy',
    label: 'While music or a timer runs',
    hint: 'Otherwise your screens sleep and lock on their usual schedule.'
  },
  {
    value: 'always',
    label: 'Always',
    hint: 'Your screens won’t sleep or lock on their own while the Focus Screen is up.'
  },
  { value: 'never', label: 'Never', hint: 'Your screens sleep on their usual schedule.' }
]

/**
 * A row for something that needs an add-on: what it does, or (not installed) that it needs one,
 * in words anyone using the app can act on. `detail` (a tooltip) has the setup command for
 * whoever has the project folder; friends running the app don't.
 */
export interface AddOnRow {
  hint: string
  installed: boolean
  detail: string | null
}

const notInstalled = (name: string, command: string): AddOnRow => ({
  hint: `Needs the ${name} add-on, which isn’t installed on this Mac`,
  installed: false,
  detail: `Set it up from the project folder with ${command}`
})

/** The auto-sync row, and whether it needs the System Settings button; null hides it. */
export function autoSyncRow(
  state: AutoSyncState | null
): (AddOnRow & { openSettings: boolean }) | null {
  switch (state?.problem) {
    case undefined:
    case 'unsupported':
      return null
    case 'notInstalled':
      return { ...notInstalled('auto-sync', 'npm run setup:aligner'), openSettings: false }
    case 'denied':
      return {
        hint: 'Focus Screen Audio isn’t allowed to hear your music player',
        installed: true,
        detail: null,
        openSettings: true
      }
    case null:
      return {
        hint: 'Times lyrics that have no timing yet, by listening once on this Mac',
        installed: true,
        detail: null,
        openSettings: false
      }
  }
}

/** The moving parts row (only shown on a Mac, where they can be set up). */
export function movingPartsRow(setup: 'ready' | 'missing'): AddOnRow {
  return setup === 'missing'
    ? notInstalled('moving parts', 'npm run setup:covers')
    : {
        hint: 'Parts of the cover you pick, like a wave or hair, move on their own',
        installed: true,
        detail: null
      }
}

const PREPARE_ENDED: Record<PrepareEnd, string> = {
  done: 'Done',
  stopped: 'Stopped',
  cameBack: 'Paused when you came back',
  paused: 'Stopped: YouTube Music paused',
  disconnected: 'Stopped: lost touch with YouTube Music',
  autoSyncOff: 'Stopped: auto-sync was turned off',
  limit: 'Stopped at the safety limit (6 hours or 200 songs)',
  muteFailed: 'Couldn’t mute the player, so nothing was played'
}

const PREPARE_NEEDS: Record<PrepareBlocker, string> = {
  autoSyncOff: 'Turn on Auto-sync plain lyrics first',
  lyricsHidden: 'Turn lyrics on first',
  noYouTubeMusic: 'Play the playlist you want in YouTube Music first',
  noPlaylist: 'Play a playlist or album in YouTube Music, not a single song or a mix'
}

const PLAYLIST_NAMES: Record<Exclude<PlaylistKind, 'radio'>, string> = {
  liked: 'your Liked Music',
  album: 'this album',
  playlist: 'this playlist'
}

/** What Start would prepare: "Plays this playlist from “Fuel” muted…"; null if it can't tell. */
function prepareTarget(music: PlaybackState | null): string | null {
  const kind = playlistKind(music?.playlistId)
  const title = music?.track?.title
  if (!kind || kind === 'radio' || !title) return null
  return `Plays ${PLAYLIST_NAMES[kind]} from “${title}” muted, and times the songs that need it`
}

/** The "Prepare while I'm away" switch's hint. */
export const PREPARE_AWAY_HINT =
  'After 5 min without keyboard or mouse, prepares the playlist on in YouTube Music (the browser goes quiet, even if it was playing); stops the moment you’re back'

/**
 * The "Prepare playlist" row: its hint and its button (Start, or Stop while running); null
 * hides it wherever auto-sync can't run at all. Before a start it names what would be played.
 * `away`: "Prepare while I'm away" is on.
 */
export function prepareRow(
  state: PrepareState | null,
  autoSync: AutoSyncState | null,
  music: PlaybackState | null,
  away = false
): { hint: string; action: 'start' | 'stop'; enabled: boolean } | null {
  if (!state || !autoSync || autoSync.problem === 'unsupported') return null
  if (state.running) {
    const how = state.trigger === 'away' ? 'Playing it muted while you’re away' : 'Playing it muted'
    return { hint: `${how} · ${prepareCounts(state)}`, action: 'stop', enabled: true }
  }
  const outcome =
    state.ended === null
      ? null
      : state.ended === 'muteFailed'
        ? PREPARE_ENDED.muteFailed
        : `${PREPARE_ENDED[state.ended]}: ${prepareCounts(state)}`
  const target = prepareTarget(music)
  const next = state.blocker
    ? PREPARE_NEEDS[state.blocker]
    : state.ended === 'cameBack' && away
      ? 'Carries on when you’re away again'
      : target
  return {
    hint: [outcome, next].filter((part) => part !== null).join(' · '),
    action: 'start',
    enabled: state.blocker === null
  }
}

/** Why a hotkey isn't working, if it isn't; nothing while they're all off. */
export function hotkeyNote(state: HotkeyState, hotkey: HotkeyStatus): string | null {
  return state.enabled && !hotkey.registered ? 'Another app already uses these keys' : null
}

/** The mockup's three lyrics buttons, made from two settings: on/off and the style. */
export type LyricsChoice = 'synced' | 'full' | 'off'

export function lyricsChoice(music: MusicSettings): LyricsChoice {
  return music.showLyrics ? music.lyricsStyle : 'off'
}

/** Turning lyrics off keeps the style, so turning them back on returns to it. */
export function lyricsPatch(choice: LyricsChoice): Partial<MusicSettings> {
  return choice === 'off' ? { showLyrics: false } : { showLyrics: true, lyricsStyle: choice }
}

/** A source's button in the To-do sources section. */
export interface SourceAction {
  label: string
  command: TodoCommand
  /** Filled in the accent (Connect) rather than outlined (Disconnect, Cancel). */
  primary: boolean
}

export interface SourceRow {
  id: TodoSourceId
  name: string
  /** "Connected · Two-way sync", "Not connected · …", or what went wrong. */
  status: string
  action: SourceAction | null
}

/** What each source does, as the mockup words it. */
const NOTES: Record<TodoSourceId, string> = {
  canvas: 'Assignments and planner items',
  homework: 'On this Mac',
  reminders: 'Two-way sync',
  google: 'Two-way sync'
}

const connect = (source: TodoSourceId, label = 'Connect'): SourceAction => ({
  label,
  command: { kind: 'connect', source },
  primary: true
})

function connectedNote(source: TodoSourceState): string {
  // The read-only feed can't send check-offs back, so don't promise sync.
  if (source.id === 'canvas' && source.localCheckOffs) {
    return 'Calendar feed · check-offs stay on this computer'
  }
  return NOTES[source.id]
}

/** "On this Mac · 3 homework, 1 exam": Homework has nothing to connect, only what's in it. */
function homeworkStatus(state: TodoState): string {
  const homework = state.items.filter((item) => item.source === 'homework' && !item.done).length
  const exams = state.exams.length
  const parts = [
    ...(homework > 0 ? [`${homework} homework`] : []),
    ...(exams > 0 ? [`${exams} ${exams === 1 ? 'exam' : 'exams'}`] : [])
  ]
  return parts.length > 0
    ? `${NOTES.homework} · ${parts.join(', ')}`
    : `${NOTES.homework} · add some with the + on the To-do card`
}

function rowFor(source: TodoSourceState, state: TodoState): SourceRow {
  const base = { id: source.id, name: source.name }
  if (source.id === 'homework') return { ...base, status: homeworkStatus(state), action: null }
  const { problem } = source

  if (source.connection === 'connected') {
    return {
      ...base,
      status: `Connected · ${problem ? problem.message : connectedNote(source)}`,
      action: problem?.kind === 'permission' ? permission(source.id) : disconnect(source.id)
    }
  }
  if (source.connection === 'connecting') {
    if (source.id === 'reminders') {
      return { ...base, status: 'Click Allow in the macOS message', action: null }
    }
    if (source.id === 'google') {
      return {
        ...base,
        status: 'Finish signing in in your web browser',
        action: {
          label: 'Cancel',
          command: { kind: 'cancelConnect', source: 'google' },
          primary: false
        }
      }
    }
    return { ...base, status: 'Connecting…', action: null }
  }
  if (problem && problem.kind !== 'offline') {
    return {
      ...base,
      status: problem.message,
      action:
        problem.kind === 'permission'
          ? permission(source.id)
          : connect(source.id, problem.kind === 'reconnect' ? 'Reconnect' : 'Connect')
    }
  }
  return { ...base, status: `Not connected · ${NOTES[source.id]}`, action: connect(source.id) }
}

function disconnect(source: TodoSourceId): SourceAction {
  return { label: 'Disconnect', command: { kind: 'disconnect', source }, primary: false }
}

function permission(source: TodoSourceId): SourceAction {
  return {
    label: 'Open System Settings',
    command: { kind: 'openPrivacySettings', source },
    primary: true
  }
}

/**
 * One row per source this computer supports. While the dev demo list shows, every real source
 * is signed out (that's when the demo shows), so the rows say so instead of listing the demo.
 */
export function sourceRows(state: TodoState | null): SourceRow[] {
  if (!state) return []
  if (state.demo) {
    return state.supported.map((id) =>
      id === 'homework'
        ? { id, name: TODO_SOURCE_NAMES[id], status: NOTES[id], action: null }
        : {
            id,
            name: TODO_SOURCE_NAMES[id],
            status: `Not connected · ${NOTES[id]}`,
            action: connect(id)
          }
    )
  }
  return state.sources.map((source) => rowFor(source, state))
}

/** "Canvas, Apple Reminders, Google Tasks": the To-do list toggle's hint. */
export function sourceNames(state: TodoState | null): string {
  const ids = state?.supported ?? ['canvas', 'google']
  return ids.map((id) => TODO_SOURCE_NAMES[id]).join(', ')
}

/**
 * What each class-calendar button says: the calendar's name, plus its account when two
 * calendars share a name ("Classes · iCloud", "Classes · Google").
 */
export function calendarLabels(calendars: readonly CalendarInfo[]): Map<string, string> {
  const count = new Map<string, number>()
  for (const calendar of calendars) {
    count.set(calendar.title, (count.get(calendar.title) ?? 0) + 1)
  }
  return new Map(
    calendars.map((calendar) => {
      const title = calendar.title || 'Untitled'
      const shared = (count.get(calendar.title) ?? 0) > 1 && calendar.source
      return [calendar.id, shared ? `${title} · ${calendar.source}` : title]
    })
  )
}

/** Within this many percent of 100, the size slider lands on 100, so the usual size is easy to find. */
const MENU_SIZE_SNAP = 3

/** The right-click menu size for a slider position in percent, kept in range and snapped near 100%. */
export function menuScaleFromSlider(percent: number, limits: { min: number; max: number }): number {
  const snapped = Math.abs(percent - 100) <= MENU_SIZE_SNAP ? 100 : Math.round(percent)
  return Math.min(Math.max(snapped, limits.min * 100), limits.max * 100) / 100
}

/** The moving parts' strength, as the settings hold it (0.5–2.5 in tenths). */
const MOTION_STRENGTH = { min: 0.5, max: 2.5 }

/** The strength slider moves in tenths (5–25); its value as a strength. */
export function motionStrengthFromSlider(tenths: number): number {
  const clamped = Math.min(
    Math.max(Math.round(tenths), MOTION_STRENGTH.min * 10),
    MOTION_STRENGTH.max * 10
  )
  return clamped / 10
}

/** "1.5×": how much the parts move, against how far they first moved. */
export function motionStrengthLabel(strength: number): string {
  return `${strength.toFixed(1)}×`
}
