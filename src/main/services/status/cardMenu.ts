import type { CardMenuEntry } from './types'

/**
 * The parts of an Electron menu item the glass menu can show. Electron's own
 * `MenuItemConstructorOptions` fits it, so the app menu's item lists are reused as they are.
 * `click` is called with no arguments: the card menus' clicks don't read Electron's.
 */
export interface MenuTemplateItem {
  label?: string
  type?: string
  checked?: boolean
  enabled?: boolean
  visible?: boolean
  accelerator?: string
  submenu?: readonly MenuTemplateItem[] | object
  click?: (...args: never[]) => void
}

export interface CardMenuBuild {
  entries: CardMenuEntry[]
  /** What each item's id runs. */
  actions: Map<string, () => void>
}

const MAC_MODIFIERS: Record<string, string> = {
  control: '⌃',
  ctrl: '⌃',
  alt: '⌥',
  option: '⌥',
  shift: '⇧',
  cmdorctrl: '⌘',
  commandorcontrol: '⌘',
  cmd: '⌘',
  command: '⌘',
  super: '⌘',
  meta: '⌘'
}
/** Apple's order: Control, Option, Shift, Command. */
const MAC_ORDER = ['⌃', '⌥', '⇧', '⌘']

const OTHER_MODIFIERS: Record<string, string> = {
  control: 'Ctrl',
  ctrl: 'Ctrl',
  cmdorctrl: 'Ctrl',
  commandorcontrol: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  super: 'Win',
  meta: 'Win'
}

/** An accelerator as a menu shows it: "CmdOrCtrl+[" is "⌘[" on a Mac, "Ctrl+[" elsewhere. */
export function shortcutLabel(accelerator: string, mac: boolean): string {
  // "CmdOrCtrl++" ends in the Plus key, so split off the last part by hand.
  const plus = accelerator.lastIndexOf('+', accelerator.length - 2)
  const key = accelerator.slice(plus + 1)
  const modifiers = plus < 0 ? [] : accelerator.slice(0, plus).split('+')
  const shownKey = key.length === 1 ? key.toUpperCase() : key
  if (mac) {
    const marks = modifiers.map((name) => MAC_MODIFIERS[name.toLowerCase()] ?? name)
    marks.sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b))
    return `${marks.join('')}${shownKey}`
  }
  return [...modifiers.map((name) => OTHER_MODIFIERS[name.toLowerCase()] ?? name), shownKey].join(
    '+'
  )
}

/** No separator first, last, or twice in a row (a hidden item can leave one like that). */
function tidy(entries: CardMenuEntry[]): CardMenuEntry[] {
  const out: CardMenuEntry[] = []
  for (const entry of entries) {
    const previous = out[out.length - 1]
    if (entry.kind === 'separator' && (!previous || previous.kind === 'separator')) continue
    out.push(entry)
  }
  if (out[out.length - 1]?.kind === 'separator') out.pop()
  return out
}

function convert(
  items: readonly MenuTemplateItem[],
  prefix: string,
  mac: boolean,
  actions: Map<string, () => void>
): CardMenuEntry[] {
  const entries: CardMenuEntry[] = []
  items.forEach((item, index) => {
    if (item.visible === false) return
    if (item.type === 'separator') {
      entries.push({ kind: 'separator' })
      return
    }
    const id = `${prefix}${index}`
    const label = item.label ?? ''
    const enabled = item.enabled !== false
    if (Array.isArray(item.submenu)) {
      const children = convert(item.submenu as readonly MenuTemplateItem[], `${id}.`, mac, actions)
      entries.push({ kind: 'submenu', id, label, enabled, entries: children })
      return
    }
    const click = item.click
    if (click && enabled) actions.set(id, () => click())
    entries.push({
      kind: 'item',
      id,
      label,
      enabled,
      checked: item.type === 'checkbox' || item.type === 'radio' ? item.checked === true : null,
      shortcut: item.accelerator ? shortcutLabel(item.accelerator, mac) : null
    })
  })
  return tidy(entries)
}

/** A card's menu items as plain data for the glass menu, and what picking each one runs. */
export function cardMenuEntries(items: readonly MenuTemplateItem[], mac: boolean): CardMenuBuild {
  const actions = new Map<string, () => void>()
  return { entries: convert(items, '', mac, actions), actions }
}
