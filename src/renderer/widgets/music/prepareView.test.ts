import { describe, expect, it } from 'vitest'
import type { PrepareState } from '../../../main/ipc'
import { prepareCounts, prepareEyebrow } from './prepareView'

const state: PrepareState = {
  running: true,
  trigger: 'manual',
  blocker: null,
  ended: null,
  timed: 2,
  failed: 0,
  pending: 0,
  skipped: 7
}

describe('prepareView', () => {
  it('counts only what there is to count', () => {
    expect(prepareCounts(state)).toBe('2 timed · 7 skipped')
    expect(prepareCounts({ ...state, pending: 1, failed: 1 })).toBe(
      '2 timed · 1 timing · 1 couldn’t be timed · 7 skipped'
    )
  })

  it('says over the song that the playlist is being prepared, muted', () => {
    expect(prepareEyebrow(state)).toBe('Preparing playlist (muted) · 2 timed · 7 skipped')
    expect(prepareEyebrow({ ...state, running: false })).toBeNull()
    expect(prepareEyebrow(null)).toBeNull()
  })
})
