// Holds the connection to Focus Screen and relays between it and the YouTube Music tabs.
import {
  EXTENSION_PORT,
  isArtworkUrl,
  MAX_ARTWORK_BYTES,
  PROTOCOL_VERSION,
  type AppMessage,
  type ExtensionMessage,
  type PageCommand,
  type PageLyrics
} from '../../src/main/services/music/extension-ws/protocol'
import {
  ext,
  PAGE_LINE,
  type ConnectionStatus,
  type PageLyricsMessage,
  type PageMessage,
  type PopupRequest,
  type PopupStatus,
  type TabMessage
} from './messages'
import { chooseTab, parseAppMessage, toBase64, type TabEntry } from './page'

const TOKEN_KEY = 'focusScreenToken'
const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 30_000
const ARTWORK_TIMEOUT_MS = 8000
/** A connection that hasn't opened by now isn't going to; give up so the user can retry. */
const CONNECT_TIMEOUT_MS = 5000
const UNREACHABLE = 'Couldn’t reach Focus Screen. Make sure it’s open, then try again.'

let socket: WebSocket | null = null
let status: ConnectionStatus = 'unpaired'
let pairCode: string | null = null
let lastError: string | null = null
let reconnectDelay = RECONNECT_MIN_MS
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
const tabs = new Map<number, TabEntry>()
let shownTab: number | null = null
/** The last lyrics a page read: sent again on connecting, so ones read while offline arrive. */
let lastLyrics: PageLyrics | null = null

function send(message: ExtensionMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

async function storedToken(): Promise<string | null> {
  const stored = await ext.storage.local.get(TOKEN_KEY)
  const token = stored[TOKEN_KEY]
  return typeof token === 'string' ? token : null
}

/** Sends the shown tab's state; called whenever it (or which tab is shown) changes. */
function sendShownState(): void {
  if (status !== 'connected') return
  send({ type: 'state', state: shownTab === null ? null : (tabs.get(shownTab)?.state ?? null) })
}

/** On (re)connecting: the state, then the last lyrics read, which may have missed the app. */
function sendOnConnect(): void {
  sendShownState()
  if (lastLyrics) send({ type: 'lyrics', lyrics: lastLyrics })
}

function updateShownTab(): boolean {
  const next = chooseTab(tabs, shownTab)
  const changed = next !== shownTab
  shownTab = next
  return changed
}

/** The attempt under way: waking up and a page speaking up both connect, and must share one. */
let connecting: Promise<void> | null = null

/** Connects when there's something to connect with: a saved token or a code to pair with. */
function connect(): Promise<void> {
  connecting ??= openSocket().finally(() => {
    connecting = null
  })
  return connecting
}

async function openSocket(): Promise<void> {
  if (socket) return
  clearTimeout(reconnectTimer)
  const token = await storedToken()
  const pairing = pairCode !== null
  if (!token && !pairing) {
    status = 'unpaired'
    return
  }
  status = 'connecting'
  let ws: WebSocket
  try {
    ws = new WebSocket(`ws://127.0.0.1:${EXTENSION_PORT}`)
  } catch (error) {
    // Some browsers refuse a local connection outright instead of failing it later.
    lastError = `The browser blocked the connection (${String(error)}).`
    status = token ? 'offline' : 'unpaired'
    pairCode = null
    return
  }
  socket = ws
  let opened = false
  const giveUp = setTimeout(() => {
    if (!opened) ws.close()
  }, CONNECT_TIMEOUT_MS)

  ws.onopen = () => {
    opened = true
    clearTimeout(giveUp)
    if (pairCode) send({ type: 'pair', version: PROTOCOL_VERSION, code: pairCode })
    else if (token) send({ type: 'hello', version: PROTOCOL_VERSION, token })
    pairCode = null
  }
  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') return
    let raw: unknown
    try {
      raw = JSON.parse(event.data)
    } catch {
      return
    }
    // Whatever answers on this port is checked too: if Focus Screen isn't running, it isn't us.
    const message = parseAppMessage(raw)
    if (message) void handleApp(message)
  }
  ws.onclose = () => {
    clearTimeout(giveUp)
    // A socket we replaced on purpose (re-pairing, forgetting) closes quietly.
    if (socket !== ws) return
    socket = null
    if (status !== 'connected' && status !== 'connecting') return
    if (!opened) lastError = UNREACHABLE
    if (pairing && !opened) {
      // A code that never got through: let the user try again rather than retrying forever.
      pairCode = null
      status = token ? 'offline' : 'unpaired'
      return
    }
    if (token) {
      status = 'offline'
      scheduleReconnect()
    } else {
      status = 'unpaired'
    }
  }
}

function scheduleReconnect(): void {
  clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(() => void connect(), reconnectDelay)
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS)
}

