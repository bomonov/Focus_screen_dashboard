import { ext, type PopupRequest, type PopupStatus } from './messages'

/** While open, the popup checks how pairing is going this often. */
const REFRESH_MS = 700
/** The background answers in milliseconds when it's running; longer means it isn't. */
const ANSWER_TIMEOUT_MS = 2000

const HOW_TO_PAIR =
  'In Focus Screen, open Customize → Music → Connect Browser Extension…, then type the code here.'

const COPY: Record<PopupStatus['status'], { text: string; tone: 'ok' | 'error' | 'idle' }> = {
  connected: { text: 'Connected', tone: 'ok' },
  connecting: { text: 'Connecting…', tone: 'idle' },
  offline: { text: 'Focus Screen isn’t running', tone: 'error' },
  unpaired: { text: 'Not connected yet', tone: 'idle' },
  badCode: { text: 'That code didn’t work', tone: 'error' }
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing #${id}`)
  return found as T
}

const statusRow = element('status')
const statusText = element('status-text')
const detail = element('detail')
const form = element<HTMLFormElement>('pair')
const codeInput = element<HTMLInputElement>('code')
const submit = element<HTMLButtonElement>('connect')
const forget = element<HTMLButtonElement>('forget')

function isPopupStatus(value: unknown): value is PopupStatus {
  return typeof value === 'object' && value !== null && 'status' in value
}

async function ask(request: PopupRequest): Promise<void> {
  const timedOut = new Promise<string>((resolve) =>
    setTimeout(() => resolve('no answer within 2 seconds'), ANSWER_TIMEOUT_MS)
  )
  const reply = await Promise.race([
    Promise.resolve()
      .then(() => ext.runtime.sendMessage(request))
      .catch((error: unknown) => String(error)),
    timedOut
  ])
  if (isPopupStatus(reply)) {
    render(reply)
    return
  }
  // The background script didn't answer: say so instead of hanging on "Checking…".
  statusRow.dataset.tone = 'error'
  statusText.textContent = 'Extension isn’t ready'
  detail.textContent = `Its background part didn’t answer${typeof reply === 'string' ? ` (${reply})` : ''}. Turn the extension off and on in the browser’s settings.`
}

function render({ status, song, error }: PopupStatus): void {
  const copy = COPY[status]
  statusRow.dataset.tone = copy.tone
  statusText.textContent = copy.text
  // A new code can always be entered until it's connected, so a failed try never locks you out.
  form.hidden = status === 'connected'
  submit.disabled = status === 'connecting'
  forget.hidden = status !== 'connected' && status !== 'offline'
  detail.textContent =
    error ??
    (status === 'connected'
      ? song
        ? `Showing: ${song}`
        : 'Play something on music.youtube.com.'
      : status === 'offline'
        ? 'It reconnects by itself once Focus Screen is open. You can also enter a new code.'
        : status === 'badCode'
          ? `Codes work once, for 5 minutes. ${HOW_TO_PAIR}`
          : status === 'connecting'
            ? 'Talking to Focus Screen…'
            : HOW_TO_PAIR)
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  const code = codeInput.value.replace(/\D/g, '')
  if (code.length !== 6) return
  codeInput.value = ''
  void ask({ type: 'pair', code })
})

forget.addEventListener('click', () => void ask({ type: 'forget' }))

void ask({ type: 'status' })
setInterval(() => void ask({ type: 'status' }), REFRESH_MS)
