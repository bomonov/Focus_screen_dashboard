import { describe, expect, it } from 'vitest'
import {
  applySettingsPatch,
  DEFAULT_ACCENT,
  defaultDisplaySettings,
  defaultMusicSettings,
  defaultSettings,
  defaultThemeSettings,
  defaultTimerSettings,
  defaultWidgetSettings,
  parseSettings
} from './schema'

describe('parseSettings', () => {
  it('returns defaults for non-objects', () => {
    expect(parseSettings(undefined)).toEqual(defaultSettings())
    expect(parseSettings(null)).toEqual(defaultSettings())
    expect(parseSettings('hello')).toEqual(defaultSettings())
    expect(parseSettings([1, 2])).toEqual(defaultSettings())
  })

  it('keeps valid values', () => {
    const raw = {
      version: 1,
      display: {
        showOn: { kind: 'display', id: 42, label: 'DELL U2720Q' },
        idleDimMinutes: 15,
        burnInShift: false,
        alwaysOnTop: true,
        hideCursor: false,
        keepAwake: 'always'
      },
      theme: {
        preset: 'day',
        accent: '#8C1D40',
        background: 'photo',
        accentFromArt: true,
        glass: true,
        quickMenuScale: 0.85
      },
      widgets: {
        music: false,
        todos: true,
        timer: false,
        clock: true,
        nextClass: true,
        nextBus: true,
        weather: true,
        trips: true,
        layout: {
          music: { x: 0, y: 0, w: 8, h: 12 },
          todos: { x: 8, y: 0, w: 12, h: 7 },
          timer: { x: 8, y: 7, w: 12, h: 5 }
        }
      },
      timer: {
        style: 'flip',
        direction: 'up',
        focusSec: 2235,
        breakSec: 900,
        countdownSec: 5400,
        focusMinutes: 37,
        breakMinutes: 15,
        countdownMinutes: 90,
        chime: false,
        autoStartBreaks: true
      },
      music: {
        cover: 'animated',
        spinSpeed: 'slow',
        coverLight: 'sparkle',
        coverGlow: true,
        movingParts: false,
        motionStrength: 2,
        showLyrics: false,
        lyricsStyle: 'full',
        showPlayerName: false,
        autoSync: true,
        romaji: false,
        prepareWhenAway: true,
        albumInk: true
      },
      hotkeys: { enabled: false },
      todos: { reminders: true },
      nextClass: {
        calendars: ['A1B2-C3', 'classes@group.calendar.google.com'],
        school: { name: 'Purdue University', country: 'US' }
      },
      nextBus: { stops: ['3102', '10'], routes: ['VENU'], order: ['VENU\n10', '72\n3102'] },
      weather: { unit: 'c' },
      trips: { arriveEarlyMin: 10 }
    }
    expect(parseSettings(raw)).toEqual(raw)
  })

  it('leaves Reminders off unless settings.json says true', () => {
    expect(parseSettings({}).todos.reminders).toBe(false)
    expect(parseSettings({ todos: { reminders: 'yes' } }).todos.reminders).toBe(false)
    expect(parseSettings({ todos: { reminders: true } }).todos.reminders).toBe(true)
  })

  it('accepts floating and auto', () => {
    expect(parseSettings({ display: { showOn: { kind: 'floating' } } }).display.showOn).toEqual({
      kind: 'floating'
    })
    expect(parseSettings({ display: { showOn: { kind: 'auto' } } }).display.showOn).toEqual({
      kind: 'auto'
    })
  })

  it('falls back per field, keeping the valid ones', () => {
    const parsed = parseSettings({
      display: { showOn: { kind: 'floating' } },
      theme: { accent: 'gold' }
    })
    expect(parsed.display.showOn).toEqual({ kind: 'floating' })
    expect(parsed.theme.accent).toBe(DEFAULT_ACCENT)
  })

  it('rejects a display choice without a usable id or label', () => {
    expect(
      parseSettings({ display: { showOn: { kind: 'display', id: '2' } } }).display.showOn
    ).toEqual({ kind: 'auto' })
    expect(
      parseSettings({ display: { showOn: { kind: 'display', id: Number.NaN, label: 'x' } } })
        .display.showOn
    ).toEqual({ kind: 'auto' })
    expect(
      parseSettings({ display: { showOn: { kind: 'display', id: 1 } } }).display.showOn
    ).toEqual({ kind: 'auto' })
  })

  it('drops unknown keys', () => {
    const parsed = parseSettings({ theme: { accent: '#FFFFFF', extra: true }, junk: 1 })
    expect(parsed).toEqual({
      ...defaultSettings(),
      theme: { ...defaultThemeSettings(), accent: '#FFFFFF' }
    })
  })

  it('fills in timer defaults for files saved before the timer existed', () => {
    const parsed = parseSettings({ version: 1, display: { showOn: { kind: 'auto' } } })
    expect(parsed.timer).toEqual(defaultTimerSettings())
  })

  it('validates timer fields one by one', () => {
    const parsed = parseSettings({
      timer: {
        style: 'sand',
        direction: 'sideways',
        focusMinutes: 50,
        breakMinutes: 0,
        countdownMinutes: 2.5,
        chime: 'yes',
        autoStartBreaks: true
      }
    })
    expect(parsed.timer).toEqual({
      ...defaultTimerSettings(),
      focusSec: 3000,
      focusMinutes: 50,
      autoStartBreaks: true
    })
  })

  it('keeps timer lengths in seconds, from 1 s to 23:59:59', () => {
    const parsed = parseSettings({ timer: { focusSec: 90, breakSec: 1, countdownSec: 86399 } })
    expect(parsed.timer.focusSec).toBe(90)
    expect(parsed.timer.breakSec).toBe(1)
    expect(parsed.timer.countdownSec).toBe(86399)
    expect(defaultTimerSettings()).toMatchObject({
      focusSec: 1500,
      breakSec: 300,
      countdownSec: 600
    })
  })

  it('reads the minutes of a file saved before lengths had seconds', () => {
    const parsed = parseSettings({
      timer: { focusMinutes: 45, breakMinutes: 7, countdownMinutes: 1440 }
    })
    expect(parsed.timer.focusSec).toBe(2700)
    expect(parsed.timer.breakSec).toBe(420)
    // A whole day was the old countdown's longest; now 23:59:59 is.
    expect(parsed.timer.countdownSec).toBe(86399)
  })

  it('reads the minutes only when there are no seconds at all', () => {
    const parsed = parseSettings({ timer: { focusSec: 0, focusMinutes: 45 } })
    expect(parsed.timer.focusSec).toBe(1500)
  })

  it('also writes the lengths in whole minutes, for an older build after a rollback', () => {
    const parsed = parseSettings({ timer: { focusSec: 90, breakSec: 86399, countdownSec: 20 } })
    expect(parsed.timer.focusMinutes).toBe(2)
    // Within the older build's limits, which would throw anything longer away.
    expect(parsed.timer.breakMinutes).toBe(60)
    expect(parsed.timer.countdownMinutes).toBe(1)
    expect(parseSettings({ timer: { focusSec: 86399 } }).timer.focusMinutes).toBe(240)
    expect(parseSettings({ timer: { countdownSec: 86399 } }).timer.countdownMinutes).toBe(1440)
  })

  it('fills in moving parts and clamps motion strength', () => {
    expect(parseSettings({}).music.movingParts).toBe(true)
    expect(parseSettings({}).music.motionStrength).toBe(1.5)
    expect(parseSettings({ music: { movingParts: false } }).music.movingParts).toBe(false)
    expect(parseSettings({ music: { motionStrength: 9 } }).music.motionStrength).toBe(2.5)
    expect(parseSettings({ music: { motionStrength: 0.1 } }).music.motionStrength).toBe(0.5)
    expect(parseSettings({ music: { motionStrength: '2' } }).music.motionStrength).toBe(1.5)
  })

  it('fills in music defaults and rejects unknown spin speeds', () => {
    expect(parseSettings({ version: 1 }).music).toEqual(defaultMusicSettings())
    expect(parseSettings({ music: { spinSpeed: 'fast' } }).music.spinSpeed).toBe('normal')
    expect(parseSettings({ music: { spinSpeed: 'still' } }).music.spinSpeed).toBe('still')
    expect(parseSettings({ music: { showLyrics: 'yes' } }).music.showLyrics).toBe(true)
    expect(parseSettings({ music: { cover: 'gif' } }).music.cover).toBe('record')
    expect(parseSettings({ music: { cover: 'animated' } }).music.cover).toBe('animated')
    expect(parseSettings({ music: { coverLight: 'ripple' } }).music.coverLight).toBe('sheen')
    expect(parseSettings({ music: { coverLight: 'none' } }).music.coverLight).toBe('none')
    // Its old name, from before the glow had its own switch.
    expect(parseSettings({ music: { coverLight: 'glow' } }).music.coverLight).toBe('none')
  })

  it('keeps the cover’s backlight off unless it’s turned on', () => {
    expect(parseSettings({}).music.coverGlow).toBe(false)
    expect(parseSettings({ music: { coverGlow: true } }).music.coverGlow).toBe(true)
    expect(parseSettings({ music: { coverGlow: 'yes' } }).music.coverGlow).toBe(false)
    expect(parseSettings({ music: { showLyrics: false } }).music.showLyrics).toBe(false)
  })

  it('rejects timer lengths outside their limits', () => {
    const parsed = parseSettings({
      timer: { focusSec: 86400, breakSec: 0, countdownSec: 2.5 }
    })
    expect(parsed.timer.focusSec).toBe(1500)
    expect(parsed.timer.breakSec).toBe(300)
    expect(parsed.timer.countdownSec).toBe(600)
  })

  it('fills in the Customize settings for files saved before M7', () => {
    const parsed = parseSettings({
      version: 1,
      display: { showOn: { kind: 'floating' } },
      theme: { accent: '#4AB7C4' },
      music: { spinSpeed: 'slow', showLyrics: false }
    })
    expect(parsed.display).toEqual({ ...defaultDisplaySettings(), showOn: { kind: 'floating' } })
    expect(parsed.theme).toEqual({ ...defaultThemeSettings(), accent: '#4AB7C4' })
    expect(parsed.widgets).toEqual(defaultWidgetSettings())
    expect(parsed.music).toEqual({
      ...defaultMusicSettings(),
      spinSpeed: 'slow',
      showLyrics: false
    })
  })

  it('validates the Customize fields one by one', () => {
    const parsed = parseSettings({
      display: { idleDimMinutes: -1, burnInShift: 'no', alwaysOnTop: true },
      theme: { preset: 'neon', background: 'photo', accentFromArt: 1 },
      widgets: { music: false, clock: 'off' },
      music: { lyricsStyle: 'karaoke', showPlayerName: false }
    })
    expect(parsed.display).toEqual({ ...defaultDisplaySettings(), alwaysOnTop: true })
    expect(parsed.theme).toEqual({ ...defaultThemeSettings(), background: 'photo' })
    expect(parsed.widgets).toEqual({ ...defaultWidgetSettings(), music: false })
    expect(parsed.music).toEqual({ ...defaultMusicSettings(), showPlayerName: false })
  })

  it('keeps the right-click menu size between 70% and 120%, to the percent', () => {
    expect(defaultThemeSettings().quickMenuScale).toBe(1)
    const scale = (value: unknown): number =>
      parseSettings({ theme: { quickMenuScale: value } }).theme.quickMenuScale
    expect(scale(0.85)).toBe(0.85)
    expect(scale(0.8349)).toBe(0.83)
    expect(scale(0.7)).toBe(0.7)
    expect(scale(1.2)).toBe(1.2)
    expect(scale(0.5)).toBe(1)
    expect(scale(3)).toBe(1)
    expect(scale('small')).toBe(1)
  })

  it('accepts idle dim from never (0) up to four hours', () => {
    expect(parseSettings({ display: { idleDimMinutes: 0 } }).display.idleDimMinutes).toBe(0)
    expect(parseSettings({ display: { idleDimMinutes: 240 } }).display.idleDimMinutes).toBe(240)
    expect(parseSettings({ display: { idleDimMinutes: 241 } }).display.idleDimMinutes).toBe(5)
    expect(parseSettings({ display: { idleDimMinutes: 2.5 } }).display.idleDimMinutes).toBe(5)
  })
})

