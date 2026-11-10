import { useId, useState } from 'react'
import type { CanvasFormField, CanvasFormRequest, CanvasFormResult } from '../../../main/ipc'

type Mode = 'token' | 'feed'

interface CanvasFormProps {
  /** The address used last time, or "". */
  initialAddress: string
  onClose(): void
}

const SOMETHING_WRONG: CanvasFormResult = {
  ok: false,
  message: 'Something went wrong. Try again.',
  field: null
}

function send(request: CanvasFormRequest): Promise<CanvasFormResult> {
  return window.focusScreen.sendCanvasForm(request).catch(() => SOMETHING_WRONG)
}

/**
 * Connects Canvas with a personal access token, or with the read-only calendar feed when the
 * school turns tokens off. What's typed goes straight to the main process, which checks it
 * with Canvas before keeping it.
 */
export function CanvasForm({ initialAddress, onClose }: CanvasFormProps): React.JSX.Element {
  const id = useId()
  const [mode, setMode] = useState<Mode>('token')
  const [address, setAddress] = useState(initialAddress)
  const [token, setToken] = useState('')
  const [feedUrl, setFeedUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; field: CanvasFormField | null } | null>(
    null
  )

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await send(
      mode === 'token'
        ? { kind: 'connectToken', address, token }
        : { kind: 'connectFeed', url: feedUrl }
    )
    setBusy(false)
    if (result.ok) {
      setToken('')
      onClose()
    } else {
      setError({ message: result.message, field: result.field })
    }
  }

  function openPage(page: Mode): void {
    void send({ kind: 'openPage', page, address }).then((result) => {
      if (!result.ok) setError({ message: result.message, field: result.field })
    })
  }

  function switchMode(): void {
    setMode(mode === 'token' ? 'feed' : 'token')
    setError(null)
  }

  const fieldError = (field: CanvasFormField | null): React.JSX.Element | null =>
    error && error.field === field ? (
      <p id={`${id}-${field ?? 'form'}-error`} className="canvas-form__error" role="alert">
        {error.message}
      </p>
    ) : null
  const describedBy = (field: CanvasFormField): string | undefined =>
    error?.field === field ? `${id}-${field}-error` : undefined

  return (
    <form className="canvas-form" onSubmit={(event) => void submit(event)} noValidate>
      <div className="canvas-form__fields">
        <div className="canvas-form__field">
          <label className="canvas-form__label" htmlFor={`${id}-address`}>
            Canvas address
          </label>
          <input
            id={`${id}-address`}
            className="canvas-form__input"
            type="text"
            inputMode="url"
            placeholder="canvas.school.edu"
            autoComplete="off"
            spellCheck={false}
            autoFocus={initialAddress === ''}
            value={address}
            aria-invalid={error?.field === 'address'}
            aria-describedby={describedBy('address')}
            onChange={(event) => setAddress(event.target.value)}
          />
          {fieldError('address')}
        </div>
        {mode === 'token' ? (
          <div className="canvas-form__field">
            <label className="canvas-form__label" htmlFor={`${id}-token`}>
              Access token
            </label>
            <input
              id={`${id}-token`}
              className="canvas-form__input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              autoFocus={initialAddress !== ''}
              value={token}
              aria-invalid={error?.field === 'token'}
              aria-describedby={describedBy('token')}
              onChange={(event) => setToken(event.target.value)}
            />
            {fieldError('token')}
          </div>
        ) : (
          <div className="canvas-form__field">
            <label className="canvas-form__label" htmlFor={`${id}-url`}>
              Calendar feed link
            </label>
            <input
              id={`${id}-url`}
              className="canvas-form__input"
              type="url"
              placeholder="https://…/feeds/calendars/user_….ics"
              autoComplete="off"
              spellCheck={false}
              value={feedUrl}
              aria-invalid={error?.field === 'url'}
              aria-describedby={describedBy('url')}
              onChange={(event) => setFeedUrl(event.target.value)}
            />
            {fieldError('url')}
          </div>
        )}
      </div>

      <p className="canvas-form__hint">
        {mode === 'token'
          ? 'In Canvas, open Account → Settings and click “+ New Access Token”.'
          : 'For schools that turn tokens off: in Canvas, open Calendar and click Calendar Feed. It’s read-only, so check-offs stay on this computer.'}
      </p>
      {fieldError(null)}

      <div className="canvas-form__actions">
        <button type="submit" className="todo-list__action" disabled={busy}>
          {busy ? 'Checking…' : 'Connect'}
        </button>
        <button
          type="button"
          className="todo-list__action todo-list__action--quiet"
          onClick={onClose}
        >
          Cancel
        </button>
        <button type="button" className="canvas-form__link" onClick={() => openPage(mode)}>
          {mode === 'token' ? 'Open Canvas Settings' : 'Open Canvas Calendar'}
        </button>
        <button type="button" className="canvas-form__link" onClick={switchMode}>
          {mode === 'token' ? 'Use the calendar feed instead' : 'Use an access token instead'}
        </button>
      </div>
    </form>
  )
}
