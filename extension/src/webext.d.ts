// Just the slice of the WebExtensions API this extension uses, typed by hand so the extension
// needs no extra dependency. Chrome calls it `chrome`, Safari offers `browser` (and `chrome`).

interface WebExtSender {
  tab?: { id?: number }
}

interface WebExtEvent<Listener> {
  addListener(listener: Listener): void
}

interface WebExtPort {
  name: string
  sender?: WebExtSender
  onDisconnect: WebExtEvent<() => void>
}

interface WebExtApi {
  runtime: {
    /** Gone (undefined) in a content script whose extension was reloaded or removed. */
    id?: string
    sendMessage(message: unknown): Promise<unknown>
    connect(info: { name: string }): WebExtPort
    onConnect: WebExtEvent<(port: WebExtPort) => void>
    onMessage: WebExtEvent<
      (
        message: unknown,
        sender: WebExtSender,
        sendResponse: (response: unknown) => void
      ) => boolean | void
    >
    onStartup?: WebExtEvent<() => void>
    onInstalled?: WebExtEvent<() => void>
  }
  tabs: {
    sendMessage(tabId: number, message: unknown): Promise<unknown>
    query(filter: { url: string }): Promise<{ id?: number }[]>
    onRemoved: WebExtEvent<(tabId: number) => void>
  }
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>
      set(items: Record<string, unknown>): Promise<void>
      remove(key: string): Promise<void>
    }
  }
}

declare const chrome: WebExtApi
declare const browser: WebExtApi | undefined
