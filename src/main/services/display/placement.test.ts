import { describe, expect, it } from 'vitest'
import {
  customizeBounds,
  customizeDisplay,
  displayChoices,
  displayMenuLabel,
  findDisplay,
  floatingBounds,
  lyricsEditorBounds,
  numberDisplays,
  placementKey,
  placementLabel,
  resolvePlacement,
  type DisplayInfo
} from './placement'

function display(id: number, label: string, x: number, y = 0, internal = false): DisplayInfo {
  const bounds = { x, y, width: 1920, height: 1080 }
  return { id, label, internal, bounds, workArea: { ...bounds, y: y + 25, height: 1055 } }
}

const laptop = display(1, 'Built-in Retina Display', 0, 0, true)
const dell = display(7, 'DELL U2720Q', 1920)
const leftTv = display(9, 'LG TV', -1920)

describe('numberDisplays', () => {
  it('puts the main display first, then sorts left to right', () => {
    const numbered = numberDisplays([dell, laptop, leftTv], laptop.id)
    expect(numbered.map((d) => [d.id, d.number, d.primary])).toEqual([
      [1, 1, true],
      [9, 2, false],
      [7, 3, false]
    ])
  })

  it('uses y to break ties for stacked displays', () => {
    const below = display(3, 'Below', 0, 1080)
    const above = display(4, 'Above', 0, -1080)
    const numbered = numberDisplays([below, above, dell], dell.id)
    expect(numbered.map((d) => d.id)).toEqual([7, 4, 3])
  })
})

describe('findDisplay', () => {
  const displays = numberDisplays([laptop, dell], laptop.id)

  it('matches by id first', () => {
    expect(findDisplay(displays, { id: 7, label: 'something else' })?.id).toBe(7)
  })

  it('falls back to a unique label when the id changed', () => {
    expect(findDisplay(displays, { id: 99, label: 'DELL U2720Q' })?.id).toBe(7)
  })

  it('refuses an ambiguous label', () => {
    const twin = display(8, 'DELL U2720Q', 3840)
    const withTwins = numberDisplays([laptop, dell, twin], laptop.id)
    expect(findDisplay(withTwins, { id: 99, label: 'DELL U2720Q' })).toBeUndefined()
  })

  it('never matches on an empty label', () => {
    const unnamed = numberDisplays([laptop, display(5, '', 1920)], laptop.id)
    expect(findDisplay(unnamed, { id: 99, label: '' })).toBeUndefined()
  })
})

describe('resolvePlacement', () => {
  const one = numberDisplays([laptop], laptop.id)
  const two = numberDisplays([laptop, dell], laptop.id)

  it('auto: goes fullscreen on the second screen when there is one', () => {
    const placement = resolvePlacement(two, { kind: 'auto' })
    expect(placement.kind).toBe('fullscreen')
    expect(placement.display.id).toBe(dell.id)
  })

  it('auto: floats on the only screen instead of taking it over', () => {
    const placement = resolvePlacement(one, { kind: 'auto' })
    expect(placement.kind).toBe('floating')
    expect(placement.display.id).toBe(laptop.id)
  })

  it('auto: uses a non-main display even when the main one is external', () => {
    const numbered = numberDisplays([laptop, dell], dell.id)
    expect(resolvePlacement(numbered, { kind: 'auto' }).display.id).toBe(laptop.id)
  })

  it('honors an explicit display, including the main one', () => {
    expect(resolvePlacement(two, { kind: 'display', id: 1, label: '' })).toMatchObject({
      kind: 'fullscreen',
      display: { id: 1 }
    })
  })

  it('falls back to auto when the chosen display is unplugged', () => {
    const missing = { kind: 'display', id: 42, label: 'Old monitor' } as const
    expect(resolvePlacement(one, missing).kind).toBe('floating')
    const other = numberDisplays([laptop, leftTv], laptop.id)
    expect(resolvePlacement(other, missing)).toMatchObject({
      kind: 'fullscreen',
      display: { id: leftTv.id }
    })
  })

  it('floating always uses the main display', () => {
    expect(resolvePlacement(two, { kind: 'floating' })).toMatchObject({
      kind: 'floating',
      display: { id: laptop.id }
    })
  })

  it('throws when there are no displays at all', () => {
    expect(() => resolvePlacement([], { kind: 'auto' })).toThrow()
  })
})

