import { describe, expect, it } from 'vitest'
import { createLineSplitter, restartDelayMs, runHelperProcess } from './helperProcess'

describe('createLineSplitter', () => {
  it('rebuilds lines split across chunks and skips blank ones', () => {
    const lines: string[] = []
    const split = createLineSplitter((line) => lines.push(line))
    split('{"a":1}\n{"b"')
    split(':2}\r\n\n')
    split('{"c":3}')
    expect(lines).toEqual(['{"a":1}', '{"b":2}'])
    split('\n')
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}'])
  })

  it('drops a runaway line and recovers on the next one', () => {
    const lines: string[] = []
    const split = createLineSplitter((line) => lines.push(line))
    split('x'.repeat(1_000_001))
    split('more of the same\n{"ok":true}\n')
    expect(lines).toEqual(['{"ok":true}'])
  })
})

describe('restartDelayMs', () => {
  it('backs off from 1 s to at most 30 s', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(restartDelayMs)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000
    ])
  })
})

describe('runHelperProcess', () => {
  it('passes JSON lines on and ignores everything else', async () => {
    const messages: unknown[] = []
    const script = [
      'console.log(JSON.stringify({ n: 1 }))',
      'console.log("not json")',
      'console.log(JSON.stringify({ n: 2 }))',
      'setTimeout(() => {}, 10000)'
    ].join(';')
    const helper = runHelperProcess({
      label: 'test',
      command: process.execPath,
      args: ['-e', script],
      onMessage: (message) => messages.push(message)
    })
    await expect.poll(() => messages.length).toBe(2)
    helper.stop()
    expect(messages).toEqual([{ n: 1 }, { n: 2 }])
  })

  it('sends JSON lines to a helper that takes input', async () => {
    const messages: unknown[] = []
    // Echoes each line back with a reply marker.
    const script = [
      "const rl = require('readline').createInterface({ input: process.stdin })",
      "rl.on('line', (line) => console.log(JSON.stringify({ echo: JSON.parse(line) })))"
    ].join(';')
    const helper = runHelperProcess({
      label: 'test',
      command: process.execPath,
      args: ['-e', script],
      input: true,
      onMessage: (message) => messages.push(message)
    })
    expect(helper.send({ id: 1, op: 'list' })).toBe(true)
    await expect.poll(() => messages).toEqual([{ echo: { id: 1, op: 'list' } }])
    helper.stop()
    expect(helper.send({ id: 2 })).toBe(false)
  })

  it('has nothing to send to without input', () => {
    const helper = runHelperProcess({
      label: 'test',
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 10000)'],
      onMessage: () => {}
    })
    expect(helper.send({ id: 1 })).toBe(false)
    helper.stop()
  })
})
