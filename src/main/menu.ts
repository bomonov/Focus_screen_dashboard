import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type {
  CardId,
  MusicSettings,
  ShowOn,
  TimerLength,
  TimerSettings,
  TodoConnection
} from './ipc'
import { lengthItems } from './lengthMenu'
import { BREAK_PICKS, COUNTDOWN_PICKS, FOCUS_PICKS } from './services/timer/lengths'
import { isDev } from './paths'
import { isMac } from './platform'
import { findDisplay, displayMenuLabel, placementLabel } from './services/display/placement'
import type { NumberedDisplay, Placement } from './services/display/placement'

export interface MenuContext {
  displays: NumberedDisplay[]
  placement: Placement
  showOn: ShowOn
  choose(showOn: ShowOn): void
  timer: TimerSettings
  setTimer(change: Partial<TimerSettings>): void
  /** "Set on the Timer Card…": opens the card's wheels on that length. */
  timerEdit: {
    /** The Timer card is on. */
    shown: boolean
    /** The timer isn't running or paused, so its length can be set. */
    enabled: boolean
    open(length: TimerLength): void
  }
  music: MusicSettings
  setMusic(change: Partial<MusicSettings>): void
  /** The Focus Screen is up, rather than hidden or closed. */
  focusShown: boolean
  setFocusShown(shown: boolean): void
  /** The live show/hide hotkey, shown next to the item; null while it isn't registered. */
  toggleAccelerator: string | null
  /** Moving and resizing the cards on the Focus Screen. */
  layout: {
    editing: boolean
    setEditing(on: boolean): void
    /** False while the cards are in the default arrangement. */
    custom: boolean
    reset(): void
  }
  /** Opens the Customize window. */
  openCustomize(): void
  /** Shows a pairing code for the YouTube Music browser extension. */
  connectBrowser(): void
  lyrics: {
    setVisible(on: boolean): void
    nudge(direction: 'earlier' | 'later'): void
    reset(): void
    /** Opens the song's versions to choose from, on the Focus Screen. */
    pickOther(): void
    /** A real song is on with lyrics shown. */
    canPickOther: boolean
    /** Opens the Color-Code Lyrics window on the song that's on. */
    colorCode(): void
    /** A song is on with words to color (not an instrumental). */
    canColorCode: boolean
  }
  /** The demo player switch; null outside dev builds. */
  demoMusic: { enabled: boolean; toggle(): void } | null
  todos: {
    canvas: TodoConnection
    connectCanvas(): void
    disconnectCanvas(): void
    google: TodoConnection
    hasGoogleClient: boolean
    connectGoogle(): void
    cancelGoogle(): void
    disconnectGoogle(): void
    chooseGoogleClient(): void
    /** null where Reminders doesn't exist (Windows). */
    reminders: TodoConnection | null
    connectReminders(): void
    disconnectReminders(): void
    /** null while no source is connected. */
    refresh: (() => void) | null
  }
  /** The demo to-do list switch; null outside dev builds. */
  demoTodos: { enabled: boolean; toggle(): void } | null
  /** Made-up classes for Next class; null outside dev builds. */
  demoClasses: { enabled: boolean; toggle(): void } | null
  demoBuses: { enabled: boolean; toggle(): void } | null
  demoWeather: { enabled: boolean; toggle(): void } | null
  demoTrips: { enabled: boolean; toggle(): void } | null
  /** Records songs for measuring lyric aligners; null outside dev builds on a Mac. */
  autosyncSamples: { enabled: boolean; toggle(): void } | null
}

function displayItems(ctx: MenuContext): MenuItemConstructorOptions[] {
  const { displays, placement, showOn, choose } = ctx
  const chosenMissing = showOn.kind === 'display' && !findDisplay(displays, showOn)

  const items: MenuItemConstructorOptions[] = [
    {
      label:
        showOn.kind === 'auto'
          ? `Automatic (now: ${placementLabel(placement)})`
          : 'Automatic (second screen when connected)',
      type: 'checkbox',
      checked: showOn.kind === 'auto',
      click: () => choose({ kind: 'auto' })
    },
    { type: 'separator' },
    ...displays.map((display): MenuItemConstructorOptions => ({
      label: displayMenuLabel(display),
      type: 'checkbox',
      checked: showOn.kind === 'display' && !chosenMissing && placement.display.id === display.id,
      click: () => choose({ kind: 'display', id: display.id, label: display.label })
    }))
  ]

  if (showOn.kind === 'display' && chosenMissing) {
    // Explain why the window isn't where the user put it.
    items.push({
      label: `${showOn.label || 'Chosen display'} (not connected)`,
      type: 'checkbox',
      checked: true,
      enabled: false
    })
  }

  items.push({
    label: 'Floating window',
    type: 'checkbox',
    checked: showOn.kind === 'floating',
    click: () => choose({ kind: 'floating' })
  })
  return items
}

