// Scripts run by /usr/bin/osascript. They only read and print; turning their output into
// typed reports happens in parse.ts, where it can be tested.
//
// The player script is JavaScript for Automation (JXA) rather than AppleScript because it
// can print JSON, so song titles need no hand-escaping. Same Automation permission either way.
// Arguments always arrive through argv, never pasted into the source.

/**
 * `poll <player>`: prints one JSON reading per line, about once a second, until killed.
 * `command <player> <kind> [value]`: runs one command, then prints one fresh reading.
 *
 * It asks `running()` before touching a player, because any other Apple Event would
 * launch it, and Focus Screen must never open a player by itself.
 */
export const PLAYER_SCRIPT = String.raw`
ObjC.import('Foundation')

const POLL_SEC = 1
const NOT_INSTALLED_POLL_SEC = 5
// osascript isn't built to run for days; start fresh every hour (the app restarts it at once).
const RECYCLE_AFTER_SEC = 3600
const NO_SUCH_OBJECT = -1728

const now = () => Date.now() / 1000

// For properties some player versions lack: a missing one shouldn't sink the whole reading.
function attempt(read, fallback) {
  try { return read() } catch (e) { return fallback }
}

// For the current track, which doesn't exist between songs. Anything else is a real failure.
function optional(read) {
  try { return read() } catch (e) { if (e.errorNumber === NO_SUCH_OBJECT) return null; throw e }
}

const PLAYERS = {
  spotify: {
    bundleId: 'com.spotify.client',
    read(app) {
      const state = app.playerState()
      const position = attempt(() => app.playerPosition(), 0)
      const at = now()
      const track = state === 'stopped' ? null : optional(() => {
        const t = app.currentTrack
        return {
          id: t.id(), name: t.name(), artist: t.artist(), album: t.album(),
          duration: t.duration(), artworkUrl: attempt(() => t.artworkUrl(), null)
        }
      })
      return {
        kind: 'open', at, state, position, track,
        shuffle: attempt(() => app.shuffling(), false),
        repeat: attempt(() => app.repeating(), false)
      }
    },
    command(app, kind, value) {
      switch (kind) {
        case 'playPause': app.playpause(); break
        case 'next': app.nextTrack(); break
        case 'previous': app.previousTrack(); break
        case 'restart': app.playerPosition = 0; break
        case 'seek': app.playerPosition = Number(value); break
        case 'setShuffle': app.shuffling = value === 'true'; break
        case 'setRepeat': app.repeating = value !== 'off'; break
      }
    }
  },
  appleMusic: {
    bundleId: 'com.apple.Music',
    read(app) {
      const state = app.playerState()
      const position = attempt(() => app.playerPosition(), 0)
      const at = now()
      const track = state === 'stopped' ? null : optional(() => {
        const t = app.currentTrack
        return {
          id: t.persistentID(), name: t.name(), artist: t.artist(), album: t.album(),
          duration: t.duration(), stream: attempt(() => app.currentStreamTitle(), null)
        }
      })
      return {
        kind: 'open', at, state, position, track,
        shuffle: attempt(() => app.shuffleEnabled(), false),
        repeat: attempt(() => app.songRepeat(), 'off')
      }
    },
    command(app, kind, value) {
      switch (kind) {
        case 'playPause': app.playpause(); break
        case 'next': app.nextTrack(); break
        case 'previous': app.previousTrack(); break
        case 'restart': app.playerPosition = 0; break
        case 'seek': app.playerPosition = Number(value); break
        case 'setShuffle': app.shuffleEnabled = value === 'true'; break
        case 'setRepeat': app.songRepeat = value; break
      }
    }
  }
}

function failure(e) {
  const code = e && e.errorNumber
  if (code === -1743) return { kind: 'denied', at: now() }
  // The player quit while we were asking.
  if (code === -600 || code === -609) return { kind: 'closed', at: now() }
  return { kind: 'failed', code: typeof code === 'number' ? code : null, at: now() }
}

function open(player) {
  try { return Application(player.bundleId) } catch (e) { return null }
}

function read(player) {
  const app = open(player)
  if (!app) return { kind: 'closed', installed: false, at: now() }
  if (!app.running()) return { kind: 'closed', at: now() }
  try { return player.read(app) } catch (e) { return failure(e) }
}

function poll(player) {
  const out = $.NSFileHandle.fileHandleWithStandardOutput
  const until = now() + RECYCLE_AFTER_SEC
  while (now() < until) {
    const reading = read(player)
    out.writeData($(JSON.stringify(reading) + '\n').dataUsingEncoding($.NSUTF8StringEncoding))
    delay(reading.installed === false ? NOT_INSTALLED_POLL_SEC : POLL_SEC)
  }
}

function command(player, kind, value) {
  const app = open(player)
  if (!app || !app.running()) return { kind: 'closed', at: now() }
  try { player.command(app, kind, value) } catch (e) { return failure(e) }
  // Let the player apply it, so the reading below already shows the change.
  delay(0.15)
  return read(player)
}

function run(argv) {
  const player = PLAYERS[argv[1]]
  if (!player) return ''
  if (argv[0] === 'poll') { poll(player); return '' }
  if (argv[0] === 'command') return JSON.stringify(command(player, argv[2], argv[3]))
  return ''
}
`

/**
 * `<persistent ID>`: prints the current Music song's cover as «data XXXX<hex>», or nothing
 * when the song changed in the meantime or has no cover. AppleScript, because JXA can't
 * hand back raw image bytes.
 */
export const MUSIC_ARTWORK_SCRIPT = String.raw`
on run argv
  if application id "com.apple.Music" is not running then return ""
  tell application id "com.apple.Music"
    if player state is stopped then return ""
    if persistent ID of current track is not (item 1 of argv) then return ""
    if (count of artworks of current track) is 0 then return ""
    return raw data of artwork 1 of current track
  end tell
end run
`
