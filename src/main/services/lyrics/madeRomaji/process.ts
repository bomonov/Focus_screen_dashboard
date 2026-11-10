import { utilityProcess } from 'electron'
import type { MakerProcess } from './client'
import type { MakerRequest } from './messages'

/** The romaji maker started as an Electron utility process: its own memory, given back on exit. */
export function forkMaker(modulePath: string): MakerProcess {
  const child = utilityProcess.fork(modulePath, [], { serviceName: 'Focus Screen romaji' })
  // Held until it's running, so the first song's lines aren't sent before it can hear them.
  let waiting: MakerRequest[] | null = []
  // kill() does nothing before it's running, so a stop asked for by then waits for it.
  let stopped = false
  child.once('spawn', () => {
    if (stopped) {
      child.kill()
      return
    }
    for (const message of waiting ?? []) child.postMessage(message)
    waiting = null
  })
  // A fatal error in it (out of memory, say): 'exit' follows. Unheard, it would throw in the app.
  child.on('error', (type, location) => {
    console.warn('[lyrics] The romaji maker stopped:', type, location)
  })
  return {
    postMessage(message) {
      if (waiting) waiting.push(message)
      else child.postMessage(message)
    },
    onMessage: (listener) => {
      child.on('message', listener)
    },
    onExit: (listener) => {
      child.once('exit', () => listener())
    },
    kill: () => {
      stopped = true
      waiting = null
      child.kill()
    }
  }
}
