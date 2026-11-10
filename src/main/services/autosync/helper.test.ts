import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runHelperProcess = vi.fn()
vi.mock('../helperProcess', () => ({
  runHelperProcess: (options: unknown) => runHelperProcess(options)
}))

const { alignerWorker } = await import('./helper')

describe('alignerWorker', () => {
  let root: string
  let runtime: string
  let script: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'focus-aligner-'))
    runtime = join(root, 'runtime')
    script = join(root, 'aligner.py')
    mkdirSync(join(runtime, '.venv/bin'), { recursive: true })
    mkdirSync(join(runtime, 'models'), { recursive: true })
    writeFileSync(join(runtime, '.venv/bin/python'), '')
    writeFileSync(join(runtime, 'models/large-v3-turbo.pt'), '')
    writeFileSync(script, '')
    runHelperProcess.mockClear()
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('runs isolated and never writes bytecode next to the script (the signed app bundle)', () => {
    const start = alignerWorker(script, runtime)
    expect(start).not.toBeNull()
    start?.({ onMessage: () => {}, onExit: () => {} })
    expect(runHelperProcess).toHaveBeenCalledOnce()
    const options = runHelperProcess.mock.calls[0]?.[0] as { command: string; args: string[] }
    expect(options.command).toBe(join(runtime, '.venv/bin/python'))
    expect(options.args).toEqual(['-I', '-B', script])
  })

  it('is unavailable until the runtime is installed', () => {
    rmSync(join(runtime, 'models/large-v3-turbo.pt'))
    expect(alignerWorker(script, runtime)).toBeNull()
  })
})