function choiceItems<T>(
  options: readonly (readonly [T, string])[],
  current: T,
  pick: (value: T) => void
): MenuItemConstructorOptions[] {
  return options.map(([value, label]) => ({
    label,
    type: 'checkbox',
    checked: value === current,
    click: () => pick(value)
  }))
}

function timerItems(ctx: MenuContext): MenuItemConstructorOptions[] {
  const { timer, setTimer, timerEdit } = ctx
  const edit = (length: TimerLength): Parameters<typeof lengthItems>[3] => ({
    shown: timerEdit.shown,
    enabled: timerEdit.enabled,
    open: () => timerEdit.open(length)
  })
  return [
    {
      label: 'Style',
      submenu: choiceItems(
        [
          ['ring', 'Ring'],
          ['bar', 'Bar'],
          ['flip', 'Flip digits']
        ] as const,
        timer.style,
        (style) => setTimer({ style })
      )
    },
    {
      label: 'Direction',
      submenu: choiceItems(
        [
          ['down', 'Count down'],
          ['up', 'Count up']
        ] as const,
        timer.direction,
        (direction) => setTimer({ direction })
      )
    },
    {
      label: 'Focus length',
      submenu: lengthItems(
        FOCUS_PICKS,
        timer.focusSec,
        (focusSec) => setTimer({ focusSec }),
        edit('focus')
      )
    },
    {
      label: 'Break length',
      submenu: lengthItems(
        BREAK_PICKS,
        timer.breakSec,
        (breakSec) => setTimer({ breakSec }),
        edit('break')
      )
    },
    {
      label: 'Countdown length',
      submenu: lengthItems(
        COUNTDOWN_PICKS,
        timer.countdownSec,
        (countdownSec) => setTimer({ countdownSec }),
        edit('countdown')
      )
    },
    { type: 'separator' },
    {
      label: 'Chime when time is up',
      type: 'checkbox',
      checked: timer.chime,
      click: () => setTimer({ chime: !timer.chime })
    },
    {
      label: 'Auto-start breaks',
      type: 'checkbox',
      checked: timer.autoStartBreaks,
      click: () => setTimer({ autoStartBreaks: !timer.autoStartBreaks })
    }
  ]
}

function musicItems(ctx: MenuContext): MenuItemConstructorOptions[] {
  const { music, setMusic, lyrics } = ctx
  return [
    {
      label: 'Show Lyrics',
      type: 'checkbox',
      checked: music.showLyrics,
      accelerator: 'CmdOrCtrl+L',
      click: () => lyrics.setVisible(!music.showLyrics)
    },
    // Saved per song. These keys work while we're in front; the global ⌃⌥⌘[ / ⌃⌥⌘] work anywhere.
    {
      label: 'Show Lyrics Earlier',
      accelerator: 'CmdOrCtrl+[',
      enabled: music.showLyrics,
      click: () => lyrics.nudge('earlier')
    },
    {
      label: 'Show Lyrics Later',
      accelerator: 'CmdOrCtrl+]',
      enabled: music.showLyrics,
      click: () => lyrics.nudge('later')
    },
    {
      label: 'Reset Lyrics Timing',
      enabled: music.showLyrics,
      click: () => lyrics.reset()
    },
    {
      label: 'Pick Other Lyrics…',
      enabled: lyrics.canPickOther,
      click: () => lyrics.pickOther()
    },
    {
      label: 'Color-Code Lyrics…',
      enabled: lyrics.canColorCode,
      click: () => lyrics.colorCode()
    },
    { type: 'separator' },
    {
      label: 'Cover',
      submenu: choiceItems(
        [
          ['record', 'Spinning record'],
          ['animated', 'Animated cover']
        ] as const,
        music.cover,
        (cover) => setMusic({ cover })
      )
    },
    music.cover === 'record'
      ? {
          label: 'Disc spin',
          submenu: choiceItems(
            [
              ['normal', 'Normal'],
              ['slow', 'Slow'],
              ['still', 'Still']
            ] as const,
            music.spinSpeed,
            (spinSpeed) => setMusic({ spinSpeed })
          )
        }
      : {
          label: 'Cover light',
          submenu: choiceItems(
            [
              ['none', 'None'],
              ['sheen', 'Sheen'],
              ['sparkle', 'Sparkle']
            ] as const,
            music.coverLight,
            (coverLight) => setMusic({ coverLight })
          )
        },
    ...(music.cover === 'animated'
      ? [
          {
            label: 'Backlight',
            type: 'checkbox',
            checked: music.coverGlow,
            click: () => setMusic({ coverGlow: !music.coverGlow })
          } satisfies MenuItemConstructorOptions
        ]
      : []),
    { type: 'separator' },
    { label: 'Connect Browser Extension…', click: () => ctx.connectBrowser() }
  ]
}

