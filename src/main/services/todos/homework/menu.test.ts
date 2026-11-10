import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { HomeworkEntry } from '../types'
import { homeworkMenuItems } from './menu'

const entry = (title: string): HomeworkEntry => ({
  id: 'a',
  kind: 'homework',
  title,
  course: 'MAT 265',
  due: { kind: 'day', day: '2026-10-30' }
})

const labels = (items: MenuItemConstructorOptions[]): (string | undefined)[] =>
  items.map((item) => (item.type === 'separator' ? '—' : item.label))

function click(item: MenuItemConstructorOptions | undefined): void {
  // Electron passes the item, window and event; ours ignore them.
  ;(item?.click as (() => void) | undefined)?.()
}

describe('homeworkMenuItems', () => {
  it('offers Edit and Delete by name, then a line', () => {
    const items = homeworkMenuItems(entry('Problem set 7'), { edit: () => {}, remove: () => {} })
    expect(labels(items)).toEqual(['Edit “Problem set 7”…', 'Delete “Problem set 7”…', '—'])
  })

  it('shortens a long name', () => {
    const long = 'x'.repeat(60)
    const [edit] = homeworkMenuItems(entry(long), { edit: () => {}, remove: () => {} })
    expect(edit?.label).toBe(`Edit “${'x'.repeat(39)}…”…`)
  })

  it('runs each item’s own action once', () => {
    const edit = vi.fn()
    const remove = vi.fn()
    const items = homeworkMenuItems(entry('Problem set 7'), { edit, remove })
    click(items[0])
    expect(edit).toHaveBeenCalledTimes(1)
    click(items[1])
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('leaves Edit out for a ticked one', () => {
    const items = homeworkMenuItems(entry('Problem set 7'), { edit: null, remove: () => {} })
    expect(labels(items)).toEqual(['Delete “Problem set 7”…', '—'])
  })
})
