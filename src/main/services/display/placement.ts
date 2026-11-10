import type { ShowOn } from '../settings/schema'
import type { DisplayChoice } from './types'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The parts of Electron's `Display` we use, so placement logic is testable without Electron. */
export interface DisplayInfo {
  id: number
  label: string
  internal: boolean
  bounds: Rect
  workArea: Rect
}

export interface NumberedDisplay extends DisplayInfo {
  /** 1-based number shown to the user ("Display 2"). The main display is always 1. */
  number: number
  primary: boolean
}

export interface Placement {
  kind: 'fullscreen' | 'floating'
  display: NumberedDisplay
}

/** Main display first, then the rest left to right (top to bottom on ties). */
export function numberDisplays(
  displays: readonly DisplayInfo[],
  primaryId: number
): NumberedDisplay[] {
  const primary = displays.filter((d) => d.id === primaryId)
  const others = displays
    .filter((d) => d.id !== primaryId)
    .sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)
  return [...primary, ...others].map((d, index) => ({
    ...d,
    number: index + 1,
    primary: d.id === primaryId
  }))
}

/**
 * Finds a saved display. Ids usually survive replugging, but when they don't we fall back to the
 * label, only if it's unambiguous (two identical monitors share a label).
 */
export function findDisplay(
  displays: readonly NumberedDisplay[],
  target: { id: number; label: string }
): NumberedDisplay | undefined {
  const byId = displays.find((d) => d.id === target.id)
  if (byId) return byId
  const byLabel = displays.filter((d) => d.label !== '' && d.label === target.label)
  return byLabel.length === 1 ? byLabel[0] : undefined
}

export function resolvePlacement(displays: readonly NumberedDisplay[], showOn: ShowOn): Placement {
  const primary = displays.find((d) => d.primary) ?? displays[0]
  if (!primary) throw new Error('No displays connected')

  const floating: Placement = { kind: 'floating', display: primary }
  const auto = (): Placement => {
    const second = displays.find((d) => !d.primary)
    // With a single screen, taking it over fullscreen would hide everything else the user has open.
    return second ? { kind: 'fullscreen', display: second } : floating
  }

  switch (showOn.kind) {
    case 'floating':
      return floating
    case 'auto':
      return auto()
    case 'display': {
      const chosen = findDisplay(displays, showOn)
      return chosen ? { kind: 'fullscreen', display: chosen } : auto()
    }
  }
}

/** Two placements with the same key can share a window; a different key needs a new one. */
export function placementKey(placement: Placement): string {
  // A floating window stays wherever the user dragged it, whatever display that is.
  return placement.kind === 'floating' ? 'floating' : `fullscreen:${placement.display.id}`
}

export function placementLabel(placement: Placement): string {
  return placement.kind === 'floating' ? 'Floating window' : `Display ${placement.display.number}`
}

function displayName(display: NumberedDisplay): string {
  return display.label || (display.internal ? 'Built-in display' : 'External display')
}

export function displayMenuLabel(display: NumberedDisplay): string {
  const { width, height } = display.bounds
  return `Display ${display.number}: ${displayName(display)} (${width}×${height})`
}

/** `size`, shrunk to 90% of the work area if needed, and centered in it. */
function centeredBounds(workArea: Rect, size: { width: number; height: number }): Rect {
  const width = Math.round(Math.min(size.width, workArea.width * 0.9))
  const height = Math.round(Math.min(size.height, workArea.height * 0.9))
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height
  }
}

/** The mockup's 1440×900 artboard, shrunk to fit and centered in the display's work area. */
export function floatingBounds(workArea: Rect): Rect {
  return centeredBounds(workArea, { width: 1440, height: 900 })
}

/** Automatic, every connected display, then Floating window, with the saved choice selected. */
export function displayChoices(
  displays: readonly NumberedDisplay[],
  showOn: ShowOn,
  placement: Placement
): DisplayChoice[] {
  const chosen = showOn.kind === 'display' ? findDisplay(displays, showOn) : undefined
  const choices: DisplayChoice[] = [
    {
      showOn: { kind: 'auto' },
      label: 'Automatic',
      detail:
        showOn.kind === 'auto'
          ? `Now: ${placementLabel(placement)}`
          : 'Second screen when one is connected',
      selected: showOn.kind === 'auto',
      missing: false
    },
    ...displays.map((display): DisplayChoice => ({
      showOn: { kind: 'display', id: display.id, label: display.label },
      label: `Display ${display.number}`,
      detail: `${displayName(display)} · ${display.bounds.width}×${display.bounds.height}`,
      selected: chosen?.id === display.id,
      missing: false
    }))
  ]
  if (showOn.kind === 'display' && !chosen) {
    choices.push({
      showOn,
      label: showOn.label || 'Chosen display',
      detail: `Not connected · now: ${placementLabel(placement)}`,
      selected: true,
      missing: true
    })
  }
  choices.push({
    showOn: { kind: 'floating' },
    label: 'Floating window',
    detail: 'A normal window you can move and resize',
    selected: showOn.kind === 'floating',
    missing: false
  })
  return choices
}

/**
 * Where the Customize window opens: the main display, unless the Focus Screen fills it, then
 * any display the Focus Screen leaves free. With no free display it shares the Focus Screen's.
 */
export function customizeDisplay(
  displays: readonly NumberedDisplay[],
  placement: Placement
): NumberedDisplay {
  const taken = placement.kind === 'fullscreen' ? placement.display.id : null
  const primary = displays.find((d) => d.primary) ?? displays[0]
  if (primary && primary.id !== taken) return primary
  return displays.find((d) => d.id !== taken) ?? placement.display
}

/** The Customize window: roomy enough for two columns of settings, centered on its display. */
export function customizeBounds(workArea: Rect): Rect {
  return centeredBounds(workArea, { width: 1240, height: 900 })
}

/** The Color-Code Lyrics window: wide for the lines and the waveform under them, a little shorter. */
export function lyricsEditorBounds(workArea: Rect): Rect {
  return centeredBounds(workArea, { width: 1240, height: 860 })
}
