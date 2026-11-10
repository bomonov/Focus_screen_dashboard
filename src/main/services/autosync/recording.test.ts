import { describe, expect, it } from 'vitest'
import { createSongRecording, MAX_SONG_SEC, SAMPLE_RATE } from './recording'
import { sampleBaseName } from './samples'
import { encodeWav } from './wav'

const filled = (seconds: number, value: number): Int16Array =>
  new Int16Array(Math.round(seconds * SAMPLE_RATE)).fill(value)

describe('createSongRecording', () => {
  it('places audio at its spot in the song and counts what was heard', () => {
    const song = createSongRecording(10)
    song.write(2, filled(1, 7))
    expect(song.samples()[2 * SAMPLE_RATE]).toBe(7)
    expect(song.samples()[3 * SAMPLE_RATE]).toBe(0)
    expect(song.coverage()).toBeCloseTo(0.1, 5)
  })

  it('counts a part heard twice only once, and keeps the newer audio', () => {
    const song = createSongRecording(10)
    song.write(1, filled(2, 1))
    song.write(2, filled(2, 2))
    expect(song.coverage()).toBeCloseTo(0.3, 5)
    expect(song.samples()[Math.round(2.5 * SAMPLE_RATE)]).toBe(2)
  })

  it('drops audio before the start and past the end', () => {
    const song = createSongRecording(10)
    song.write(-0.5, filled(1, 3))
    song.write(9.5, filled(1, 4))
    expect(song.samples()[0]).toBe(3)
    expect(song.samples()[song.samples().length - 1]).toBe(4)
    expect(song.coverage()).toBeCloseTo(0.1, 5)
    song.write(Number.NaN, filled(1, 5))
    expect(song.coverage()).toBeCloseTo(0.1, 5)
  })

  it('reaches full coverage for an odd length, and caps very long songs', () => {
    const song = createSongRecording(1.23)
    song.write(0, filled(1.23, 1))
    expect(song.coverage()).toBeCloseTo(1, 5)
    expect(createSongRecording(MAX_SONG_SEC * 3).durationSec).toBe(MAX_SONG_SEC)
  })

  it('heardSpans merges what was heard', () => {
    const song = createSongRecording(10)
    expect(song.heardSpans()).toEqual([])
    song.write(2, filled(1, 1))
    song.write(5, filled(0.5, 1))
    expect(song.heardSpans()).toEqual([
      [2, 3],
      [5, 5.5]
    ])
    song.write(2.5, filled(1, 1))
    expect(song.heardSpans()).toEqual([
      [2, 3.5],
      [5, 5.5]
    ])
  })

  it('heardSpans counts a tenth-second cell once half of it is heard, and ends with the song', () => {
    const song = createSongRecording(1.23)
    song.write(0, filled(0.04, 1))
    expect(song.heardSpans()).toEqual([])
    song.write(0, filled(0.05, 1))
    expect(song.heardSpans()).toEqual([[0, 0.1]])
    // The last cell is 0.03 s long: half of it is enough, and the span stops at the song's end.
    song.write(1.215, filled(0.015, 1))
    expect(song.heardSpans()).toEqual([
      [0, 0.1],
      [1.2, 1.23]
    ])
  })
})

describe('encodeWav', () => {
  it('writes a 16-bit mono header and the samples', () => {
    const wav = encodeWav(new Int16Array([1, -1]), SAMPLE_RATE)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.readUInt16LE(22)).toBe(1)
    expect(wav.readUInt32LE(24)).toBe(SAMPLE_RATE)
    expect(wav.readUInt32LE(40)).toBe(4)
    expect(wav.readInt16LE(44)).toBe(1)
    expect(wav.readInt16LE(46)).toBe(-1)
    expect(wav.length).toBe(48)
  })
})

describe('sampleBaseName', () => {
  const at = new Date('2026-10-14T21:05:09Z')
  it('keeps an ASCII title readable and drops everything else', () => {
    expect(sampleBaseName('Bad Side (Live!)', at)).toBe('20261014-210509-bad-side-live')
    expect(sampleBaseName('Café del Mar', at)).toBe('20261014-210509-cafe-del-mar')
  })

  it('falls back to "song" for a title with no ASCII letters', () => {
    expect(sampleBaseName('夜に駆ける', at)).toBe('20261014-210509-song')
  })
})
