import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearWavs } from './wav'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'focus-screen-wavs-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('clearWavs', () => {
  it('deletes the WAVs, going on past one it cannot delete', () => {
    // A folder named like a WAV can't be deleted as a file; it mustn't keep the real one.
    mkdirSync(join(dir, 'x.wav'))
    writeFileSync(join(dir, 'y.wav'), 'RIFF')
    writeFileSync(join(dir, 'notes.txt'), 'not ours')

    expect(() => clearWavs(dir)).not.toThrow()

    expect(readdirSync(dir).sort()).toEqual(['notes.txt', 'x.wav'])
  })

  it('is nothing to do for a folder that isn’t there yet', () => {
    expect(() => clearWavs(join(dir, 'missing'))).not.toThrow()
  })
})