describe('albumInk', () => {
  it('is off until the lyrics box turns it on', () => {
    expect(defaultSettings().music.albumInk).toBe(false)
    expect(parseSettings({ music: { albumInk: 'yes' } }).music.albumInk).toBe(false)
    expect(parseSettings({ music: { albumInk: true } }).music.albumInk).toBe(true)
    expect(
      applySettingsPatch(defaultSettings(), { music: { albumInk: true } }).music.albumInk
    ).toBe(true)
  })
})

describe('romaji', () => {
  it('is on until it is turned off', () => {
    expect(defaultSettings().music.romaji).toBe(true)
    expect(parseSettings({ music: { romaji: 'no' } }).music.romaji).toBe(true)
    expect(applySettingsPatch(defaultSettings(), { music: { romaji: false } }).music.romaji).toBe(
      false
    )
  })
})

describe('auto-sync', () => {
  it('stays off until it is turned on', () => {
    expect(defaultSettings().music.autoSync).toBe(false)
    expect(parseSettings({ music: { autoSync: 'yes' } }).music.autoSync).toBe(false)
    expect(
      applySettingsPatch(defaultSettings(), { music: { autoSync: true } }).music.autoSync
    ).toBe(true)
  })

  it('prepares while away only once asked to', () => {
    expect(defaultSettings().music.prepareWhenAway).toBe(false)
    expect(parseSettings({ music: { prepareWhenAway: 1 } }).music.prepareWhenAway).toBe(false)
    expect(
      applySettingsPatch(defaultSettings(), { music: { prepareWhenAway: true } }).music
        .prepareWhenAway
    ).toBe(true)
  })
})

