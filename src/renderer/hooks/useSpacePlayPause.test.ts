import { describe, expect, it } from 'vitest'
import { isPlayPauseKey, type KeyPress } from './useSpacePlayPause'

const press = (change: Partial<KeyPress> = {}): KeyPress => ({
  key: ' ',
  repeat: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  target: { tagName: 'BODY' },
  ...change
})

describe('isPlayPauseKey', () => {
  it('takes a plain Space, wherever the focus is outside a text field', () => {
    expect(isPlayPauseKey(press())).toBe(true)
    expect(isPlayPauseKey(press({ target: { tagName: 'BUTTON' } }))).toBe(true)
    expect(isPlayPauseKey(press({ target: null }))).toBe(true)
  })

  it('leaves Space to text fields, and other keys alone', () => {
    expect(isPlayPauseKey(press({ target: { tagName: 'INPUT' } }))).toBe(false)
    expect(isPlayPauseKey(press({ target: { tagName: 'TEXTAREA' } }))).toBe(false)
    expect(isPlayPauseKey(press({ target: { tagName: 'DIV', isContentEditable: true } }))).toBe(
      false
    )
    expect(isPlayPauseKey(press({ key: 'Enter' }))).toBe(false)
  })

  it('ignores a held Space and Space with a modifier', () => {
    expect(isPlayPauseKey(press({ repeat: true }))).toBe(false)
    expect(isPlayPauseKey(press({ metaKey: true }))).toBe(false)
    expect(isPlayPauseKey(press({ ctrlKey: true }))).toBe(false)
    expect(isPlayPauseKey(press({ altKey: true }))).toBe(false)
  })
})
