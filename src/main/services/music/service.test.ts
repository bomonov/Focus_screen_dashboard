import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AdapterCommand,
  AdapterTrack,
  MusicAdapter,
  PlayerInfo,
  PlayerReport,
  PlayerSnapshot
} from './adapter'
import { createMusicService, type MusicService } from './service'
import type { PlaybackState, PlayerId } from './types'

const T0 = 1_800_000_000

const track: AdapterTrack = {
  id: 'track-1',
  title: 'Quiet Library',
  artist: 'Lofi Desk Club',
  album: 'Study Hall',
  durationSec: 187,
  artworkRef: 'ref-1'
}

const playing: PlayerSnapshot = {
  status: 'playing',
  track,
  positionSec: 10,
  shuffle: false,
  repeat: 'off'
}

interface FakeAdapter extends MusicAdapter {
  emit(report: PlayerReport): void
  commands: { player: PlayerId; command: AdapterCommand }[]
  artworkCalls: string[]
  /** What the next command resolves with. */
  commandReply: PlayerReport | null
  artworkReply: Uint8Array | null
}

function fakeAdapter(players: PlayerInfo[]): FakeAdapter {
  let onReport: ((report: PlayerReport) => void) | null = null
  const adapter: FakeAdapter = {
    players,
    commands: [],
    artworkCalls: [],
    commandReply: null,
    artworkReply: null,
    emit: (report) => onReport?.(report),
    start(listener) {
      onReport = listener
    },
    async command(player, command) {
      adapter.commands.push({ player, command })
      return adapter.commandReply
    },
    async loadArtwork(_player, adapterTrack) {
      adapter.artworkCalls.push(adapterTrack.id)
      return adapter.artworkReply
    },
    dispose: vi.fn()
  }
  return adapter
}

const SPOTIFY: PlayerInfo = { id: 'spotify', name: 'Spotify', repeatModes: ['off', 'all'] }
const MUSIC: PlayerInfo = {
  id: 'appleMusic',
  name: 'Apple Music',
  repeatModes: ['off', 'all', 'one']
}
const DEMO: PlayerInfo = { id: 'demo', name: 'Demo', repeatModes: ['off', 'all', 'one'] }

function open(player: PlayerId, at: number, snapshot: Partial<PlayerSnapshot> = {}): PlayerReport {
  return { player, at, kind: 'open', snapshot: { ...playing, ...snapshot } }
}

let clock = T0
let service: MusicService | null = null

afterEach(() => {
  service?.dispose()
  service = null
  clock = T0
})

