import { describe, expect, it } from 'vitest'
import { courseKey } from './shared'

describe('courseKey', () => {
  it('ignores case, the ends and runs of spaces', () => {
    expect(courseKey('  BIO   181 ')).toBe('bio 181')
    expect(courseKey('bio 181')).toBe('bio 181')
  })
})
