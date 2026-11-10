import { describe, expect, it } from 'vitest'
import type {
  AutoSyncState,
  ExamItem,
  HotkeyState,
  HotkeyStatus,
  MusicSettings,
  PlaybackState,
  PrepareState,
  TodoItem,
  TodoSourceState,
  TodoState
} from '../../../main/ipc'
import {
  autoSyncRow,
  movingPartsRow,
  calendarLabels,
  hotkeyNote,
  KEEP_AWAKE_CHOICES,
  lyricsChoice,
  lyricsPatch,
  prepareRow,
  sourceNames,
  sourceRows,
  menuScaleFromSlider,
  motionStrengthFromSlider,
  motionStrengthLabel
} from './customizeView'

const music: MusicSettings = {
  source: 'auto',
  cover: 'record',
  spinSpeed: 'normal',
  coverLight: 'sheen',
  coverGlow: false,
  movingParts: true,
  motionStrength: 1.5,
  showLyrics: true,
  lyricsStyle: 'full',
  showPlayerName: true,
  autoSync: false,
  romaji: true,
  prepareWhenAway: false,
  albumInk: false
}

function source(changes: Partial<TodoSourceState> = {}): TodoSourceState {
  return {
    id: 'google',
    name: 'Google Tasks',
    connection: 'connected',
    problem: null,
    syncedAt: 1,
    localCheckOffs: false,
    ...changes
  }
}

function state(sources: TodoSourceState[], changes: Partial<TodoState> = {}): TodoState {
  return {
    sources,
    items: [],
    exams: [],
    classes: [],
    supported: sources.map((s) => s.id),
    demo: false,
    notice: null,
    ...changes
  }
}

describe('lyricsChoice / lyricsPatch', () => {
  it('reads Off from the on/off setting and keeps the style', () => {
    expect(lyricsChoice(music)).toBe('full')
    expect(lyricsChoice({ ...music, showLyrics: false })).toBe('off')
    expect(lyricsPatch('off')).toEqual({ showLyrics: false })
    expect(lyricsPatch('synced')).toEqual({ showLyrics: true, lyricsStyle: 'synced' })
  })
})

