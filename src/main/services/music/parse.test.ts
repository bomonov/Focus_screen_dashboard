import { describe, expect, it } from 'vitest'
import { parseMusicCommand } from './parse'

describe('parseMusicCommand', () => {
  it('accepts the known commands', () => {
    expect(parseMusicCommand({ kind: 'playPause' })).toEqual({ kind: 'playPause' })
    expect(parseMusicCommand({ kind: 'next' })).toEqual({ kind: 'next' })
    expect(parseMusicCommand({ kind: 'previous' })).toEqual({ kind: 'previous' })
    expect(parseMusicCommand({ kind: 'setShuffle', on: true })).toEqual({
      kind: 'setShuffle',
      on: true
    })
    expect(parseMusicCommand({ kind: 'setRepeat', mode: 'one' })).toEqual({
      kind: 'setRepeat',
      mode: 'one'
    })
    expect(parseMusicCommand({ kind: 'seek', positionSec: 61.5 })).toEqual({
      kind: 'seek',
      positionSec: 61.5
    })
    expect(parseMusicCommand({ kind: 'seek', positionSec: -3 })).toEqual({
      kind: 'seek',
      positionSec: 0
    })
  })

  it('drops extra fields', () => {
    expect(parseMusicCommand({ kind: 'next', player: 'spotify' })).toEqual({ kind: 'next' })
  })

  it('rejects anything else', () => {
    expect(parseMusicCommand(null)).toBeNull()
    expect(parseMusicCommand('next')).toBeNull()
    expect(parseMusicCommand({ kind: 'restart' })).toBeNull()
    expect(parseMusicCommand({ kind: 'setShuffle', on: 'yes' })).toBeNull()
    expect(parseMusicCommand({ kind: 'setRepeat', mode: 'twice' })).toBeNull()
    expect(parseMusicCommand({ kind: 'seek', positionSec: '61' })).toBeNull()
    expect(parseMusicCommand({ kind: 'seek', positionSec: Number.NaN })).toBeNull()
  })
})
