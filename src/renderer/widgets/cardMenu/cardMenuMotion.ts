// How a card's glass menu moves, after iOS 26's context menus: it grows out of the dot that
// opened it (a little wider than tall at first, like a drop spreading, with its words blurred
// and faint until it's about halfway), settles with a small overshoot, and on closing shrinks
// straight back into the dot, quicker.
import type { SpringConfig } from '../tabBarMotion'

/** Opening, across: a touch quicker than down, so the panel spreads before it drops. */
export const OPEN_ACROSS: SpringConfig = { response: 0.26, damping: 0.78 }
/** Opening, down. */
export const OPEN_DOWN: SpringConfig = { response: 0.32, damping: 0.8 }
/** Closing: back into the dot, no bounce. */
export const CLOSE: SpringConfig = { response: 0.2, damping: 1 }
/** A submenu unfolding in place under its row, and folding back. */
export const UNFOLD: SpringConfig = { response: 0.3, damping: 0.86 }

/** The panel's size when it first shows, against its full size: about the dot's. */
export const START_SCALE = 0.1

/** Below this (closing), the menu is gone. */
export const GONE = 0.02

/** The blur on the menu's words while it's still small, in rem. */
const CONTENT_BLUR_REM = 0.5

const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1)

export interface MenuFrame {
  scaleX: number
  scaleY: number
  /** The glass itself. */
  opacity: number
  /** The words on it, which come in a little later and sharpen as it lands. */
  contentOpacity: number
  /** In rem; 0 when sharp. */
  contentBlur: number
  /** The dim over the rest of the screen, 0 to 1. */
  scrim: number
}

/** Where the menu is drawn, from how far along its two springs are (0 at the dot, 1 open). */
export function menuFrame(across: number, down: number): MenuFrame {
  const grow = (progress: number): number => START_SCALE + (1 - START_SCALE) * progress
  const least = Math.min(across, down)
  return {
    scaleX: grow(across),
    scaleY: grow(down),
    opacity: clamp01(least / 0.3),
    // Readable by about halfway: later, it read as a menu slow to open.
    contentOpacity: clamp01((least - 0.1) / 0.4),
    contentBlur: (1 - clamp01(least / 0.6)) * CONTENT_BLUR_REM,
    scrim: clamp01(least)
  }
}

/** A submenu's rows, from how far it has unfolded: they fade in once there's room for them. */
export function unfoldFrame(progress: number): { opacity: number; shift: number } {
  return { opacity: clamp01((progress - 0.15) / 0.6), shift: (1 - clamp01(progress)) * -0.5 }
}

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export interface MenuPlacement {
  left: number
  /** Hanging under the dot, or standing above it when there's no room below. */
  down: boolean
  /** Under the dot, the panel's top; above it, the panel's bottom. */
  edge: number
  /** The dot's centre, which the menu grows out of and shrinks back into. */
  dot: { x: number; y: number }
  /** As tall as the window allows; past that its rows scroll. */
  maxHeight: number
}

/** What a menu opens from: a card's status dot, or the pointer (a right-click). */
export type MenuAnchor = 'dot' | 'pointer'

/**
 * Hangs the menu under what opened it, kept on screen. Under a dot its right edge lines up with
 * the dot's (the dots sit in the cards' top-right corners, so it opens over its own card); at
 * the pointer it opens to the right, like a Mac's context menus, or to the left when there's no
 * room. It stands above instead when it doesn't fit below and there's more room above.
 */
export function placeMenu(
  dot: Box,
  menu: { width: number; height: number },
  view: { width: number; height: number },
  gap: number,
  margin: number,
  anchor: MenuAnchor = 'dot'
): MenuPlacement {
  const below = view.height - margin - (dot.bottom + gap)
  const above = dot.top - gap - margin
  const down = menu.height <= below || below >= above
  const width = Math.min(menu.width, view.width - margin * 2)
  const rightward = dot.left + width <= view.width - margin
  const left = anchor === 'dot' ? dot.right - width : rightward ? dot.left : dot.left - width
  return {
    left: Math.min(Math.max(left, margin), view.width - margin - width),
    down,
    edge: down ? dot.bottom + gap : dot.top - gap,
    dot: { x: (dot.left + dot.right) / 2, y: (dot.top + dot.bottom) / 2 },
    maxHeight: Math.max(view.height - margin * 2, 0)
  }
}

/**
 * The panel's top at its height now. A submenu unfolding near the window's edge would run off
 * it, so the panel slides along to stay on screen, as iOS's menus do, over the dot if need be.
 */
export function menuTop(
  place: MenuPlacement,
  height: number,
  viewHeight: number,
  margin: number
): number {
  const top = place.down ? place.edge : place.edge - height
  return Math.min(Math.max(top, margin), Math.max(margin, viewHeight - margin - height))
}

/** The CSS transform-origin that grows the panel, its top here, out of the dot. */
export function originCss(place: MenuPlacement, top: number): string {
  return `${place.dot.x - place.left}px ${place.dot.y - top}px`
}