describe('sourceRows', () => {
  it('offers Disconnect for a connected source', () => {
    expect(sourceRows(state([source()]))).toEqual([
      {
        id: 'google',
        name: 'Google Tasks',
        status: 'Connected · Two-way sync',
        action: {
          label: 'Disconnect',
          command: { kind: 'disconnect', source: 'google' },
          primary: false
        }
      }
    ])
  })

  it('says when Canvas check-offs stay on this computer', () => {
    const [row] = sourceRows(
      state([source({ id: 'canvas', name: 'Canvas', localCheckOffs: true })])
    )
    expect(row?.status).toBe('Connected · Calendar feed · check-offs stay on this computer')
  })

  it('shows a connected source’s problem in place of its note', () => {
    const [row] = sourceRows(
      state([source({ problem: { kind: 'offline', message: 'Couldn’t reach Google Tasks.' } })])
    )
    expect(row?.status).toBe('Connected · Couldn’t reach Google Tasks.')
    expect(row?.action?.label).toBe('Disconnect')
  })

  it('offers Connect, Reconnect or System Settings when signed out', () => {
    const rows = sourceRows(
      state([
        source({ id: 'canvas', name: 'Canvas', connection: 'disconnected', syncedAt: null }),
        source({
          connection: 'disconnected',
          problem: { kind: 'reconnect', message: 'Your Google sign-in expired.' }
        }),
        source({
          id: 'reminders',
          name: 'Apple Reminders',
          connection: 'disconnected',
          problem: { kind: 'permission', message: 'Focus Screen can’t see your reminders.' }
        })
      ])
    )
    expect(rows.map((r) => [r.status, r.action?.label, r.action?.primary])).toEqual([
      ['Not connected · Assignments and planner items', 'Connect', true],
      ['Your Google sign-in expired.', 'Reconnect', true],
      ['Focus Screen can’t see your reminders.', 'Open System Settings', true]
    ])
  })

  it('lets a Google sign-in be cancelled but not a macOS prompt', () => {
    const rows = sourceRows(
      state([
        source({ connection: 'connecting' }),
        source({ id: 'reminders', name: 'Apple Reminders', connection: 'connecting' })
      ])
    )
    expect(rows[0]?.action?.command).toEqual({ kind: 'cancelConnect', source: 'google' })
    expect(rows[1]?.action).toBeNull()
  })

  it('lists the real sources as signed out while the demo shows', () => {
    const demo = state([source({ id: 'canvas', name: 'Canvas' }), source()], {
      demo: true,
      supported: ['canvas', 'google']
    })
    expect(sourceRows(demo).map((r) => [r.name, r.action?.label])).toEqual([
      ['Canvas', 'Connect'],
      ['Google Tasks', 'Connect']
    ])
  })

  it('says what of your own is on this Mac, with nothing to connect', () => {
    const homework = source({ id: 'homework', name: 'Homework' })
    const mine = (id: string, done = false): TodoItem => ({
      id: `homework:${id}`,
      source: 'homework',
      title: id,
      context: 'MAT 265',
      course: 'MAT 265',
      due: null,
      done,
      completedAt: done ? 1 : null,
      pending: false
    })
    const exam = (id: string): ExamItem => ({
      id,
      title: 'Midterm',
      course: null,
      due: { kind: 'day', day: '2026-11-12' }
    })
    const status = (items: TodoItem[], exams: ExamItem[]): string | undefined =>
      sourceRows(state([homework], { items, exams }))[0]?.status

    expect(sourceRows(state([homework], { items: [mine('a')], exams: [exam('x')] }))).toEqual([
      { id: 'homework', name: 'Homework', status: 'On this Mac · 1 homework, 1 exam', action: null }
    ])
    expect(status([mine('a'), mine('b'), mine('c'), mine('d', true)], [exam('x'), exam('y')])).toBe(
      'On this Mac · 3 homework, 2 exams'
    )
    expect(status([], [exam('x')])).toBe('On this Mac · 1 exam')
    expect(status([mine('a')], [])).toBe('On this Mac · 1 homework')
    expect(status([], [])).toBe('On this Mac · add some with the + on the To-do card')
  })

  it('lists Homework as on this Mac while the demo shows', () => {
    const demo = state([source()], { demo: true, supported: ['canvas', 'homework', 'google'] })
    expect(sourceRows(demo)[1]).toEqual({
      id: 'homework',
      name: 'Homework',
      status: 'On this Mac',
      action: null
    })
  })
})

describe('sourceNames', () => {
  it('names the supported sources', () => {
    expect(sourceNames(state([], { supported: ['canvas', 'reminders', 'google'] }))).toBe(
      'Canvas, Apple Reminders, Google Tasks'
    )
  })
})

describe('hotkeyNote', () => {
  const taken: HotkeyStatus = {
    action: 'toggleFocusScreen',
    label: 'Show or hide the Focus Screen',
    keys: '⌃⌥⌘F',
    registered: false
  }
  const state = (enabled: boolean): HotkeyState => ({ enabled, hotkeys: [taken] })

  it('says when another app has the keys', () => {
    expect(hotkeyNote(state(true), taken)).toBe('Another app already uses these keys')
    expect(hotkeyNote(state(true), { ...taken, registered: true })).toBeNull()
  })

  it('says nothing while hotkeys are off', () => {
    expect(hotkeyNote(state(false), taken)).toBeNull()
  })
})

describe('movingPartsRow', () => {
  it('says what it does once set up', () => {
    expect(movingPartsRow('ready')).toEqual({
      hint: 'Parts of the cover you pick, like a wave or hair, move on their own',
      installed: true,
      detail: null
    })
  })

  it('says plainly when its add-on isn’t on this Mac', () => {
    expect(movingPartsRow('missing')).toEqual({
      hint: 'Needs the moving parts add-on, which isn’t installed on this Mac',
      installed: false,
      detail: 'Set it up from the project folder with npm run setup:covers'
    })
  })
})

