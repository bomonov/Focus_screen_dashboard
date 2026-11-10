import { describe, expect, it, vi } from 'vitest'
import { cardMenuEntries, shortcutLabel, type MenuTemplateItem } from './cardMenu'

describe('shortcutLabel', () => {
  it('uses the Mac symbols in Apple’s order', () => {
    expect(shortcutLabel('CmdOrCtrl+L', true)).toBe('⌘L')
    expect(shortcutLabel('CmdOrCtrl+[', true)).toBe('⌘[')
    expect(shortcutLabel('Shift+CmdOrCtrl+Alt+K', true)).toBe('⌥⇧⌘K')
    expect(shortcutLabel('Control+Alt+Command+Space', true)).toBe('⌃⌥⌘Space')
  })

  it('spells modifiers out elsewhere', () => {
    expect(shortcutLabel('CmdOrCtrl+L', false)).toBe('Ctrl+L')
    expect(shortcutLabel('CmdOrCtrl+Shift+]', false)).toBe('Ctrl+Shift+]')
  })

  it('keeps a Plus key', () => {
    expect(shortcutLabel('CmdOrCtrl++', true)).toBe('⌘+')
    expect(shortcutLabel('CmdOrCtrl++', false)).toBe('Ctrl++')
  })

  it('takes a bare key', () => {
    expect(shortcutLabel('F5', true)).toBe('F5')
    expect(shortcutLabel('a', false)).toBe('A')
  })
})

describe('cardMenuEntries', () => {
  it('turns items, checkboxes and submenus into data with ids', () => {
    const items: MenuTemplateItem[] = [
      { label: 'Show Lyrics', type: 'checkbox', checked: true, accelerator: 'CmdOrCtrl+L' },
      {
        label: 'Style',
        submenu: [
          { label: 'Ring', type: 'checkbox', checked: false },
          { label: 'Bar', type: 'checkbox', checked: true }
        ]
      },
      { type: 'separator' },
      { label: 'Reset', enabled: false }
    ]
    expect(cardMenuEntries(items, true).entries).toEqual([
      {
        kind: 'item',
        id: '0',
        label: 'Show Lyrics',
        enabled: true,
        checked: true,
        shortcut: '⌘L'
      },
      {
        kind: 'submenu',
        id: '1',
        label: 'Style',
        enabled: true,
        entries: [
          { kind: 'item', id: '1.0', label: 'Ring', enabled: true, checked: false, shortcut: null },
          { kind: 'item', id: '1.1', label: 'Bar', enabled: true, checked: true, shortcut: null }
        ]
      },
      { kind: 'separator' },
      { kind: 'item', id: '3', label: 'Reset', enabled: false, checked: null, shortcut: null }
    ])
  })

  it('runs the clicked item’s action, and has none for disabled items', () => {
    const connect = vi.fn()
    const pick = vi.fn()
    const off = vi.fn()
    const { actions } = cardMenuEntries(
      [
        { label: 'Connect', click: connect },
        { label: 'Style', submenu: [{ label: 'Bar', click: pick }] },
        { label: 'Off', enabled: false, click: off }
      ],
      false
    )
    actions.get('0')?.()
    actions.get('1.0')?.()
    expect(connect).toHaveBeenCalledOnce()
    expect(pick).toHaveBeenCalledOnce()
    expect(actions.has('2')).toBe(false)
  })

  it('drops hidden items and the separators they strand', () => {
    const { entries } = cardMenuEntries(
      [
        { type: 'separator' },
        { label: 'A' },
        { type: 'separator' },
        { label: 'Hidden', visible: false },
        { type: 'separator' },
        { label: 'B' },
        { type: 'separator' }
      ],
      true
    )
    expect(entries.map((entry) => (entry.kind === 'separator' ? '—' : entry.label))).toEqual([
      'A',
      '—',
      'B'
    ])
  })

  it('keeps ids tied to the template, so a hidden item doesn’t shift the others', () => {
    const { entries } = cardMenuEntries(
      [{ label: 'Hidden', visible: false }, { label: 'Shown' }],
      true
    )
    expect(entries).toEqual([
      { kind: 'item', id: '1', label: 'Shown', enabled: true, checked: null, shortcut: null }
    ])
  })
})
