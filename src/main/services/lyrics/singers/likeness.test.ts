import { describe, expect, it } from 'vitest'
import { ALIKE, alikePairs, likeness } from './likeness'

describe('likeness', () => {
  it('ignores spaces, full-width ones too', () => {
    expect(likeness('夜空に浮かぶ　小さな灯り', '夜空に浮かぶ 小さな灯り')).toBe(1)
  })

  it('finds an edited line alike, and an unrelated one not', () => {
    expect(likeness('のばした', '伸ばした')).toBeGreaterThanOrEqual(ALIKE)
    expect(likeness('まだ見ぬ明日', 'hello')).toBeLessThan(ALIKE)
    expect(likeness('', '')).toBe(0)
  })
})

describe('alikePairs', () => {
  it('pairs in order, each once, the most alike', () => {
    const pairs = alikePairs(['abcd', 'wxyz'], ['abce', 'wxyq', 'abcd'])
    expect(pairs.get(0)).toBe(0)
    expect(pairs.get(1)).toBe(1)
    expect(pairs.size).toBe(2)
  })
})
