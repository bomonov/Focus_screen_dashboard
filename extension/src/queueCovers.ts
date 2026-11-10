// Runs in YouTube Music's own world (the manifest's "world": "MAIN"), where the page keeps each
// queue row's data. content.ts can't see that data: it runs apart from the page's scripts and
// shares only the markup, where a row's picture stays a placeholder until the row has been on
// screen. Asked about a row, this writes the row's cover sizes onto it and does nothing else;
// content.ts reads them at once and treats them as untrusted, like everything from the page.
import { QUEUE_COVER_ATTRIBUTE, QUEUE_COVER_REQUEST } from './page'

interface QueueRow extends HTMLElement {
  data?: { thumbnail?: { thumbnails?: unknown } }
}

document.addEventListener(
  QUEUE_COVER_REQUEST,
  (event) => {
    const row = event.target
    if (!(row instanceof HTMLElement) || row.localName !== 'ytmusic-player-queue-item') return
    const sizes = (row as QueueRow).data?.thumbnail?.thumbnails
    if (Array.isArray(sizes)) row.setAttribute(QUEUE_COVER_ATTRIBUTE, JSON.stringify(sizes))
  },
  true
)
