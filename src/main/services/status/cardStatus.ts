import type { PlaybackState } from '../music/types'
import type { TodoSourceState, TodoState } from '../todos/types'
import type { CardStatus, CardStatuses } from './types'

/** One browser's link to Focus Screen through the YouTube Music extension. */
export interface BrowserLink {
  name: 'Chrome' | 'Safari'
  /** Paired at some point: it has a token, so it's expected to connect. */
  paired: boolean
  /** reconnecting: dropped, still within the wait before it counts as gone. */
  link: 'connected' | 'reconnecting' | 'off'
}

export interface StatusInput {
  music: PlaybackState
  browsers: readonly BrowserLink[]
  todos: TodoState
}

/** "just now", "4 min ago", "2 h ago", "3 days ago". */
export function ago(seconds: number): string {
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 2 * 86_400) return `${Math.floor(seconds / 3600)} h ago`
  return `${Math.floor(seconds / 86_400)} days ago`
}

function musicStatus({ music, browsers }: StatusInput): CardStatus {
  const paired = browsers.filter((browser) => browser.paired)
  const browserLines = paired.map(
    (browser) =>
      `YouTube Music in ${browser.name}: ${
        browser.link === 'connected'
          ? 'connected'
          : browser.link === 'reconnecting'
            ? 'reconnecting…'
            : 'not connected'
      }`
  )
  if (music.problem) {
    return {
      tone: 'problem',
      lines: [`${music.problem.playerName}: Focus Screen isn’t allowed to read it`, ...browserLines]
    }
  }
  const player = music.player
  const shown = player && !player.id.startsWith('ytm') ? [`${player.name}: connected`] : []
  // YouTube Music counts while it's waiting to reconnect: the card still shows its song then.
  const linked = paired.some((browser) => browser.link !== 'off')
  if (player || linked) return { tone: 'ok', lines: [...shown, ...browserLines] }
  // Paired but no browser is talking to us: the tab's closed, or the link broke.
  return { tone: paired.length > 0 ? 'problem' : 'none', lines: browserLines }
}

function sourceLine(source: TodoSourceState, now: number): string {
  if (source.problem) return `${source.name}: ${source.problem.message}`
  // The user's own homework has nothing to sync.
  if (source.id === 'homework') return `${source.name}: on this Mac`
  if (source.connection === 'connecting') return `${source.name}: connecting…`
  if (source.syncedAt === null) return `${source.name}: connected`
  return `${source.name}: updated ${ago(Math.max(0, now - source.syncedAt))}`
}

function todoStatus({ todos }: StatusInput, now: number): CardStatus {
  // The dev demo's sources only stand in while nothing real is connected.
  // Homework is always there; with nothing in it, it isn't something connected.
  const ownStuff = todos.items.some((item) => item.source === 'homework') || todos.exams.length > 0
  const sources = todos.demo
    ? []
    : todos.sources.filter(
        (source) => source.connection !== 'disconnected' && (source.id !== 'homework' || ownStuff)
      )
  if (sources.length === 0) return { tone: 'none', lines: [] }
  return {
    tone: sources.some((source) => source.problem) ? 'problem' : 'ok',
    lines: sources.map((source) => sourceLine(source, now))
  }
}

/** Each card's dot: what's connected and what needs a look. `now` is Unix epoch seconds. */
export function cardStatuses(input: StatusInput, now: number): CardStatuses {
  return {
    music: musicStatus(input),
    todos: todoStatus(input, now),
    // The timer has nothing to connect; its dot only opens its menu.
    timer: { tone: 'none', lines: [] }
  }
}
