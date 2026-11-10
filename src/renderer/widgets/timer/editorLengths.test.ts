import { describe, expect, it } from 'vitest'
import { adoptOutside } from './editorLengths'

const lengths = (
  focus: number,
  rest = 300,
  countdown = 600
): Record<'focus' | 'break' | 'countdown', number> => ({
  focus,
  break: rest,
  countdown
})

describe('the open wheels and lengths set elsewhere', () => {
  it('takes a length picked in Customize or a menu while the wheels are open', () => {
    expect(adoptOutside(lengths(1500), lengths(1500), lengths(2700), [])).toEqual(lengths(2700))
  })

  it('keeps the wheels’ own turn while it’s still waiting to be saved', () => {
    expect(adoptOutside(lengths(1620), lengths(1500), lengths(2700), ['focus'])).toEqual(
      lengths(1620)
    )
  })

  it('changes nothing when the new setting is the wheels’ own, saved', () => {
    const shown = lengths(1620)
    expect(adoptOutside(shown, lengths(1500), lengths(1620), [])).toBe(shown)
  })

  it('only touches the lengths that changed', () => {
    expect(
      adoptOutside(lengths(1620, 345), lengths(1500, 300), lengths(1500, 420), ['focus'])
    ).toEqual(lengths(1620, 420))
  })
})