describe('next class', () => {
  it('stays off with no calendars until chosen', () => {
    expect(defaultSettings().widgets.nextClass).toBe(false)
    expect(defaultSettings().nextClass.calendars).toEqual([])
  })

  it('keeps only calendar ids that look real, once each', () => {
    const parsed = parseSettings({
      nextClass: { calendars: ['A', 'A', '', 7, 'x'.repeat(601), 'B'] }
    })
    expect(parsed.nextClass.calendars).toEqual(['A', 'B'])
    expect(parseSettings({ nextClass: { calendars: 'A' } }).nextClass.calendars).toEqual([])
    // ASU unless a school is picked; a malformed one keeps what was there.
    expect(parseSettings({}).nextClass.school).toEqual({
      name: 'Arizona State University',
      country: 'US'
    })
    for (const school of [{ name: '', country: 'US' }, { name: 'X', country: 'usa' }, 'Purdue']) {
      expect(parseSettings({ nextClass: { school } }).nextClass.school.name).toBe(
        'Arizona State University'
      )
    }
  })

  it('takes the class calendars from Customize', () => {
    const next = applySettingsPatch(defaultSettings(), {
      widgets: { nextClass: true },
      nextClass: { calendars: ['A'] }
    })
    expect(next.widgets.nextClass).toBe(true)
    expect(next.nextClass.calendars).toEqual(['A'])
  })
})

