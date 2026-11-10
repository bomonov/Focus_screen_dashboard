import type { MusicAdapter, PlayerReport } from '../adapter'
import { advanceDemo, applyDemoCommand, demoSnapshot, initialDemoState } from './player'

/** Same cadence as the real pollers, so the service treats both alike. */
const REPORT_INTERVAL_MS = 1000

const epochSeconds = (): number => Date.now() / 1000

/** A pretend player with the mockup's songs, so dev builds show a full screen with no app open. */
export function createMockMusicAdapter(): MusicAdapter {
  let state = initialDemoState(epochSeconds())
  let interval: ReturnType<typeof setInterval> | undefined

  function report(): PlayerReport {
    const now = epochSeconds()
    state = advanceDemo(state, now)
    return { player: 'demo', at: now, kind: 'open', snapshot: demoSnapshot(state, now) }
  }

  return {
    players: [{ id: 'demo', name: 'Demo', repeatModes: ['off', 'all', 'one'] }],
    start(onReport) {
      onReport(report())
      interval = setInterval(() => onReport(report()), REPORT_INTERVAL_MS)
    },
    async command(player, command) {
      if (player !== 'demo') return null
      state = applyDemoCommand(state, command, epochSeconds())
      return report()
    },
    async loadArtwork() {
      return null
    },
    dispose() {
      clearInterval(interval)
    }
  }
}