describe('autoSyncRow', () => {
  const state = (problem: AutoSyncState['problem']): AutoSyncState => ({
    enabled: true,
    problem,
    trackId: null,
    stage: null,
    liveLine: null,
    heard: 0
  })

  it('explains what it does, or why it can’t', () => {
    expect(autoSyncRow(state(null))?.openSettings).toBe(false)
    expect(autoSyncRow(state('denied'))?.openSettings).toBe(true)
    expect(autoSyncRow(state(null))?.installed).toBe(true)
  })

  it('says plainly when its add-on isn’t on this Mac, the command only for whoever has the project', () => {
    const row = autoSyncRow(state('notInstalled'))
    expect(row?.hint).toBe('Needs the auto-sync add-on, which isn’t installed on this Mac')
    expect(row?.hint).not.toContain('setup')
    expect(row?.installed).toBe(false)
    expect(row?.detail).toBe('Set it up from the project folder with npm run setup:aligner')
  })

  it('is hidden where it can never work', () => {
    expect(autoSyncRow(state('unsupported'))).toBeNull()
    expect(autoSyncRow(null)).toBeNull()
  })
})

describe('prepareRow', () => {
  const auto: AutoSyncState = {
    enabled: true,
    problem: null,
    trackId: null,
    stage: null,
    liveLine: null,
    heard: 0
  }
  const idle: PrepareState = {
    running: false,
    trigger: null,
    blocker: null,
    ended: null,
    timed: 0,
    failed: 0,
    pending: 0,
    skipped: 0
  }

  it('says when a run is going while you’re away, and that it carries on after you’re back', () => {
    const away = { ...idle, running: true, trigger: 'away' as const, timed: 1, skipped: 2 }
    expect(prepareRow(away, auto, null, true)?.hint).toBe(
      'Playing it muted while you’re away · 1 timed · 2 skipped'
    )
    const back = { ...idle, trigger: 'away' as const, ended: 'cameBack' as const, timed: 1 }
    expect(prepareRow(back, auto, null, true)?.hint).toBe(
      'Paused when you came back: 1 timed · 0 skipped · Carries on when you’re away again'
    )
    // Switched off since: Start would play what's on now instead.
    expect(prepareRow(back, auto, null, false)?.hint).toBe(
      'Paused when you came back: 1 timed · 0 skipped'
    )
  })

  const playing = (playlistId: string | null, title = 'Fuel'): PlaybackState => ({
    player: { id: 'ytmSafari', name: 'YouTube Music' },
    track: {
      id: 'ytm:1',
      title,
      artist: 'Vivid BAD SQUAD',
      album: '',
      durationSec: 212,
      artwork: null
    },
    playing: true,
    positionSec: 0,
    positionAt: 0,
    shuffle: false,
    repeat: 'off',
    repeatModes: ['off'],
    problem: null,
    supportedPlayers: [],
    playlistId
  })

  it('names what Start would play before it starts', () => {
    expect(prepareRow(idle, auto, playing('PLabc'))).toEqual({
      hint: 'Plays this playlist from “Fuel” muted, and times the songs that need it',
      action: 'start',
      enabled: true
    })
    expect(prepareRow(idle, auto, playing('LM'))?.hint).toContain('your Liked Music from “Fuel”')
    expect(prepareRow(idle, auto, playing('OLAK5uy_x'))?.hint).toContain('this album')
  })

  it('says what it needs first: a playlist, not a song or a mix', () => {
    expect(prepareRow({ ...idle, blocker: 'noPlaylist' }, auto, playing('RDAMVMx'))).toEqual({
      hint: 'Play a playlist or album in YouTube Music, not a single song or a mix',
      action: 'start',
      enabled: false
    })
    expect(prepareRow({ ...idle, blocker: 'noYouTubeMusic' }, auto, null)?.hint).toBe(
      'Play the playlist you want in YouTube Music first'
    )
  })

  it('offers Stop with the counts while it runs, and says how the last run went', () => {
    const running = { ...idle, running: true, timed: 2, pending: 1, skipped: 5 }
    expect(prepareRow(running, auto, playing('PLabc'))).toEqual({
      hint: 'Playing it muted · 2 timed · 1 timing · 5 skipped',
      action: 'stop',
      enabled: true
    })
    const done = { ...idle, ended: 'done' as const, timed: 3, failed: 1, skipped: 9 }
    expect(prepareRow(done, auto, playing('PLabc', 'Hug'))?.hint).toBe(
      'Done: 3 timed · 1 couldn’t be timed · 9 skipped · Plays this playlist from “Hug” muted, and times the songs that need it'
    )
    expect(prepareRow({ ...done, blocker: 'lyricsHidden' }, auto, null)?.hint).toBe(
      'Done: 3 timed · 1 couldn’t be timed · 9 skipped · Turn lyrics on first'
    )
    expect(prepareRow({ ...idle, ended: 'muteFailed' }, auto, null)?.hint).toBe(
      'Couldn’t mute the player, so nothing was played'
    )
  })

  it('is hidden where auto-sync can never work', () => {
    expect(prepareRow(idle, { ...auto, problem: 'unsupported' }, null)).toBeNull()
    expect(prepareRow(null, auto, null)).toBeNull()
  })
})

