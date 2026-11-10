import type { MenuItemConstructorOptions } from 'electron'
import { clockLabel, pickLabel } from './services/timer/lengths'

/** "Set on the Timer Card…": shown while the card is on, usable before a run or once it's over. */
export interface LengthEdit {
  shown: boolean
  enabled: boolean
  open(): void
}

/**
 * A Timer menu's length submenu: the quick picks, a length of the user's own as its own ticked
 * line (a menu can't take typing), and the way to the card's wheels.
 */
export function lengthItems(
  picks: readonly number[],
  current: number,
  pick: (sec: number) => void,
  edit: LengthEdit
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = picks.map((sec) => ({
    label: pickLabel(sec),
    type: 'checkbox',
    checked: sec === current,
    click: () => pick(sec)
  }))
  if (!picks.includes(current)) {
    items.push({ label: clockLabel(current), type: 'checkbox', checked: true, enabled: false })
  }
  if (edit.shown) {
    items.push(
      { type: 'separator' },
      { label: 'Set on the Timer Card…', enabled: edit.enabled, click: () => edit.open() }
    )
  }
  return items
}
