import { describe, expect, it, vi } from 'vitest'

// The store needs Electron to decode pictures; only the size math is tested here.
vi.mock('electron', () => ({ dialog: {}, nativeImage: {} }))
vi.mock('../../platform', () => ({ isMac: true }))

const { fitWithin } = await import('./backgroundPhoto')

describe('fitWithin', () => {
  it('shrinks the longer side to the limit and keeps the shape', () => {
    expect(fitWithin(6000, 4000, 3840)).toEqual({ width: 3840, height: 2560 })
    expect(fitWithin(3000, 4500, 3840)).toEqual({ width: 2560, height: 3840 })
  })

  it('keeps at least a pixel on the shorter side', () => {
    expect(fitWithin(8000, 1, 3840)).toEqual({ width: 3840, height: 1 })
  })

  it('never enlarges a small picture', () => {
    expect(fitWithin(1920, 1080, 3840)).toEqual({ width: 1920, height: 1080 })
  })
})