function todoItems(ctx: MenuContext): MenuItemConstructorOptions[] {
  const { todos } = ctx
  const google: MenuItemConstructorOptions =
    todos.google === 'connected'
      ? { label: 'Disconnect Google Tasks…', click: () => todos.disconnectGoogle() }
      : todos.google === 'connecting'
        ? { label: 'Cancel Google Sign-in', click: () => todos.cancelGoogle() }
        : { label: 'Connect Google Tasks…', click: () => todos.connectGoogle() }
  const refresh = todos.refresh
  const canvas: MenuItemConstructorOptions =
    todos.canvas === 'connected'
      ? { label: 'Disconnect Canvas…', click: () => todos.disconnectCanvas() }
      : { label: 'Connect Canvas…', click: () => todos.connectCanvas() }
  // Nothing to confirm: reconnecting takes one click, and macOS keeps its permission.
  const reminders: MenuItemConstructorOptions[] =
    todos.reminders === null
      ? []
      : [
          { type: 'separator' },
          todos.reminders === 'disconnected'
            ? { label: 'Connect Apple Reminders', click: () => todos.connectReminders() }
            : { label: 'Disconnect Apple Reminders', click: () => todos.disconnectReminders() }
        ]
  return [
    canvas,
    ...reminders,
    { type: 'separator' },
    google,
    {
      label: 'Choose Google OAuth Client File…',
      // Swapping clients signs out, so only offer it while signed out.
      enabled: todos.google === 'disconnected',
      visible: todos.hasGoogleClient,
      click: () => todos.chooseGoogleClient()
    },
    { type: 'separator' },
    { label: 'Refresh To-dos', enabled: refresh !== null, click: () => refresh?.() }
  ]
}

function demoItems(ctx: MenuContext): MenuItemConstructorOptions[] {
  const { demoMusic, demoTodos, demoClasses, demoBuses, demoWeather, demoTrips, autosyncSamples } =
    ctx
  const items: MenuItemConstructorOptions[] = []
  if (demoMusic) {
    items.push({
      label: 'Demo Player When No Music App Is Open',
      type: 'checkbox',
      checked: demoMusic.enabled,
      click: () => demoMusic.toggle()
    })
  }
  if (demoTodos) {
    items.push({
      label: 'Demo To-dos When No Source Is Connected',
      type: 'checkbox',
      checked: demoTodos.enabled,
      click: () => demoTodos.toggle()
    })
  }
  if (demoClasses) {
    items.push({
      label: 'Demo Classes for Next Class',
      type: 'checkbox',
      checked: demoClasses.enabled,
      click: () => demoClasses.toggle()
    })
  }
  if (demoBuses) {
    items.push({
      label: 'Demo Buses for Next Bus',
      type: 'checkbox',
      checked: demoBuses.enabled,
      click: () => demoBuses.toggle()
    })
  }
  if (demoWeather) {
    items.push({
      label: 'Demo Weather',
      type: 'checkbox',
      checked: demoWeather.enabled,
      click: () => demoWeather.toggle()
    })
  }
  if (demoTrips) {
    items.push({
      label: 'Demo Trips',
      type: 'checkbox',
      checked: demoTrips.enabled,
      click: () => demoTrips.toggle()
    })
  }
  if (autosyncSamples) {
    items.push({
      label: 'Record Songs for Auto-sync Tests',
      type: 'checkbox',
      checked: autosyncSamples.enabled,
      click: () => autosyncSamples.toggle()
    })
  }
  return items
}

