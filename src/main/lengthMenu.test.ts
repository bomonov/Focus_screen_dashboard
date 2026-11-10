import { describe, expect, it, vi } from 'vitest'
import { lengthItems } from './lengthMenu'

const edit = (shown = true, enabled = true): Parameters<typeof lengthItems>[3] => ({
  shown,
  enabled,
  open: vi.fn()
})

describe('a Timer menu’s length items', () => {
  it('lists the quick picks, the current one ticked', () => {
    const items = lengthItems([1500, 2700, 3000], 2700, vi.fn(), edit(false))
    expect(items.map((item) => [item.label, item.checked])).toEqual([
      ['25 min', false],
      ['45 min', true],
      ['50 min', false]
    ])
  })

  it('picks a length in seconds', () => {
    const pick = vi.fn()
    const items = lengthItems([300, 600, 3600], 300, pick, edit(false))
    expect(items[2]?.label).toBe('1 hour')
    items[2]?.click?.({} as never, undefined, {} as never)
    expect(pick).toHaveBeenCalledWith(3600)
  })

  it('shows a length of the user’s own as the face writes it, ticked', () => {
    const items = lengthItems([1500, 2700, 3000], 3930, vi.fn(), edit(false))
    expect(items[3]).toMatchObject({ label: '1:05:30', checked: true, enabled: false })
  })

  it('ends with Set on the Timer Card…, which can be off while a run is going', () => {
    const open = edit(true, false)
    const items = lengthItems([1500], 1500, vi.fn(), open)
    expect(items.at(-2)).toEqual({ type: 'separator' })
    expect(items.at(-1)).toMatchObject({ label: 'Set on the Timer Card…', enabled: false })
    items.at(-1)?.click?.({} as never, undefined, {} as never)
    expect(open.open).toHaveBeenCalled()
  })

  it('leaves it out while the Timer card is turned off', () => {
    const items = lengthItems([1500], 1500, vi.fn(), edit(false))
    expect(items.some((item) => item.label === 'Set on the Timer Card…')).toBe(false)
  })
})