async function handleApp(message: AppMessage): Promise<void> {
  switch (message.type) {
    case 'welcome':
      status = 'connected'
      lastError = null
      reconnectDelay = RECONNECT_MIN_MS
      sendOnConnect()
      break
    case 'paired':
      await ext.storage.local.set({ [TOKEN_KEY]: message.token })
      status = 'connected'
      lastError = null
      reconnectDelay = RECONNECT_MIN_MS
      sendOnConnect()
      break
    case 'rejected':
      // A refused token is useless; a refused code just needs a new try.
      if (message.reason === 'badToken') await ext.storage.local.remove(TOKEN_KEY)
      status = message.reason === 'badCode' ? 'badCode' : 'unpaired'
      lastError =
        message.reason === 'version'
          ? 'This extension and Focus Screen are different versions. Update both.'
          : null
      break
    case 'command':
      forwardCommand(message.command)
      break
    case 'artworkRequest':
      await sendArtwork(message.requestId, message.url)
      break
    case 'keepalive':
      break
  }
}

function forwardCommand(command: PageCommand): void {
  if (shownTab === null) return
  const message: TabMessage = { type: 'command', command }
  ext.tabs.sendMessage(shownTab, message).catch(() => undefined)
}

async function sendArtwork(requestId: number, url: string): Promise<void> {
  try {
    if (!isArtworkUrl(url)) throw new Error('not a cover URL')
    const response = await fetch(url, {
      credentials: 'omit',
      signal: AbortSignal.timeout(ARTWORK_TIMEOUT_MS)
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_ARTWORK_BYTES) throw new Error('cover too big')
    send({ type: 'artwork', requestId, base64: toBase64(bytes) })
  } catch {
    send({ type: 'artworkFailed', requestId })
  }
}

function isPageMessage(raw: unknown): raw is PageMessage {
  return typeof raw === 'object' && raw !== null && 'type' in raw && raw.type === 'page'
}

function isLyricsMessage(raw: unknown): raw is PageLyricsMessage {
  return typeof raw === 'object' && raw !== null && 'type' in raw && raw.type === 'lyrics'
}

function isPopupRequest(raw: unknown): raw is PopupRequest {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    'type' in raw &&
    (raw.type === 'status' || raw.type === 'pair' || raw.type === 'forget')
  )
}

function popupStatus(): PopupStatus {
  const state = shownTab === null ? null : (tabs.get(shownTab)?.state ?? null)
  return {
    status,
    song: state ? [state.title, state.artist].filter(Boolean).join(' · ') : null,
    error: lastError
  }
}

async function handlePopup(request: PopupRequest): Promise<PopupStatus> {
  if (request.type === 'pair') {
    pairCode = request.code.replace(/\D/g, '')
    lastError = null
    const previous = socket
    socket = null
    previous?.close()
    await connect()
  } else if (request.type === 'forget') {
    await ext.storage.local.remove(TOKEN_KEY)
    status = 'unpaired'
    lastError = null
    clearTimeout(reconnectTimer)
    const previous = socket
    socket = null
    previous?.close()
  }
  return popupStatus()
}

ext.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  const tabId = sender.tab?.id
  if (tabId !== undefined && isPageMessage(raw)) {
    tabs.set(tabId, { state: raw.state, at: Date.now() })
    const shownChanged = updateShownTab()
    if (shownChanged || tabId === shownTab) sendShownState()
    // A page speaking up is the moment to (re)connect after the worker slept.
    if (!socket) void connect()
    return false
  }
  if (tabId !== undefined && isLyricsMessage(raw)) {
    // The app checks them, like everything from a page; this only passes them on.
    lastLyrics = raw.lyrics
    if (status === 'connected') send({ type: 'lyrics', lyrics: raw.lyrics })
    else if (!socket) void connect()
    return false
  }
  if (tabId === undefined && isPopupRequest(raw)) {
    handlePopup(raw).then(sendResponse, () => sendResponse(popupStatus()))
    // Keeps sendResponse valid until the promise settles.
    return true
  }
  return false
})

// A tab's open line (content.ts): it only has to be taken. A tab reopening it after Safari
// stopped this page is what starts the page again.
ext.runtime.onConnect.addListener((port) => {
  if (port.name !== PAGE_LINE || port.sender?.tab?.id === undefined) return
  if (!socket) void connect()
})

ext.tabs.onRemoved.addListener((tabId) => {
  if (!tabs.delete(tabId)) return
  updateShownTab()
  sendShownState()
})

/** After the worker (re)starts it knows no tabs; ask open YouTube Music tabs to report. */
async function wake(): Promise<void> {
  const open = await Promise.resolve()
    .then(() => ext.tabs.query({ url: 'https://music.youtube.com/*' }))
    .catch(() => [])
  const ask: TabMessage = { type: 'report' }
  for (const tab of open) {
    if (tab.id !== undefined) ext.tabs.sendMessage(tab.id, ask).catch(() => undefined)
  }
  await connect()
}

// Not every browser has both events; a missing one must not stop the rest of this script.
ext.runtime.onStartup?.addListener(() => void wake())
ext.runtime.onInstalled?.addListener(() => void wake())
void wake()