function showHideItem(ctx: MenuContext): MenuItemConstructorOptions {
  return {
    label: ctx.focusShown ? 'Hide Focus Screen' : 'Show Focus Screen',
    // Only a hint: the global hotkey already handles these keys.
    ...(ctx.toggleAccelerator
      ? { accelerator: ctx.toggleAccelerator, registerAccelerator: false }
      : {}),
    click: () => ctx.setFocusShown(!ctx.focusShown)
  }
}

function layoutItems(ctx: MenuContext): MenuItemConstructorOptions[] {
  const { layout } = ctx
  return [
    {
      label: layout.editing ? 'Done Editing Layout' : 'Edit Layout',
      click: () => layout.setEditing(!layout.editing)
    },
    { label: 'Reset Layout', enabled: layout.custom, click: () => layout.reset() }
  ]
}

function customizeItem(ctx: MenuContext): MenuItemConstructorOptions {
  return { label: 'Customize…', accelerator: 'CmdOrCtrl+,', click: () => ctx.openCustomize() }
}

export function installAppMenu(ctx: MenuContext): void {
  const template: MenuItemConstructorOptions[] = [
    isMac
      ? {
          label: 'Focus Screen',
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            customizeItem(ctx),
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        }
      : { label: 'File', submenu: [customizeItem(ctx), { type: 'separator' }, { role: 'quit' }] },
    // Without it, ⌘C / ⌘V / ⌘A do nothing in text fields on macOS (the Canvas form).
    { role: 'editMenu' },
    {
      label: 'Display',
      submenu: [
        showHideItem(ctx),
        { type: 'separator' },
        ...layoutItems(ctx),
        { type: 'separator' },
        ...displayItems(ctx)
      ]
    },
    { label: 'Timer', submenu: timerItems(ctx) },
    { label: 'Music', submenu: musicItems(ctx) },
    { label: 'To-do', submenu: todoItems(ctx) },
    ...(isDev
      ? [
          {
            label: 'Develop',
            submenu: [
              { role: 'reload' as const },
              { role: 'forceReload' as const },
              { role: 'toggleDevTools' as const },
              { type: 'separator' as const },
              ...demoItems(ctx)
            ]
          }
        ]
      : []),
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/**
 * Right-click on the Focus Screen: the quick settings, without leaving the display. Drawn by the
 * page on glass like the dots' menus, so every item has its own click (roles only work natively).
 */
export function quickMenuItems(ctx: MenuContext, win: BrowserWindow): MenuItemConstructorOptions[] {
  return [
    customizeItem(ctx),
    ...layoutItems(ctx),
    { type: 'separator' },
    { label: 'Show Focus Screen on', enabled: false },
    ...displayItems(ctx),
    { type: 'separator' },
    { label: 'Timer', submenu: timerItems(ctx) },
    { label: 'Music', submenu: musicItems(ctx) },
    { label: 'To-do', submenu: todoItems(ctx) },
    { type: 'separator' },
    ...(isDev
      ? [
          ...demoItems(ctx),
          { label: 'Toggle Developer Tools', click: () => win.webContents.toggleDevTools() }
        ]
      : []),
    showHideItem(ctx),
    { label: 'Quit Focus Screen', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
  ]
}

/** A card's own items, for its status dot's glass menu (the status lines go above them). */
export function cardMenuItems(ctx: MenuContext, card: CardId): MenuItemConstructorOptions[] {
  return card === 'music' ? musicItems(ctx) : card === 'todos' ? todoItems(ctx) : timerItems(ctx)
}

/** Right-click in a text field: the usual editing commands instead of the Customize menu. */
export function popupEditMenu(win: BrowserWindow): void {
  Menu.buildFromTemplate([
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
    { type: 'separator' },
    { role: 'selectAll' }
  ]).popup({ window: win })
}
