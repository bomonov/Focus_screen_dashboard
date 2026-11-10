import { describe, expect, it } from 'vitest'
import { classChoices } from './classes'

describe('classChoices', () => {
  it('lists each class once, the calendar’s spelling first, in course order', () => {
    expect(classChoices(['MAT 265', 'bio  181', 'BIO 181', ''], ['BIO 181', 'CHM 113'])).toEqual([
      'bio 181',
      'CHM 113',
      'MAT 265'
    ])
  })

  it('sorts course numbers as numbers', () => {
    expect(classChoices(['MAT 265', 'MAT 99'], [])).toEqual(['MAT 99', 'MAT 265'])
  })

  it('leaves out titles too long to be a course', () => {
    expect(classChoices(['x'.repeat(61), 'ENG 101'], [])).toEqual(['ENG 101'])
  })
})
