import { describe, expect, it } from 'vitest'
import { createPendingEdit, PENDING_EDIT_SEC } from './pendingEdit'

describe('a request to open the card’s wheels', () => {
  it('waits for the Focus Screen to take it, once', () => {
    const pending = createPendingEdit()
    pending.set('break', 100)
    expect(pending.take(101)).toBe('break')
    expect(pending.take(102)).toBeNull()
  })

  it('keeps only the latest request', () => {
    const pending = createPendingEdit()
    pending.set('focus', 100)
    pending.set('countdown', 101)
    expect(pending.take(102)).toBe('countdown')
  })

  it('goes stale, so a card turned on later doesn’t open the wheels out of nowhere', () => {
    const pending = createPendingEdit()
    pending.set('focus', 100)
    expect(pending.take(100 + PENDING_EDIT_SEC + 1)).toBeNull()
  })

  it('has nothing to give before any request', () => {
    expect(createPendingEdit().take(5)).toBeNull()
  })
})
