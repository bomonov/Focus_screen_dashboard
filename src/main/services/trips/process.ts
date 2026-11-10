import { utilityProcess } from 'electron'
import type { PlannerProcess } from './client'
import type { PlanRequest } from './messages'

/**
 * The trip search started as an Electron utility process, its own memory given back on exit.
 * It's handed the timetable file to read as its one argument.
 */
export function forkPlanner(modulePath: string, timetablePath: string): PlannerProcess {
  const child = utilityProcess.fork(modulePath, [timetablePath], {
    serviceName: 'Focus Screen trips'
  })
  // Held until it's running, so the first trip isn't asked before it can hear it.
  let waiting: PlanRequest[] | null = []
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
    console.warn('[trips] The trip search stopped:', type, location)
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
