import { describe, expect, it } from 'vitest'
import { CAST, CAST_GROUPS, castSinger, initials } from './cast'

describe('the cast', () => {
  it('has the 26 characters in six groups', () => {
    expect(CAST).toHaveLength(26)
    expect(CAST_GROUPS.map((g) => g.id)).toEqual(['leoneed', 'mmj', 'vbs', 'wxs', 'n25', 'vs'])
    const sizes = CAST_GROUPS.map((g) => CAST.filter((s) => s.group === g.id).length)
    expect(sizes).toEqual([4, 4, 4, 4, 4, 6])
  })

  it('keeps each group together, in the game order', () => {
    const order = CAST.map((s) => s.group)
    const firstOfEach = CAST_GROUPS.map((g) => order.indexOf(g.id))
    expect(firstOfEach).toEqual([...firstOfEach].sort((a, b) => a - b))
    // Contiguous: a group never comes back after another has started.
    expect(order.join(',')).toBe(
      CAST_GROUPS.flatMap((g) => CAST.filter((s) => s.group === g.id).map((s) => s.group)).join(',')
    )
  })

  it('ids are unique lowercase names', () => {
    const ids = CAST.map((s) => s.id)
    expect(new Set(ids).size).toBe(26)
    for (const id of ids) expect(id).toMatch(/^[a-z]+$/)
    expect(ids).toContain('ichika')
    expect(ids).toContain('kaito')
    expect(ids).toContain('meiko')
  })

  it('every color is #RRGGBB', () => {
    for (const s of CAST) expect(s.color).toMatch(/^#[0-9A-F]{6}$/)
  })

  it('every id is its name in lowercase', () => {
    for (const s of CAST) expect(s.id).toBe(s.name.toLowerCase())
  })

  it('finds a character by id, and only a character', () => {
    expect(castSinger('miku')?.name).toBe('Miku')
    expect(castSinger('miku')?.color).toBe('#33CCBB')
    expect(castSinger('nobody')).toBeUndefined()
    // Not an object key lookup: inherited names are no characters.
    expect(castSinger('constructor')).toBeUndefined()
    expect(castSinger('__proto__')).toBeUndefined()
  })
})

describe('initials', () => {
  it('takes the first two letters, the first one capital', () => {
    expect(initials('Ichika')).toBe('Ic')
    expect(initials('MEIKO')).toBe('ME')
    expect(initials('An')).toBe('An')
    expect(initials('ichika')).toBe('Ic')
  })

  it('copes with short, empty and spaced names', () => {
    expect(initials('A')).toBe('A')
    expect(initials('')).toBe('')
    expect(initials('  Rin ')).toBe('Ri')
  })

  it('counts whole characters, not halves of a surrogate pair', () => {
    expect(initials('ミクさん')).toBe('ミク')
    expect(initials('𠮷野家')).toBe('𠮷野')
  })
})
