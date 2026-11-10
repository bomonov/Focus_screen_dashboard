import { describe, expect, it } from 'vitest'
import { parseWeatherCommand } from './parse'

describe('parseWeatherCommand', () => {
  it('passes the known commands', () => {
    expect(parseWeatherCommand({ kind: 'retry' })).toEqual({ kind: 'retry' })
    expect(parseWeatherCommand({ kind: 'requestAccess' })).toEqual({ kind: 'requestAccess' })
    expect(parseWeatherCommand({ kind: 'openLocationSettings', extra: 1 })).toEqual({
      kind: 'openLocationSettings'
    })
  })

  it('drops anything else', () => {
    expect(parseWeatherCommand({ kind: 'other' })).toBeNull()
    expect(parseWeatherCommand('retry')).toBeNull()
    expect(parseWeatherCommand(null)).toBeNull()
  })
})
