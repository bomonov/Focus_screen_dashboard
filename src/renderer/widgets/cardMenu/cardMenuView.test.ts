import { describe, expect, it } from 'vitest'
import type { CardMenuEntry } from '../../../main/ipc'
import { chosenLabel, isSubOpen, parentSub, toggleSub } from './cardMenuView'

const item = (label: string, checked: boolean | null): CardMenuEntry => ({
  kind: 'item',
  id: label,
  label,
  enabled: true,
  checked,
  shortcut: null
})

describe('chosenLabel', () => {
  it('names the pick in a list of choices', () => {
    expect(chosenLabel([item('Normal', false), item('Slow', true), item('Still', false)])).toBe(
      'Slow'
    )
  })

  it('shows nothing for a submenu of settings, even with a switch on', () => {
    const timer: CardMenuEntry[] = [
      { kind: 'submenu', id: 's', label: 'Style', enabled: true, entries: [item('Ring', true)] },
      { kind: 'separator' },
      item('Chime when time is up', true),
      item('Auto-start breaks', false)
    ]
    expect(chosenLabel(timer)).toBeNull()
    expect(chosenLabel([item('Show Lyrics', true), item('Reset Lyrics Timing', null)])).toBeNull()
  })

  it('shows nothing when none, or more than one, is checked', () => {
    expect(chosenLabel([item('A', false), item('B', false)])).toBeNull()
    expect(chosenLabel([item('A', true), item('B', true)])).toBeNull()
  })

  it('looks past separators', () => {
    expect(
      chosenLabel([item('Automatic', false), { kind: 'separator' }, item('Display 1', true)])
    ).toBe('Display 1')
  })
})

describe('nested submenus', () => {
  it('keeps the ones a submenu is inside open with it', () => {
    expect(isSubOpen('9', '9.0')).toBe(true)
    expect(isSubOpen('9.0', '9.0')).toBe(true)
    expect(isSubOpen('9.1', '9.0')).toBe(false)
    expect(isSubOpen('1', '10')).toBe(false)
    expect(isSubOpen('9', null)).toBe(false)
  })

  it('opens one inside another without folding the outer one', () => {
    expect(toggleSub('9', null)).toBe('9')
    expect(toggleSub('9.0', '9')).toBe('9.0')
  })

  it('folds an open sibling, and closing goes back to the parent', () => {
    expect(toggleSub('9.1', '9.0')).toBe('9.1')
    expect(toggleSub('10', '9.0')).toBe('10')
    expect(toggleSub('9.0', '9.0')).toBe('9')
    expect(toggleSub('9', '9.0')).toBeNull()
    expect(parentSub('9')).toBeNull()
  })
})