describe('next bus', () => {
  it('is off with no stops until Customize says otherwise', () => {
    expect(defaultSettings().widgets.nextBus).toBe(false)
    expect(defaultSettings().nextBus).toEqual({ stops: [], routes: [], order: [] })
  })

  it('keeps only short, distinct stop and route ids', () => {
    const parsed = parseSettings({
      nextBus: {
        stops: ['3102', '3102', '', 7, 'x'.repeat(101), '10'],
        routes: 'VENU',
        order: ['VENU\n3102', 'VENU\n3102', 72]
      }
    })
    expect(parsed.nextBus).toEqual({ stops: ['3102', '10'], routes: [], order: ['VENU\n3102'] })
  })

  it('keeps at most ten stops', () => {
    const stops = Array.from({ length: 12 }, (_, i) => String(i))
    expect(parseSettings({ nextBus: { stops } }).nextBus.stops).toHaveLength(10)
  })

  it('takes stops and routes from Customize', () => {
    const next = applySettingsPatch(defaultSettings(), {
      widgets: { nextBus: true },
      nextBus: { stops: ['3102'] }
    })
    expect(next.widgets.nextBus).toBe(true)
    expect(next.nextBus).toEqual({ stops: ['3102'], routes: [], order: [] })
  })

  it('takes the Bus pill’s order from its list, leaving the stops be', () => {
    const picked = applySettingsPatch(defaultSettings(), { nextBus: { stops: ['3102'] } })
    const next = applySettingsPatch(picked, { nextBus: { order: ['72\n3102', 'VENU\n3102'] } })
    expect(next.nextBus).toEqual({ stops: ['3102'], routes: [], order: ['72\n3102', 'VENU\n3102'] })
  })
})