describe('KEEP_AWAKE_CHOICES', () => {
  it('offers every setting once, the default first', () => {
    expect(KEEP_AWAKE_CHOICES.map((choice) => choice.value)).toEqual(['busy', 'always', 'never'])
  })
})

describe('calendarLabels', () => {
  it('adds the account only where two calendars share a name', () => {
    const labels = calendarLabels([
      { id: 'a', title: 'Classes', source: 'iCloud', color: '' },
      { id: 'b', title: 'Classes', source: 'Google', color: '' },
      { id: 'c', title: 'Work', source: 'Google', color: '' },
      { id: 'd', title: '', source: '', color: '' }
    ])
    expect([...labels.values()]).toEqual([
      'Classes · iCloud',
      'Classes · Google',
      'Work',
      'Untitled'
    ])
  })
})

describe('menuScaleFromSlider', () => {
  const limits = { min: 0.7, max: 1.2 }

  it('turns the slider’s percent into a size', () => {
    expect(menuScaleFromSlider(85, limits)).toBe(0.85)
    expect(menuScaleFromSlider(110.4, limits)).toBe(1.1)
  })

  it('lands on 100% when close to it', () => {
    expect(menuScaleFromSlider(97, limits)).toBe(1)
    expect(menuScaleFromSlider(103, limits)).toBe(1)
    expect(menuScaleFromSlider(96, limits)).toBe(0.96)
  })

  it('stays in range', () => {
    expect(menuScaleFromSlider(40, limits)).toBe(0.7)
    expect(menuScaleFromSlider(150, limits)).toBe(1.2)
  })
})

describe('moving parts strength', () => {
  it('reads the slider in tenths, held to 0.5–2.5', () => {
    expect(motionStrengthFromSlider(15)).toBe(1.5)
    expect(motionStrengthFromSlider(7)).toBe(0.7)
    expect(motionStrengthFromSlider(1)).toBe(0.5)
    expect(motionStrengthFromSlider(40)).toBe(2.5)
    expect(motionStrengthFromSlider(12.6)).toBe(1.3)
  })

  it('says it the way the user asked for it', () => {
    expect(motionStrengthLabel(1.5)).toBe('1.5×')
    expect(motionStrengthLabel(1)).toBe('1.0×')
    expect(motionStrengthLabel(2.5)).toBe('2.5×')
  })
})
