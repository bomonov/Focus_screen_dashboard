import { describe, expect, it } from 'vitest'
import type { PlaybackState } from '../music/types'
import type { TodoSourceState, TodoState } from '../todos/types'
import { ago, cardStatuses, type BrowserLink, type StatusInput } from './cardStatus'

const NOW = 1_800_000_000

const NOTHING_PLAYING: PlaybackState = {
  player: null,
  track: null,
  playing: false,
  positionSec: 0,
  positionAt: NOW,
  shuffle: false,
  repeat: 'off',
  repeatModes: ['off', 'all', 'one'],
  problem: null,
  supportedPlayers: ['Apple Music', 'Spotify', 'YouTube Music']
}

const source = (change: Partial<TodoSourceState> = {}): TodoSourceState => ({
  id: 'canvas',
  name: 'Canvas',
  connection: 'connected',
  problem: null,
  syncedAt: NOW - 180,
  localCheckOffs: false,
  ...change
})

const todos = (sources: TodoSourceState[], demo = false): TodoState => ({
  sources,
  items: [],
  exams: [],
  classes: [],
  supported: ['canvas', 'reminders', 'google'],
  demo,
  notice: null
})

const safari = (link: BrowserLink['link'], paired = true): BrowserLink => ({
  name: 'Safari',
  paired,
  link
})
const CHROME_UNPAIRED: BrowserLink = { name: 'Chrome', paired: false, link: 'off' }

function input(change: Partial<StatusInput> = {}): StatusInput {
  return {
    music: NOTHING_PLAYING,
    browsers: [safari('connected'), CHROME_UNPAIRED],
    todos: todos([]),
    ...change
  }
}

describe('music dot', () => {
  it('is green while a paired browser is connected, or only reconnecting', () => {
    expect(cardStatuses(input(), NOW).music).toEqual({
      tone: 'ok',
      lines: ['YouTube Music in Safari: connected']
    })
    const waiting = input({ browsers: [safari('reconnecting'), CHROME_UNPAIRED] })
    expect(cardStatuses(waiting, NOW).music).toEqual({
      tone: 'ok',
      lines: ['YouTube Music in Safari: reconnecting…']
    })
  })

  it('is red when no paired browser is talking to the app', () => {
    const off = input({ browsers: [safari('off'), CHROME_UNPAIRED] })
    expect(cardStatuses(off, NOW).music).toEqual({
      tone: 'problem',
      lines: ['YouTube Music in Safari: not connected']
    })
  })

  it('is green while another player is on the card, listing YouTube Music too', () => {
    const music = { ...NOTHING_PLAYING, player: { id: 'appleMusic' as const, name: 'Apple Music' } }
    const off = input({ music, browsers: [safari('off'), CHROME_UNPAIRED] })
    expect(cardStatuses(off, NOW).music).toEqual({
      tone: 'ok',
      lines: ['Apple Music: connected', 'YouTube Music in Safari: not connected']
    })
  })

  it('is red when a player won’t let the app read it', () => {
    const music: PlaybackState = {
      ...NOTHING_PLAYING,
      problem: { kind: 'automationDenied', playerName: 'Spotify' }
    }
    expect(cardStatuses(input({ music }), NOW).music.tone).toBe('problem')
    expect(cardStatuses(input({ music }), NOW).music.lines[0]).toBe(
      'Spotify: Focus Screen isn’t allowed to read it'
    )
  })

  it('is grey with nothing set up and nothing playing', () => {
    const none = input({ browsers: [safari('off', false), CHROME_UNPAIRED] })
    expect(cardStatuses(none, NOW).music).toEqual({ tone: 'none', lines: [] })
  })
})

describe('to-do dot', () => {
  it('is green with every connected source fine, and says when each last updated', () => {
    const google = source({ id: 'google', name: 'Google Tasks', syncedAt: NOW - 20 })
    const off = source({ id: 'reminders', name: 'Apple Reminders', connection: 'disconnected' })
    expect(cardStatuses(input({ todos: todos([source(), google, off]) }), NOW).todos).toEqual({
      tone: 'ok',
      lines: ['Canvas: updated 3 min ago', 'Google Tasks: updated just now']
    })
  })

  it('is red when any connected source has a problem, and says which', () => {
    const expired = source({
      id: 'google',
      name: 'Google Tasks',
      problem: { kind: 'reconnect', message: 'Sign in again to keep your tasks up to date.' }
    })
    expect(cardStatuses(input({ todos: todos([source(), expired]) }), NOW).todos).toEqual({
      tone: 'problem',
      lines: [
        'Canvas: updated 3 min ago',
        'Google Tasks: Sign in again to keep your tasks up to date.'
      ]
    })
  })

  it('is grey with no source connected, or only the demo', () => {
    const off = source({ connection: 'disconnected' })
    expect(cardStatuses(input({ todos: todos([off]) }), NOW).todos.tone).toBe('none')
    expect(cardStatuses(input({ todos: todos([source()], true) }), NOW).todos.tone).toBe('none')
  })

  it('says your own homework is on this Mac, once there is some', () => {
    const homework = source({ id: 'homework', name: 'Homework', syncedAt: NOW })
    const off = source({ connection: 'disconnected' })
    expect(cardStatuses(input({ todos: todos([off, homework]) }), NOW).todos.tone).toBe('none')
    const withExam: TodoState = {
      ...todos([source(), homework]),
      exams: [{ id: 'x', title: 'Midterm', course: null, due: { kind: 'time', at: NOW + 99 } }]
    }
    expect(cardStatuses(input({ todos: withExam }), NOW).todos).toEqual({
      tone: 'ok',
      lines: ['Canvas: updated 3 min ago', 'Homework: on this Mac']
    })
  })

  it('treats a source still signing in as fine', () => {
    const signingIn = source({ connection: 'connecting', syncedAt: null })
    expect(cardStatuses(input({ todos: todos([signingIn]) }), NOW).todos).toEqual({
      tone: 'ok',
      lines: ['Canvas: connecting…']
    })
  })
})

describe('timer dot', () => {
  it('is always grey: the timer has nothing to connect', () => {
    expect(cardStatuses(input(), NOW).timer).toEqual({ tone: 'none', lines: [] })
  })
})

describe('ago', () => {
  it('rounds down to the minute, hour or day', () => {
    expect([0, 59, 60, 3599, 3600, 172_799, 172_800].map(ago)).toEqual([
      'just now',
      'just now',
      '1 min ago',
      '59 min ago',
      '1 h ago',
      '47 h ago',
      '2 days ago'
    ])
  })
})