describe('placement labels and keys', () => {
  const two = numberDisplays([laptop, dell], laptop.id)

  it('labels like the mockup pill', () => {
    expect(placementLabel(resolvePlacement(two, { kind: 'auto' }))).toBe('Display 2')
    expect(placementLabel(resolvePlacement(two, { kind: 'floating' }))).toBe('Floating window')
  })

  it('keys fullscreen by display and floating by mode only', () => {
    expect(placementKey(resolvePlacement(two, { kind: 'auto' }))).toBe('fullscreen:7')
    expect(placementKey(resolvePlacement(two, { kind: 'floating' }))).toBe('floating')
  })

  it('describes displays for menus', () => {
    expect(displayMenuLabel(two[1]!)).toBe('Display 2: DELL U2720Q (1920×1080)')
    const unnamed = numberDisplays([{ ...laptop, label: '' }], laptop.id)
    expect(displayMenuLabel(unnamed[0]!)).toBe('Display 1: Built-in display (1920×1080)')
  })
})

describe('floatingBounds', () => {
  it('uses the mockup size when it fits, centered', () => {
    expect(floatingBounds({ x: 0, y: 25, width: 2560, height: 1415 })).toEqual({
      x: 560,
      y: 283,
      width: 1440,
      height: 900
    })
  })

  it('shrinks to 90% of a small work area', () => {
    expect(floatingBounds({ x: 100, y: 0, width: 1000, height: 700 })).toEqual({
      x: 150,
      y: 35,
      width: 900,
      height: 630
    })
  })
})

describe('displayChoices', () => {
  const displays = numberDisplays([laptop, dell], laptop.id)
  const onDell = resolvePlacement(displays, { kind: 'auto' })

  it('lists Automatic, each display, then Floating window', () => {
    const choices = displayChoices(displays, { kind: 'auto' }, onDell)
    expect(choices.map((c) => [c.label, c.selected])).toEqual([
      ['Automatic', true],
      ['Display 1', false],
      ['Display 2', false],
      ['Floating window', false]
    ])
    expect(choices[0]?.detail).toBe('Now: Display 2')
    expect(choices[2]?.detail).toBe('DELL U2720Q · 1920×1080')
    expect(choices[2]?.showOn).toEqual({ kind: 'display', id: 7, label: 'DELL U2720Q' })
  })

  it('selects a saved display found by its label after the id changed', () => {
    const showOn = { kind: 'display', id: 99, label: 'DELL U2720Q' } as const
    const choices = displayChoices(displays, showOn, resolvePlacement(displays, showOn))
    expect(choices.filter((c) => c.selected).map((c) => c.label)).toEqual(['Display 2'])
  })

  it('keeps an unplugged choice visible and selected', () => {
    const showOn = { kind: 'display', id: 42, label: 'LG TV' } as const
    const choices = displayChoices(displays, showOn, resolvePlacement(displays, showOn))
    const missing = choices.find((c) => c.missing)
    expect(missing).toMatchObject({ label: 'LG TV', selected: true })
    expect(missing?.detail).toBe('Not connected · now: Display 2')
    expect(choices.filter((c) => c.selected)).toHaveLength(1)
    expect(choices.at(-1)?.label).toBe('Floating window')
  })
})

describe('customizeDisplay', () => {
  const displays = numberDisplays([laptop, dell], laptop.id)

  it('opens on the main display while the Focus Screen is on another one', () => {
    expect(customizeDisplay(displays, resolvePlacement(displays, { kind: 'auto' })).id).toBe(1)
  })

  it('moves to a free display when the Focus Screen fills the main one', () => {
    const placement = resolvePlacement(displays, { kind: 'display', id: 1, label: '' })
    expect(customizeDisplay(displays, placement).id).toBe(7)
  })

  it('shares the only display when there is nowhere else', () => {
    const single = numberDisplays([laptop], laptop.id)
    const placement = resolvePlacement(single, { kind: 'display', id: 1, label: '' })
    expect(customizeDisplay(single, placement).id).toBe(1)
  })

  it('uses the main display next to a floating Focus Screen', () => {
    expect(customizeDisplay(displays, resolvePlacement(displays, { kind: 'floating' })).id).toBe(1)
  })
})

describe('customizeBounds', () => {
  it('centers a 1240×900 window and shrinks it on small screens', () => {
    expect(customizeBounds({ x: 0, y: 25, width: 1920, height: 1055 })).toEqual({
      x: 340,
      y: 103,
      width: 1240,
      height: 900
    })
    expect(customizeBounds({ x: 0, y: 0, width: 1280, height: 800 })).toEqual({
      x: 64,
      y: 40,
      width: 1152,
      height: 720
    })
  })
})

describe('lyricsEditorBounds', () => {
  it('centers a 1240×860 window and shrinks it on small screens', () => {
    expect(lyricsEditorBounds({ x: 0, y: 25, width: 1920, height: 1055 })).toEqual({
      x: 340,
      y: 123,
      width: 1240,
      height: 860
    })
    expect(lyricsEditorBounds({ x: 0, y: 0, width: 1280, height: 800 })).toEqual({
      x: 64,
      y: 40,
      width: 1152,
      height: 720
    })
  })
})
