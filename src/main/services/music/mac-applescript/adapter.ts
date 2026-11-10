import { execFile } from 'child_process'
import { runHelperProcess, type HelperProcess } from '../../helperProcess'
import { fetchBytes } from '../../http'
import type { AdapterCommand, MusicAdapter, PlayerInfo } from '../adapter'
import type { PlayerId } from '../types'
import { parseAppleScriptData, parseMacReport, spotifyArtworkUrl, type MacPlayer } from './parse'
import { MUSIC_ARTWORK_SCRIPT, PLAYER_SCRIPT } from './scripts'

const OSASCRIPT = '/usr/bin/osascript'
const COMMAND_TIMEOUT_MS = 5000
const ARTWORK_TIMEOUT_MS = 10_000
/** A cover printed as hex is twice its size; real ones stay well under 8 MB. */
const ARTWORK_OUTPUT_MAX = 16 * 1024 * 1024
const SPOTIFY_ARTWORK_MAX_BYTES = 5 * 1024 * 1024

const PLAYERS: readonly (PlayerInfo & { id: MacPlayer })[] = [
  { id: 'spotify', name: 'Spotify', repeatModes: ['off', 'all'] },
  { id: 'appleMusic', name: 'Apple Music', repeatModes: ['off', 'all', 'one'] }
]

const epochSeconds = (): number => Date.now() / 1000

function isMacPlayer(player: PlayerId): player is MacPlayer {
  return player === 'spotify' || player === 'appleMusic'
}

function runOsascript(
  args: readonly string[],
  timeoutMs: number,
  maxBuffer = 1024 * 1024
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(OSASCRIPT, args, { timeout: timeoutMs, maxBuffer }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

function commandArgs(command: AdapterCommand): string[] {
  switch (command.kind) {
    case 'setShuffle':
      return [command.kind, String(command.on)]
    case 'setRepeat':
      return [command.kind, command.mode]
    case 'seek':
      return [command.kind, command.positionSec.toFixed(2)]
    default:
      return [command.kind]
  }
}

/** Spotify and Apple Music on macOS, through osascript. */
export function createMacAppleScriptAdapter(): MusicAdapter {
  const pollers: HelperProcess[] = []

  return {
    players: PLAYERS,
    start(onReport) {
      // One poller per player, so a player that hangs can't hold up the other one.
      for (const { id } of PLAYERS) {
        pollers.push(
          runHelperProcess({
            label: `music:${id}`,
            command: OSASCRIPT,
            args: ['-l', 'JavaScript', '-e', PLAYER_SCRIPT, 'poll', id],
            onMessage: (message) => {
              const report = parseMacReport(id, message, epochSeconds())
              if (report) onReport(report)
            }
          })
        )
      }
    },
    async command(player, command) {
      if (!isMacPlayer(player)) return null
      const stdout = await runOsascript(
        ['-l', 'JavaScript', '-e', PLAYER_SCRIPT, 'command', player, ...commandArgs(command)],
        COMMAND_TIMEOUT_MS
      )
      let reading: unknown
      try {
        reading = JSON.parse(stdout)
      } catch {
        return null
      }
      return parseMacReport(player, reading, epochSeconds())
    },
    async loadArtwork(player, track) {
      if (!track.artworkRef) return null
      if (player === 'spotify') {
        // Checked again right where the request goes out: only Spotify's image server.
        const url = spotifyArtworkUrl(track.artworkRef)
        if (!url) return null
        return fetchBytes(url, {
          maxBytes: SPOTIFY_ARTWORK_MAX_BYTES,
          timeoutMs: ARTWORK_TIMEOUT_MS
        })
      }
      if (player === 'appleMusic') {
        const stdout = await runOsascript(
          ['-e', MUSIC_ARTWORK_SCRIPT, track.artworkRef],
          ARTWORK_TIMEOUT_MS,
          ARTWORK_OUTPUT_MAX
        )
        return parseAppleScriptData(stdout)
      }
      return null
    },
    dispose() {
      for (const poller of pollers) poller.stop()
      pollers.length = 0
    }
  }
}
