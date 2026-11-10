// npm run install:mac: builds the signed Mac app and puts it in /Applications in one go.
// Quits the installed copy first (never force-quits it), keeps the last two installs to go
// back to, and opens the new one. A development copy (npm run dev) holds the one-copy lock, so
// the installed app can't open while it runs: that's said up front, not discovered later.
import { execFileSync, spawnSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const APP = '/Applications/Focus Screen.app'
const APP_BINARY = `${APP}/Contents/MacOS/Focus Screen`
const DEV_BINARY = join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const DEVELOPER = join(homedir(), 'Library/Developer/FocusScreen')
const BACKUPS = join(DEVELOPER, 'previous')
const KEEP_BACKUPS = 2
const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'

const say = (line) => console.log(`[install] ${line}`)

function fail(line) {
  console.error(`[install] ${line}`)
  process.exit(1)
}

/** Whether a process whose command line starts with `binary` is running. */
function running(binary) {
  return (
    spawnSync('pgrep', ['-f', `^${binary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`]).status === 0
  )
}

function signed(app) {
  return spawnSync('codesign', ['--verify', '--deep', '--strict', app]).status === 0
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (process.platform !== 'darwin') fail('This installs the Mac app; it only runs on macOS.')

const devRunning = running(DEV_BINARY)
if (devRunning) {
  say('A development copy (npm run dev) is running. The new app installs, but it can only open')
  say('once that copy is stopped: Focus Screen runs one copy at a time.')
}

if (!process.argv.includes('--skip-build')) {
  say('Building the signed app (a few minutes)…')
  const build = spawnSync('npm', ['run', 'build:mac'], { cwd: ROOT, stdio: 'inherit' })
  if (build.status !== 0) fail('The build failed; nothing was installed.')
}

const built = ['mac-arm64', 'mac']
  .map((folder) => join(DEVELOPER, 'dist', folder, 'Focus Screen.app'))
  .find((path) => existsSync(path))
if (!built) fail('No built app in ~/Library/Developer/FocusScreen/dist; run without --skip-build.')
if (!signed(built)) fail(`The built app's signature doesn't check out: ${built}`)

if (running(APP_BINARY)) {
  say('Quitting the installed Focus Screen…')
  spawnSync('osascript', ['-e', `tell application "${APP}" to quit`])
  for (let waited = 0; running(APP_BINARY) && waited < 15_000; waited += 250) await sleep(250)
  if (running(APP_BINARY)) fail('Focus Screen didn’t quit; quit it yourself and run this again.')
}

if (existsSync(APP)) {
  mkdirSync(BACKUPS, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  renameSync(APP, join(BACKUPS, `Focus Screen ${stamp}.app`))
  // Only our own backups, oldest first by their dated names.
  const backups = readdirSync(BACKUPS)
    .filter((name) => /^Focus Screen [\dT-]+\.app$/.test(name))
    .sort()
  for (const old of backups.slice(0, -KEEP_BACKUPS)) {
    rmSync(join(BACKUPS, old), { recursive: true, force: true })
  }
}

execFileSync('ditto', [built, APP])
if (!signed(APP)) fail(`The installed app's signature doesn't check out: ${APP}`)
// Spotlight and "Open with" should only know the installed copy, not the build.
spawnSync(LSREGISTER, ['-u', built])
spawnSync(LSREGISTER, ['-f', '-R', APP])
say(`Installed ${APP} (earlier installs are in ${BACKUPS}).`)

if (running(DEV_BINARY)) {
  say('Not opening it: the development copy is still running. Stop it, then open Focus Screen.')
} else {
  spawnSync('open', [APP])
  say('Opened.')
}