describe('weather', () => {
  it('defaults weather off, in °F', () => {
    expect(defaultSettings().widgets.weather).toBe(false)
    expect(defaultSettings().weather).toEqual({ unit: 'f' })
  })

  it('keeps a saved unit and drops a bad one', () => {
    expect(parseSettings({ weather: { unit: 'c' } }).weather.unit).toBe('c')
    expect(parseSettings({ weather: { unit: 'k' } }).weather.unit).toBe('f')
  })

  it('patches weather', () => {
    const next = applySettingsPatch(defaultSettings(), {
      widgets: { weather: true },
      weather: { unit: 'c' }
    })
    expect(next.widgets.weather).toBe(true)
    expect(next.weather.unit).toBe('c')
  })
})

describe('trips', () => {
  it('defaults trips off, arriving 5 minutes early for class', () => {
    expect(defaultSettings().widgets.trips).toBe(false)
    expect(defaultSettings().trips).toEqual({ arriveEarlyMin: 5 })
  })

  it('holds how early to whole minutes from 0 to 30', () => {
    const early = (value: unknown): number =>
      parseSettings({ trips: { arriveEarlyMin: value } }).trips.arriveEarlyMin
    expect(early(10)).toBe(10)
    expect(early(-3)).toBe(0)
    expect(early(45)).toBe(30)
    expect(early(7.6)).toBe(8)
    expect(early('x')).toBe(5)
    expect(early(Number.NaN)).toBe(5)
    expect(early(null)).toBe(5)
  })

  it('patches trips', () => {
    const next = applySettingsPatch(defaultSettings(), {
      widgets: { trips: true },
      trips: { arriveEarlyMin: 12 }
    })
    expect(next.widgets.trips).toBe(true)
    expect(next.trips.arriveEarlyMin).toBe(12)
  })
})

describe('keep awake and hotkeys', () => {
  it('keeps the screens awake only while busy unless chosen otherwise', () => {
    expect(defaultSettings().display.keepAwake).toBe('busy')
    expect(parseSettings({ display: { keepAwake: 'never' } }).display.keepAwake).toBe('never')
    expect(parseSettings({ display: { keepAwake: true } }).display.keepAwake).toBe('busy')
  })

  it('turns global hotkeys on unless settings.json says false', () => {
    expect(parseSettings({}).hotkeys.enabled).toBe(true)
    expect(parseSettings({ hotkeys: { enabled: 'no' } }).hotkeys.enabled).toBe(true)
    expect(parseSettings({ hotkeys: { enabled: false } }).hotkeys.enabled).toBe(false)
  })
})

