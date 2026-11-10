import './theme/tokens.css'
import './theme/global.css'
import './theme/glass.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App, type View } from './App'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element in index.html')

/** Main loads each window's page with its view in the hash. */
function viewFromHash(hash: string): View {
  if (hash === '#customize') return 'customize'
  if (hash === '#lyrics-editor') return 'lyrics-editor'
  return 'focus'
}

const TITLES: Record<View, string> = {
  focus: 'Focus Screen',
  customize: 'Customize',
  'lyrics-editor': 'Color-Code Lyrics'
}

const view = viewFromHash(window.location.hash)
// global.css sizes text per window: the Focus Screen scales with its display, the others don't.
document.documentElement.dataset.view = view
document.title = TITLES[view]

/** How often to try again while the bridge is missing, and for how long at most. */
const BRIDGE_RETRY_MS = 2000
const BRIDGE_MAX_TRIES = 30
const BRIDGE_TRIES_KEY = 'focus-screen:bridge-tries'

// The preload can miss its start when macOS holds the app on a Keychain prompt (a new build asks
// for "Focus Screen Safe Storage"). Without the bridge nothing can show, so wait and load again.
// `in` because the type says it's always there; it isn't when the preload didn't run.
if (!('focusScreen' in window)) {
  const tries = Number(sessionStorage.getItem(BRIDGE_TRIES_KEY) ?? 0)
  root.textContent = 'Starting Focus Screen…'
  if (tries < BRIDGE_MAX_TRIES) {
    sessionStorage.setItem(BRIDGE_TRIES_KEY, String(tries + 1))
    setTimeout(() => window.location.reload(), BRIDGE_RETRY_MS)
  }
} else {
  sessionStorage.removeItem(BRIDGE_TRIES_KEY)
  createRoot(root).render(
    <StrictMode>
      <App view={view} />
    </StrictMode>
  )
}
