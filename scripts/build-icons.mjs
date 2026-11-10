// Draws the app icon and the menu bar / tray icon from the SVGs below.
//
//   npm run build:icons
//
// Writes build/icon.png, build/icon.icns (macOS: iconutil), build/icon.ico, and the menu bar
// (assets/tray/trayTemplate.png + @2x) and Windows tray (assets/tray/tray.ico) icons. Run by
// Electron, so it needs no extra dependencies: a hidden window turns each SVG into PNGs.
// The look: a record (the music card's disc) inside a gold timer ring, on a dark tile.
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { app, BrowserWindow } from 'electron'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'build')
const trayDir = join(root, 'assets/tray')

const GOLD = '#FFC627'
/** How much of the timer ring is lit. */
const RING_FILL = 0.72

/** A circle drawn as a stroke from 12 o'clock, clockwise, `fill` of the way round. */
function arc(cx, cy, r, fill, attrs) {
  const length = 2 * Math.PI * r
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-linecap="round" ` +
    `stroke-dasharray="${(length * fill).toFixed(2)} ${length.toFixed(2)}" ` +
    `transform="rotate(-90 ${cx} ${cy})" ${attrs}/>`
  )
}

/**
 * The app icon on a 1024 canvas. macOS icons sit on Apple's grid (an 824 px tile with room for
 * a shadow); Windows icons use nearly the whole canvas.
 */
function appIconSvg({ inset, shadow }) {
  const tile = 1024 - inset * 2
  const c = 412
  const grooves = [205, 185, 165, 145]
    .map(
      (r) => `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#1d1d1d" stroke-width="3"/>`
    )
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a2a2a"/>
      <stop offset="1" stop-color="#0e0e0e"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="125%">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity="0.35"/>
    </filter>
  </defs>
  <g transform="translate(${inset} ${inset}) scale(${tile / 824})">
    <rect width="824" height="824" rx="185" fill="url(#tile)" ${shadow ? 'filter="url(#shadow)"' : ''}/>
    <rect x="1.5" y="1.5" width="821" height="821" rx="183.5" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="3"/>
    <circle cx="${c}" cy="${c}" r="290" fill="none" stroke="#333333" stroke-width="44"/>
    ${arc(c, c, 290, RING_FILL, `stroke="${GOLD}" stroke-width="44"`)}
    <circle cx="${c}" cy="${c}" r="225" fill="#050505"/>
    ${grooves}
    <circle cx="${c}" cy="${c}" r="72" fill="${GOLD}"/>
    <circle cx="${c}" cy="${c}" r="12" fill="#050505"/>
  </g>
</svg>`
}

/** The menu bar icon: black on clear, which macOS recolors to match the menu bar. */
function trayTemplateSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <circle cx="8" cy="8" r="6.1" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="1.7"/>
  ${arc(8, 8, 6.1, RING_FILL, 'stroke="#000" stroke-width="1.7"')}
  <circle cx="8" cy="8" r="2.3" fill="#000"/>
</svg>`
}

/** Runs in the hidden page: draws an SVG at `size` px and returns it as a PNG data URL. */
async function rasterize(svg, size) {
  const sized = svg.replace('<svg ', `<svg width="${size}" height="${size}" `)
  const image = new Image()
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sized)
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  canvas.getContext('2d').drawImage(image, 0, 0, size, size)
  return canvas.toDataURL('image/png')
}

async function png(win, svg, size) {
  const dataUrl = await win.webContents.executeJavaScript(
    `(${rasterize.toString()})(${JSON.stringify(svg)}, ${size})`
  )
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
}

/** An .ico holding PNG images, which Windows Vista and later read at every size. */
function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const entries = Buffer.alloc(16 * images.length)
  let offset = header.length + entries.length
  images.forEach(({ size, data }, index) => {
    const at = index * 16
    entries.writeUInt8(size >= 256 ? 0 : size, at)
    entries.writeUInt8(size >= 256 ? 0 : size, at + 1)
    entries.writeUInt16LE(1, at + 4)
    entries.writeUInt16LE(32, at + 6)
    entries.writeUInt32LE(data.length, at + 8)
    entries.writeUInt32LE(offset, at + 12)
    offset += data.length
  })
  return Buffer.concat([header, entries, ...images.map((image) => image.data)])
}

async function main(win) {
  const mac = appIconSvg({ inset: 100, shadow: true })
  const windows = appIconSvg({ inset: 24, shadow: false })
  const tray = trayTemplateSvg()

  mkdirSync(trayDir, { recursive: true })
  writeFileSync(join(buildDir, 'icon.png'), await png(win, mac, 1024))
  writeFileSync(join(trayDir, 'trayTemplate.png'), await png(win, tray, 16))
  writeFileSync(join(trayDir, 'trayTemplate@2x.png'), await png(win, tray, 32))

  const icoImages = async (sizes) =>
    Promise.all(sizes.map(async (size) => ({ size, data: await png(win, windows, size) })))
  writeFileSync(join(buildDir, 'icon.ico'), ico(await icoImages([16, 24, 32, 48, 64, 128, 256])))
  writeFileSync(join(trayDir, 'tray.ico'), ico(await icoImages([16, 20, 24, 32, 40, 48])))

  if (process.platform === 'darwin') {
    const iconset = join(app.getPath('temp'), `focus-screen-${process.pid}.iconset`)
    mkdirSync(iconset, { recursive: true })
    for (const size of [16, 32, 128, 256, 512]) {
      writeFileSync(join(iconset, `icon_${size}x${size}.png`), await png(win, mac, size))
      writeFileSync(join(iconset, `icon_${size}x${size}@2x.png`), await png(win, mac, size * 2))
    }
    execFileSync('iconutil', ['-c', 'icns', '-o', join(buildDir, 'icon.icns'), iconset])
    rmSync(iconset, { recursive: true, force: true })
  } else {
    console.warn('build/icon.icns not updated: iconutil only exists on macOS.')
  }
  console.log('Icons written to build/ and assets/tray/.')
}

// A throwaway profile, so this never touches an app's real user data.
const profile = mkdtempSync(join(tmpdir(), 'focus-screen-icons-'))
app.setPath('userData', profile)
app.dock?.hide()

app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({ show: false })
    await win.loadURL('about:blank')
    await main(win)
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    rmSync(profile, { recursive: true, force: true })
    app.exit(process.exitCode ?? 0)
  })