describe('applySettingsPatch', () => {
  const current = parseSettings({
    display: { showOn: { kind: 'floating' }, idleDimMinutes: 15 },
    theme: { preset: 'maroon', accent: '#4AB7C4' },
    timer: { focusMinutes: 45 },
    todos: { reminders: true }
  })

  it('changes only the fields in the patch', () => {
    const next = applySettingsPatch(current, { timer: { style: 'bar' }, widgets: { clock: false } })
    expect(next).toEqual({
      ...current,
      timer: { ...current.timer, style: 'bar' },
      widgets: { ...current.widgets, clock: false }
    })
  })

  it('keeps the current value when a patched value is invalid', () => {
    const next = applySettingsPatch(current, {
      timer: { focusSec: 0, breakSec: 600 },
      theme: { accent: 'red', preset: 'day' },
      display: { showOn: { kind: 'display', id: 'two' }, idleDimMinutes: 999 }
    })
    expect(next.timer.focusSec).toBe(2700)
    expect(next.timer.breakSec).toBe(600)
    expect(next.timer.breakMinutes).toBe(10)
    expect(next.theme).toEqual({ ...current.theme, preset: 'day' })
    expect(next.display).toEqual(current.display)
  })

  it('saves a card layout and drops one that doesn’t fit the grid', () => {
    const layout = {
      music: { x: 8, y: 0, w: 12, h: 12 },
      todos: { x: 0, y: 0, w: 8, h: 6 },
      timer: { x: 0, y: 6, w: 8, h: 6 }
    }
    const moved = applySettingsPatch(current, { widgets: { layout } })
    expect(moved.widgets.layout).toEqual(layout)
    const broken = { ...layout, timer: { x: 0, y: 6, w: 8, h: 9 } }
    expect(applySettingsPatch(moved, { widgets: { layout: broken } }).widgets.layout).toEqual(
      layout
    )
    expect(applySettingsPatch(moved, { widgets: { layout: null } }).widgets.layout).toBeNull()
  })

  it('makes room for a card that comes back on', () => {
    // With the timer off, the to-do list took the whole right side.
    const withoutTimer = applySettingsPatch(current, {
      widgets: {
        timer: false,
        layout: {
          music: { x: 0, y: 0, w: 12, h: 12 },
          todos: { x: 12, y: 0, w: 8, h: 12 },
          timer: { x: 12, y: 7, w: 8, h: 5 }
        }
      }
    })
    const next = applySettingsPatch(withoutTimer, { widgets: { timer: true } })
    expect(next.widgets.layout).toBeNull()

    const room = applySettingsPatch(withoutTimer, {
      widgets: {
        layout: {
          music: { x: 0, y: 0, w: 8, h: 12 },
          todos: { x: 14, y: 0, w: 6, h: 12 },
          timer: { x: 12, y: 7, w: 8, h: 5 }
        }
      }
    })
    const back = applySettingsPatch(room, { widgets: { timer: true } })
    expect(back.widgets.layout?.todos).toEqual({ x: 14, y: 0, w: 6, h: 12 })
    // As big as the free columns allow, as close as it gets to where it was.
    expect(back.widgets.layout?.timer).toEqual({ x: 8, y: 7, w: 6, h: 5 })
  })

  it('replaces the display choice as a whole', () => {
    const next = applySettingsPatch(current, {
      display: { showOn: { kind: 'display', id: 7, label: 'DELL S2716DG' } }
    })
    expect(next.display.showOn).toEqual({ kind: 'display', id: 7, label: 'DELL S2716DG' })
    expect(next.display.idleDimMinutes).toBe(15)
  })

  it('can turn hotkeys off and change when the screens stay awake', () => {
    const next = applySettingsPatch(current, {
      hotkeys: { enabled: false },
      display: { keepAwake: 'never' }
    })
    expect(next.hotkeys.enabled).toBe(false)
    expect(next.display).toEqual({ ...current.display, keepAwake: 'never' })
  })

  it('never lets a patch turn sources on or change the version', () => {
    const next = applySettingsPatch(current, { todos: { reminders: false }, version: 2 })
    expect(next).toEqual(current)
  })

  it('ignores patches that are not objects', () => {
    expect(applySettingsPatch(current, null)).toBe(current)
    expect(applySettingsPatch(current, 'theme')).toBe(current)
    expect(applySettingsPatch(current, { music: 'loud' })).toEqual(current)
  })
})
