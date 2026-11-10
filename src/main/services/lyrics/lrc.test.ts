import { describe, expect, it } from 'vitest'
import { parseLrc, parsePlainLyrics } from './lrc'

describe('parseLrc', () => {
  it('reads timed lines in order, with hundredths and milliseconds', () => {
    expect(parseLrc('[00:12.50]First\n[00:17.125]Second\n[01:02]Third')).toEqual([
      { timeSec: 12.5, text: 'First' },
      { timeSec: 17.125, text: 'Second' },
      { timeSec: 62, text: 'Third' }
    ])
  })

  it('reads a single fraction digit as tenths', () => {
    expect(parseLrc('[00:01.5]Half')).toEqual([{ timeSec: 1.5, text: 'Half' }])
  })

  it('accepts a colon before the fraction', () => {
    expect(parseLrc('[00:03:25]Colon')).toEqual([{ timeSec: 3.25, text: 'Colon' }])
  })

  it('repeats a line once per time tag and sorts by time', () => {
    expect(parseLrc('[00:30.00][00:10.00]Chorus\n[00:20.00]Verse')).toEqual([
      { timeSec: 10, text: 'Chorus' },
      { timeSec: 20, text: 'Verse' },
      { timeSec: 30, text: 'Chorus' }
    ])
  })

  it('skips metadata tags and untimed text', () => {
    const text = '[ar:Someone]\n[ti:Song]\n[length:03:20]\nNot timed\n[00:05.00]Sung'
    expect(parseLrc(text)).toEqual([{ timeSec: 5, text: 'Sung' }])
  })

  it('applies the offset tag: positive means sooner', () => {
    expect(parseLrc('[offset:+500]\n[00:10.00]Line')).toEqual([{ timeSec: 9.5, text: 'Line' }])
    expect(parseLrc('[offset:-250]\n[00:10.00]Line')).toEqual([{ timeSec: 10.25, text: 'Line' }])
  })

  it('never shifts a line before the start of the song', () => {
    expect(parseLrc('[offset:+5000]\n[00:01.00]Early')).toEqual([{ timeSec: 0, text: 'Early' }])
  })

  it('strips word timings and extra spaces', () => {
    expect(parseLrc('[00:01.00] <00:01.00>Hello  <00:01.50>world ')).toEqual([
      { timeSec: 1, text: 'Hello world' }
    ])
  })

  it('keeps one empty line for a break and drops leading and repeated ones', () => {
    const text = '[00:00.00]\n[00:05.00]One\n[00:09.00]\n[00:10.00]\n[00:15.00]Two\n[00:20.00]'
    expect(parseLrc(text)).toEqual([
      { timeSec: 5, text: 'One' },
      { timeSec: 9, text: '' },
      { timeSec: 15, text: 'Two' },
      { timeSec: 20, text: '' }
    ])
  })

  it('handles Windows line endings', () => {
    expect(parseLrc('[00:01.00]A\r\n[00:02.00]B\r\n')).toEqual([
      { timeSec: 1, text: 'A' },
      { timeSec: 2, text: 'B' }
    ])
  })

  it('is null when nothing is timed or every timed line is empty', () => {
    expect(parseLrc('Just words\nNo tags')).toBeNull()
    expect(parseLrc('[00:01.00]\n[00:02.00]  ')).toBeNull()
    expect(parseLrc('')).toBeNull()
  })
})

describe('parsePlainLyrics', () => {
  it('trims lines and keeps single stanza breaks', () => {
    expect(parsePlainLyrics('\n\n  One  \nTwo\n\n\n\nThree\n\n')).toEqual([
      'One',
      'Two',
      '',
      'Three'
    ])
  })

  it('is null for blank text', () => {
    expect(parsePlainLyrics('  \n \n')).toBeNull()
  })
})
