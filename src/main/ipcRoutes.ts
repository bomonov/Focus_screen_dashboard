import { ipcMain, type IpcMainEvent, type WebContents, type WebFrameMain } from 'electron'
import type { EventChannels, InvokeChannels, SendChannels } from './ipc'
import { isAppUrl } from './paths'

function isTrustedSender(frame: WebFrameMain | null): boolean {
  return frame !== null && isAppUrl(frame.url)
}

/**
 * Registers a request handler. Arguments arrive as `unknown` on purpose: the renderer is
 * untrusted input, so each handler narrows what it receives.
 */
export function handle<K extends keyof InvokeChannels>(
  channel: K,
  handler: (
    ...args: unknown[]
  ) => InvokeChannels[K]['result'] | Promise<InvokeChannels[K]['result']>
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!isTrustedSender(event.senderFrame))
      throw new Error(`Blocked ${channel} from untrusted frame`)
    return handler(...args)
  })
}

/** Like `handle`, for requests that also need to know which page sent them. */
export function handleFrom<K extends keyof InvokeChannels>(
  channel: K,
  handler: (
    sender: WebContents,
    ...args: unknown[]
  ) => InvokeChannels[K]['result'] | Promise<InvokeChannels[K]['result']>
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!isTrustedSender(event.senderFrame))
      throw new Error(`Blocked ${channel} from untrusted frame`)
    return handler(event.sender, ...args)
  })
}

export function on<K extends keyof SendChannels>(
  channel: K,
  listener: (event: IpcMainEvent, ...args: unknown[]) => void
): void {
  ipcMain.on(channel, (event, ...args: unknown[]) => {
    if (isTrustedSender(event.senderFrame)) listener(event, ...args)
  })
}

export function sendEvent<K extends keyof EventChannels>(
  contents: WebContents,
  channel: K,
  payload: EventChannels[K]
): void {
  if (!contents.isDestroyed()) contents.send(channel, payload)
}