/** Lets the adapter promises (command replies, covers) settle. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

interface Setup {
  mac: FakeAdapter
  demo: FakeAdapter | null
  pushes: PlaybackState[]
  service: MusicService
}

function setup(options: { demo?: boolean } = {}): Setup {
  const mac = fakeAdapter([SPOTIFY, MUSIC])
  const demo = options.demo ? fakeAdapter([DEMO]) : null
  const pushes: PlaybackState[] = []
  service = createMusicService({
    adapters: [mac],
    demo,
    toArtwork: (bytes) => `data:image/jpeg;base64,${bytes.length}`,
    now: () => clock
  })
  service.subscribe((state) => pushes.push(state))
  return { mac, demo, pushes, service }
}

describe('music service', () => {
  it('starts empty and lists the players this computer supports', () => {
    const { service } = setup()
    expect(service.get().player).toBeNull()
    expect(service.get().supportedPlayers).toEqual(['Spotify', 'Apple Music'])
  })

  it('leaves players that are not installed out of the hint', () => {
    const { mac, service } = setup()
    mac.emit({ player: 'spotify', at: T0, kind: 'closed', installed: false })
    expect(service.get().supportedPlayers).toEqual(['Apple Music'])
  })

  it('pushes a song once, not on every reading that agrees with it', () => {
    const { mac, pushes } = setup()
    mac.emit(open('spotify', T0))
    clock = T0 + 1
    mac.emit(open('spotify', T0 + 1, { positionSec: 11 }))
    clock = T0 + 2
    mac.emit(open('spotify', T0 + 2, { positionSec: 12.1 }))
    expect(pushes).toHaveLength(1)
    expect(pushes[0]?.track?.title).toBe('Quiet Library')
  })

  it('never lets an older reading replace a newer one', () => {
    const { mac, service } = setup()
    mac.emit(open('spotify', T0 + 1, { status: 'paused' }))
    mac.emit(open('spotify', T0, { status: 'playing' }))
    expect(service.get().playing).toBe(false)
  })

  it('keeps the last good reading through a failed one', () => {
    const { mac, service } = setup()
    mac.emit(open('spotify', T0))
    mac.emit({ player: 'spotify', at: T0 + 1, kind: 'failed' })
    expect(service.get().track?.id).toBe('track-1')
  })

  it('lets a paused app that reported first give way on a tie', () => {
    const { mac, service } = setup()
    mac.emit(open('appleMusic', T0, { status: 'paused' }))
    expect(service.get().player?.id).toBe('appleMusic')
    // Spotify comes first in this setup's priority order.
    mac.emit(open('spotify', T0 + 3, { status: 'paused' }))
    expect(service.get().player?.id).toBe('spotify')
  })

  it('keeps the card on the player you just paused', () => {
    const { mac, service } = setup()
    mac.emit(open('appleMusic', T0, { status: 'paused' }))
    mac.emit(open('spotify', T0, { status: 'playing' }))
    expect(service.get().player?.id).toBe('spotify')
    mac.emit(open('spotify', T0 + 1, { status: 'paused' }))
    mac.emit(open('appleMusic', T0 + 1, { status: 'paused' }))
    expect(service.get().player?.id).toBe('spotify')
  })

  it('drops a player whose readings stopped coming', () => {
    const { mac, service } = setup()
    mac.emit(open('spotify', T0))
    clock = T0 + 30
    mac.emit({ player: 'appleMusic', at: clock, kind: 'closed' })
    expect(service.get().player).toBeNull()
  })

  it('loads the cover once per song and pushes it when it arrives', async () => {
    const { mac, pushes } = setup()
    mac.artworkReply = new Uint8Array([1, 2, 3])
    mac.emit(open('spotify', T0))
    mac.emit(open('spotify', T0 + 0.5, { positionSec: 10.5 }))
    await settle()
    expect(mac.artworkCalls).toEqual(['track-1'])
    expect(pushes.at(-1)?.track?.artwork).toBe('data:image/jpeg;base64,3')
  })

  it('looks for a missing cover once more, a little later', async () => {
    const { mac } = setup()
    mac.emit(open('appleMusic', T0))
    await settle()
    clock = T0 + 2
    mac.emit(open('appleMusic', clock, { positionSec: 12 }))
    await settle()
    expect(mac.artworkCalls).toHaveLength(1)
    clock = T0 + 15
    mac.emit(open('appleMusic', clock, { positionSec: 25 }))
    await settle()
    clock = T0 + 40
    mac.emit(open('appleMusic', clock, { positionSec: 50 }))
    await settle()
    expect(mac.artworkCalls).toHaveLength(2)
  })

  it('looks for a missing Up next cover once more too, and shows it when it comes', async () => {
    const { mac, pushes } = setup()
    const next = { title: 'Rainy Window', artist: 'Lofi Desk Club', durationSec: 201 }
    const withNext = { next: { ...next, artworkRef: 'ref-2' } }
    const nextId = 'spotify:next:ref-2'
    mac.artworkReply = new Uint8Array([1])
    mac.emit(open('spotify', T0))
    await settle()
    // The playing song's cover came; the first try for the next one fails (say the browser's
    // connection dropped for a moment).
    mac.artworkReply = null
    mac.emit(open('spotify', T0 + 0.5, { positionSec: 10.5, ...withNext }))
    await settle()
    clock = T0 + 2
    mac.emit(open('spotify', clock, { positionSec: 12, ...withNext }))
    await settle()
    expect(mac.artworkCalls).toEqual(['track-1', nextId])
    mac.artworkReply = new Uint8Array([1, 2])
    clock = T0 + 15
    mac.emit(open('spotify', clock, { positionSec: 25, ...withNext }))
    await settle()
    expect(mac.artworkCalls).toEqual(['track-1', nextId, nextId])
    expect(pushes.at(-1)?.next).toEqual({ ...next, artwork: 'data:image/jpeg;base64,2' })
    clock = T0 + 40
    mac.emit(open('spotify', clock, { positionSec: 50, ...withNext }))
    await settle()
    expect(mac.artworkCalls).toHaveLength(3)
  })

  it('sends commands to the player on screen and takes its fresh reading', async () => {
    const { mac, service } = setup()
    mac.emit(open('appleMusic', T0))
    mac.commandReply = open('appleMusic', T0 + 0.2, { status: 'paused' })
    service.command({ kind: 'playPause' })
    await settle()
    expect(mac.commands).toEqual([{ player: 'appleMusic', command: { kind: 'playPause' } }])
    expect(service.get().playing).toBe(false)
  })

  it('shows a pressed button at once, then takes it back if the player never agrees', () => {
    const { mac, service, pushes } = setup()
    mac.emit(open('appleMusic', T0))
    service.command({ kind: 'playPause' })
    expect(service.get().playing).toBe(false)
    expect(pushes.at(-1)?.playing).toBe(false)

    clock = T0 + 1
    mac.emit(open('appleMusic', clock, { positionSec: 11 }))
    expect(service.get().playing).toBe(false)

    clock = T0 + 4
    mac.emit(open('appleMusic', clock, { positionSec: 14 }))
    expect(service.get().playing).toBe(true)
  })

  it('turns previous into a restart once the song is a few seconds in', () => {
    const { mac, service } = setup()
    mac.emit(open('spotify', T0, { positionSec: 1 }))
    service.command({ kind: 'previous' })
    clock = T0 + 5
    service.command({ kind: 'previous' })
    expect(mac.commands.map((c) => c.command.kind)).toEqual(['previous', 'restart'])
  })

  it('jumps where the bar was dragged, at once, and never past the end', () => {
    const { mac, service } = setup()
    mac.emit(open('appleMusic', T0, { positionSec: 10 }))
    service.command({ kind: 'seek', positionSec: 95 })
    expect(service.get().positionSec).toBe(95)
    service.command({ kind: 'seek', positionSec: 9999 })
    expect(mac.commands.map((c) => c.command)).toEqual([
      { kind: 'seek', positionSec: 95 },
      { kind: 'seek', positionSec: 186 }
    ])
  })

  it('refuses a repeat mode the player cannot do, and commands with no song', () => {
    const { mac, service } = setup()
    service.command({ kind: 'next' })
    mac.emit(open('spotify', T0))
    service.command({ kind: 'setRepeat', mode: 'one' })
    service.command({ kind: 'setRepeat', mode: 'all' })
    expect(mac.commands.map((c) => c.command)).toEqual([{ kind: 'setRepeat', mode: 'all' }])
  })

  it('shows the demo only while no real player is open, and can turn it off', () => {
    const { mac, demo, service } = setup({ demo: true })
    demo?.emit(open('demo', T0))
    expect(service.get().player?.name).toBe('Demo')
    expect(service.get().supportedPlayers).toEqual(['Spotify', 'Apple Music'])

    mac.emit(open('appleMusic', T0, { status: 'stopped', track: null }))
    expect(service.get().player?.name).toBe('Apple Music')
    expect(service.get().track).toBeNull()

    mac.emit({ player: 'appleMusic', at: T0 + 0.5, kind: 'closed' })
    expect(service.get().player?.name).toBe('Demo')
    service.setDemoEnabled(false)
    expect(service.get().player).toBeNull()
  })
})
