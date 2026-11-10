import type { ThemePreset, ThemeSettings } from '../../main/ipc'
import { contrast, fitContrast, onAccentColor, withAlpha } from './color'

/** Every color a theme sets. tokens.css holds Sun Devil Night for the first paint. */
export interface ThemeColors {
  bg: string
  card: string
  border: string
  borderStrong: string
  text: string
  textSecondary: string
  textDim: string
  discGroove: string
  discSurface: string
}

export interface PresetInfo {
  id: ThemePreset
  label: string
  /** Picking the theme also picks this accent; the accent can be changed afterwards. */
  accent: string
  colors: ThemeColors
}

/** The Customize mockup's four themes, in its order. Swatch colors are its bg / card / accent. */
export const PRESETS: readonly PresetInfo[] = [
  {
    id: 'night',
    label: 'Sun Devil Night',
    accent: '#FFC627',
    colors: {
      bg: '#000000',
      card: '#191919',
      border: '#2A2A2A',
      borderStrong: '#484848',
      text: '#FFFFFF',
      textSecondary: '#BFBFBF',
      textDim: '#9A9A9A',
      discGroove: '#0A0A0A',
      discSurface: '#161616'
    }
  },
  {
    id: 'maroon',
    label: 'Maroon & Gold',
    accent: '#FFC627',
    colors: {
      bg: '#5A1229',
      card: '#8C1D40',
      border: '#A8335A',
      borderStrong: '#C4587C',
      text: '#FFFFFF',
      textSecondary: '#F2D0DB',
      textDim: '#DBA5B8',
      discGroove: '#2A0812',
      discSurface: '#3A0C1A'
    }
  },
  {
    id: 'day',
    label: 'Daylight',
    accent: '#8C1D40',
    colors: {
      bg: '#E8E8E8',
      card: '#FFFFFF',
      border: '#D9D9D9',
      borderStrong: '#A6A6A6',
      text: '#111111',
      textSecondary: '#4D4D4D',
      textDim: '#6B6B6B',
      // A record is black whatever the room's lighting.
      discGroove: '#0A0A0A',
      discSurface: '#161616'
    }
  },
  {
    id: 'oled',
    label: 'OLED Dim',
    accent: '#747474',
    colors: {
      bg: '#000000',
      card: '#0D0D0D',
      border: '#1C1C1C',
      borderStrong: '#333333',
      // Dimmer text keeps OLED pixels from wearing in.
      text: '#C8C8C8',
      textSecondary: '#8F8F8F',
      textDim: '#707070',
      discGroove: '#050505',
      discSurface: '#0B0B0B'
    }
  }
]

/** The accent swatches on the Customize screen; any other color comes from the color picker. */
export const ACCENT_SWATCHES: readonly { color: string; label: string }[] = [
  { color: '#FFC627', label: 'Gold' },
  { color: '#8C1D40', label: 'Maroon' },
  { color: '#FF7F32', label: 'Orange' },
  { color: '#78BE20', label: 'Green' },
  { color: '#4AB7C4', label: 'Teal' },
  { color: '#00A3E0', label: 'Blue' },
  { color: '#747474', label: 'Grey' }
]

/** Cards let a photo or blurred cover show through, just enough to see it. */
const CARD_OPACITY_OVER_PICTURE = 0.78
/** An accent nobody chose by hand still has to read as text on the cards. */
const MIN_ART_ACCENT_CONTRAST = 3
/** Words read from the desk: the usual floor for text, for every tier and the accent's. */
const MIN_TEXT_CONTRAST = 4.5
/**
 * The lightest ground dark glass shows over a picture: the brightest color the living background
 * can give (a yellow at backgroundShade's ceiling) under its veil and glass.css's smoky glass. Over
 * that, the theme's quieter greys fell to 1.9:1, so they're fitted to this instead.
 */
const GLASS_GROUND_OVER_PICTURE = '#4E4A27'

export function presetInfo(id: ThemePreset): PresetInfo {
  return PRESETS.find((preset) => preset.id === id) ?? (PRESETS[0] as PresetInfo)
}

/**
 * The accent in use: the cover's color when that's turned on and the song has one (made
 * readable on this theme's cards), otherwise the user's own.
 */
export function effectiveAccent(theme: ThemeSettings, artAccent: string | null): string {
  if (theme.accentFromArt && artAccent) {
    return fitContrast(artAccent, presetInfo(theme.preset).colors.card, MIN_ART_ACCENT_CONTRAST)
  }
  return theme.accent
}

/** The weather pill's icons, as drawn on Night; other themes nudge them until they read. */
const WEATHER_ICONS = {
  sun: '#FFC627',
  moon: '#D9D9E8',
  cloud: '#BFBFBF',
  rain: '#5AB4F0',
  storm: '#B48CF0',
  snow: '#CFE8FF'
} as const
/** WCAG's floor for graphics: an icon needs 3:1 where words need 4.5:1. */
export const MIN_ICON_CONTRAST = 3

function weatherIcons(ground: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(WEATHER_ICONS).map(([name, color]) => [
      `--weather-${name}`,
      contrast(color, ground) >= MIN_ICON_CONTRAST
        ? color
        : fitContrast(color, ground, MIN_ICON_CONTRAST)
    ])
  )
}

/**
 * A trip's "live" words (the trip card's rides): the To-do card's Google green, as on the mockup,
 * nudged where it doesn't read as words (lighter on Maroon, darker on Daylight).
 */
const TRIP_LIVE = '#78BE20'

/** `color` as it is when it already reads on `ground`, else nudged until it does. */
function readable(color: string, ground: string): string {
  return contrast(color, ground) >= MIN_TEXT_CONTRAST
    ? color
    : fitContrast(color, ground, MIN_TEXT_CONTRAST)
}

/**
 * What the cards' words and icons are read against: the theme's card, or on a dark theme's glass
 * over a picture, the brightest that glass gets. Colors are fitted to it (`--weather-*`, singers).
 */
export function cardGround(theme: ThemeSettings, glassOverPicture: boolean): string {
  return glassOverPicture && theme.preset !== 'day'
    ? GLASS_GROUND_OVER_PICTURE
    : presetInfo(theme.preset).colors.card
}

/**
 * The CSS custom properties for a theme, ready to set on the root element. `glassOverPicture`:
 * Glass cards with a picture behind them (Living colors, the cover, a photo), where the dark
 * themes' quieter text is lifted to read on the brightest the glass gets.
 */
export function themeVariables(
  theme: ThemeSettings,
  artAccent: string | null,
  overPicture: boolean,
  glassOverPicture = false
): Record<string, string> {
  const { colors } = presetInfo(theme.preset)
  const accent = effectiveAccent(theme, artAccent)
  const glassy = glassOverPicture && theme.preset !== 'day'
  const ground = cardGround(theme, glassOverPicture)
  return {
    '--bg': colors.bg,
    '--card': overPicture ? withAlpha(colors.card, CARD_OPACITY_OVER_PICTURE) : colors.card,
    '--border': colors.border,
    '--border-strong': colors.borderStrong,
    '--text': colors.text,
    '--text-secondary': glassy ? readable(colors.textSecondary, ground) : colors.textSecondary,
    '--text-dim': glassy ? readable(colors.textDim, ground) : colors.textDim,
    '--disc-groove': colors.discGroove,
    '--disc-surface': colors.discSurface,
    '--accent': accent,
    // The accent as words: a light accent on Daylight, or a dark one on Night, still reads.
    '--accent-text': readable(accent, ground),
    '--on-accent': onAccentColor(accent),
    '--trip-live': readable(TRIP_LIVE, ground),
    ...weatherIcons(ground)
  }
}
