// Builds the extension twice from one source:
//   extension/dist         Chrome (load unpacked): background runs as a service worker.
//   extension/dist-safari  Safari (wrapped by native/safari-extension): background runs as a
//                          non-persistent page, which Safari supports far more reliably.
// Each script is its own self-contained file, since content scripts can't import modules.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { build } from 'vite'

const root = dirname(fileURLToPath(import.meta.url))
const chromeOut = join(root, 'dist')
const safariOut = join(root, 'dist-safari')

rmSync(chromeOut, { recursive: true, force: true })
rmSync(safariOut, { recursive: true, force: true })

for (const name of ['background', 'content', 'youtube', 'queueCovers', 'popup']) {
  await build({
    configFile: false,
    publicDir: false,
    logLevel: 'warn',
    build: {
      outDir: chromeOut,
      emptyOutDir: false,
      minify: false,
      target: 'es2022',
      lib: {
        entry: join(root, 'src', `${name}.ts`),
        formats: ['iife'],
        name: `focusScreen_${name}`,
        fileName: () => `${name}.js`
      }
    }
  })
}

for (const file of ['manifest.json', 'popup.html', 'icons']) {
  cpSync(join(root, file), join(chromeOut, file), { recursive: true })
}

// Safari: same files, different background, and no Chrome-only key.
mkdirSync(safariOut, { recursive: true })
cpSync(chromeOut, safariOut, { recursive: true })
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
delete manifest.key
manifest.background = { scripts: ['background.js'], persistent: false }
writeFileSync(join(safariOut, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`Extension built in ${chromeOut} (Chrome) and ${safariOut} (Safari)`)
