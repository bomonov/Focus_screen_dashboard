import { describe, expect, it } from 'vitest'
import {
  parseCanvasFormRequest,
  parseHomeworkRequest,
  parseHomeworkTarget,
  parseTodoCommand
} from './parse'

describe('parseHomeworkTarget', () => {
  it('gives the id of the homework a right-click landed on', () => {
    expect(parseHomeworkTarget({ kind: 'homework', id: 'a-1' })).toBe('a-1')
  })

  it('gives nothing for anything else', () => {
    expect(parseHomeworkTarget(null)).toBeNull()
    expect(parseHomeworkTarget({ kind: 'homework', id: '../x' })).toBeNull()
    expect(parseHomeworkTarget({ kind: 'song', id: 'a' })).toBeNull()
    expect(parseHomeworkTarget('a')).toBeNull()
  })
})

describe('parseTodoCommand', () => {
  it('accepts the known commands', () => {
    expect(parseTodoCommand({ kind: 'setDone', id: 'google:a/b', done: true })).toEqual({
      kind: 'setDone',
      id: 'google:a/b',
      done: true
    })
    expect(parseTodoCommand({ kind: 'refresh' })).toEqual({ kind: 'refresh' })
    expect(parseTodoCommand({ kind: 'connect', source: 'google' })).toEqual({
      kind: 'connect',
      source: 'google'
    })
    expect(parseTodoCommand({ kind: 'cancelConnect', source: 'google' })).toEqual({
      kind: 'cancelConnect',
      source: 'google'
    })
    expect(parseTodoCommand({ kind: 'disconnect', source: 'canvas' })).toEqual({
      kind: 'disconnect',
      source: 'canvas'
    })
    expect(parseTodoCommand({ kind: 'openPrivacySettings', source: 'reminders' })).toEqual({
      kind: 'openPrivacySettings',
      source: 'reminders'
    })
  })

  it('drops extra fields', () => {
    expect(parseTodoCommand({ kind: 'refresh', force: true })).toEqual({ kind: 'refresh' })
  })

  it('rejects anything off-shape', () => {
    expect(parseTodoCommand(null)).toBeNull()
    expect(parseTodoCommand('refresh')).toBeNull()
    expect(parseTodoCommand({ kind: 'setDone', id: 'x', done: 'yes' })).toBeNull()
    expect(parseTodoCommand({ kind: 'setDone', id: '', done: true })).toBeNull()
    expect(parseTodoCommand({ kind: 'setDone', id: 'x'.repeat(1001), done: true })).toBeNull()
    expect(parseTodoCommand({ kind: 'connect', source: 'todoist' })).toBeNull()
    expect(parseTodoCommand({ kind: 'openPrivacySettings' })).toBeNull()
    expect(parseTodoCommand({ kind: 'disconnect', source: 'all' })).toBeNull()
    expect(parseTodoCommand({ kind: 'delete', id: 'x' })).toBeNull()
  })
})

describe('parseCanvasFormRequest', () => {
  it('passes the form’s three requests', () => {
    expect(
      parseCanvasFormRequest({ kind: 'connectToken', address: 'canvas.school.edu', token: 't' })
    ).toEqual({ kind: 'connectToken', address: 'canvas.school.edu', token: 't' })
    expect(
      parseCanvasFormRequest({ kind: 'connectFeed', url: 'https://x/feeds/calendars/a.ics' })
    ).toEqual({ kind: 'connectFeed', url: 'https://x/feeds/calendars/a.ics' })
    expect(
      parseCanvasFormRequest({ kind: 'openPage', page: 'feed', address: 'x', extra: 1 })
    ).toEqual({ kind: 'openPage', page: 'feed', address: 'x' })
  })

  it('rejects anything off-shape or oversized', () => {
    expect(parseCanvasFormRequest(null)).toBeNull()
    expect(parseCanvasFormRequest({ kind: 'connectToken', address: 'x' })).toBeNull()
    expect(parseCanvasFormRequest({ kind: 'connectToken', address: 'x', token: 5 })).toBeNull()
    expect(
      parseCanvasFormRequest({ kind: 'connectToken', address: 'x', token: 't'.repeat(513) })
    ).toBeNull()
    expect(parseCanvasFormRequest({ kind: 'connectFeed', url: 'u'.repeat(2001) })).toBeNull()
    expect(parseCanvasFormRequest({ kind: 'openPage', page: 'grades', address: 'x' })).toBeNull()
    expect(parseCanvasFormRequest({ kind: 'deleteEverything' })).toBeNull()
  })
})

describe('parseHomeworkRequest', () => {
  const input = {
    kind: 'homework',
    title: 'Problem set 7',
    course: 'MAT 265',
    due: { kind: 'day', day: '2026-10-30' }
  }

  it('accepts add, edit and delete', () => {
    expect(parseHomeworkRequest({ kind: 'add', input })).toEqual({ kind: 'add', input })
    expect(parseHomeworkRequest({ kind: 'edit', id: 'a-1_b', input })).toEqual({
      kind: 'edit',
      id: 'a-1_b',
      input
    })
    expect(parseHomeworkRequest({ kind: 'delete', id: 'a-1_b' })).toEqual({
      kind: 'delete',
      id: 'a-1_b'
    })
  })

  it('refuses odd ids, unknown kinds and bad input', () => {
    expect(parseHomeworkRequest({ kind: 'delete', id: 'a/b' })).toBeNull()
    expect(parseHomeworkRequest({ kind: 'delete', id: 'x'.repeat(65) })).toBeNull()
    expect(
      parseHomeworkRequest({ kind: 'edit', id: 'a', input: { ...input, title: '' } })
    ).toBeNull()
    expect(parseHomeworkRequest({ kind: 'add', input: null })).toBeNull()
    expect(parseHomeworkRequest({ kind: 'wipe' })).toBeNull()
    expect(parseHomeworkRequest('add')).toBeNull()
  })
})
