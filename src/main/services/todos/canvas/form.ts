import type { CanvasFormRequest, CanvasFormResult } from '../types'
import type { CanvasProvider } from './provider'
import { calendarPageUrl, parseCanvasAddress, tokenPageUrl } from './site'

/** Answers the card's Canvas form. `openPage` opens a Canvas page in the web browser. */
export async function handleCanvasForm(
  canvas: CanvasProvider,
  request: CanvasFormRequest,
  openPage: (url: string) => Promise<void>
): Promise<CanvasFormResult> {
  switch (request.kind) {
    case 'connectToken':
      return canvas.connectToken(request.address, request.token)
    case 'connectFeed':
      return canvas.connectFeed(request.url)
    case 'openPage': {
      const site = parseCanvasAddress(request.address)
      if (!site.ok) {
        return {
          ok: false,
          message: 'Type your Canvas address first, so this opens your school’s Canvas.',
          field: 'address'
        }
      }
      try {
        await openPage(
          request.page === 'token' ? tokenPageUrl(site.origin) : calendarPageUrl(site.origin)
        )
        return { ok: true }
      } catch {
        return { ok: false, message: 'Couldn’t open your web browser.', field: null }
      }
    }
  }
}
