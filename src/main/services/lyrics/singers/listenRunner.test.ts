import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlignerClient, AlignResult } from '../../autosync/aligner'
import type { AlignLanguage } from '../../autosync/lines'
import { createListenRunner, type ListenAsk } from './listenRunner'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'focus-screen-listen-'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

type Align = (
  wavPath: string,
  lines: string[],
  language: AlignLanguage | null
) => Promise<AlignResult>

/**
 * An aligner whose answers the test gives, counting how often it's made and stopped. Stopped, it
 * answers what's still out with a failure, as the real client does.
 */
function fakeAligner(align: Align): {
  factory: () => AlignerClient
  made: number
  disposed: number
  align: ReturnType<typeof vi.fn<Align>>
} {
  const out = new Set<(result: AlignResult) => void>()
  const fake = {
    made: 0,
    disposed: 0,
    align: vi.fn<Align>(
      (...args) =>
        new Promise<AlignResult>((resolve, reject) => {
          out.add(resolve)
          align(...args)
            .then(resolve, reject)
            .finally(() => out.delete(resolve))
        })
    ),
    factory: (): AlignerClient => {
      fake.made += 1
      return {
        prepare: vi.fn(),
        align: fake.align,
        dispose() {
          fake.disposed += 1
          for (const settle of out) settle({ ok: false, error: 'Stopped.' })
          out.clear()
        }
      }
    }
  }
  return fake
}

/** Two seconds of 16 kHz audio starting at `clipStart`. */
function ask(over: Partial<ListenAsk> = {}): ListenAsk {
  return {
    texts: ['夜空に浮かぶ 小さな灯り(あかり)'],
    samples: new Int16Array(32_000).fill(100),
    clipStart: 0,
    language: 'ja',
    ...over
  }
}

describe('createListenRunner', () => {
  it('writes the stretch as a WAV, asks with the sung words, and deletes the WAV after the reply', async () => {
    let seen: { path: string; exists: boolean; size: number; rate: number } | null = null
    const aligner = fakeAligner(async (wavPath) => {
      const file = readFileSync(wavPath)
      seen = {
        path: wavPath,
        exists: existsSync(wavPath),
        size: file.length,
        rate: file.readUInt32LE(24)
      }
      return { ok: true, lines: [{ start: 0.2, end: 1.8 }] }
    })
    const runner = createListenRunner({ aligner: aligner.factory, tempDir: dir })
    const samples = new Int16Array(32_000).fill(100)

    const answer = await runner.run(ask({ samples }))

    expect(aligner.align).toHaveBeenCalledTimes(1)
    const [wavPath, lines, language] = aligner.align.mock.calls[0] ?? []
    expect(lines).toEqual(['夜空に浮かぶ 小さな灯り'])
    expect(language).toBe('ja')
    expect(dirname(wavPath ?? '')).toBe(dir)
    expect(wavPath).toMatch(/\.wav$/)
    expect(seen).toEqual({
      path: wavPath,
      exists: true,
      size: 44 + 2 * samples.length,
      rate: 16_000
    })
    expect(answer).toEqual([{ start: 0.2, end: 1.8 }])
    expect(readdirSync(dir)).toEqual([])
  })

  it('deletes the WAV when the aligner fails, and answers null', async () => {
    const refused = fakeAligner(async () => ({ ok: false, error: 'bad audio' }))
    const refusing = createListenRunner({ aligner: refused.factory, tempDir: dir })
    expect(await refusing.run(ask())).toBeNull()
    expect(refused.align).toHaveBeenCalledTimes(1)
    expect(readdirSync(dir)).toEqual([])

    const broken = fakeAligner(async () => {
      throw new Error('The aligner stopped.')
    })
    const breaking = createListenRunner({ aligner: broken.factory, tempDir: dir })
    expect(await breaking.run(ask())).toBeNull()
    expect(broken.align).toHaveBeenCalledTimes(1)
    expect(readdirSync(dir)).toEqual([])
  })

  it("puts the answer on the song's clock", async () => {
    const aligner = fakeAligner(async () => ({
      ok: true,
      lines: [
        {
          start: 0.6,
          end: 4.1,
          words: [
            { text: '夜空に', start: 0.6, end: 1.4 },
            { text: '浮かぶ', start: 1.4, end: 4.1 }
          ]
        },
        null
      ]
    }))
    const runner = createListenRunner({ aligner: aligner.factory, tempDir: dir })

    const answer = await runner.run(
      ask({
        texts: ['夜空に浮かぶ', '小さな灯り'],
        samples: new Int16Array(16 * 16_000),
        clipStart: 83.5
      })
    )

    expect(answer).toHaveLength(2)
    const [line, unplaced] = answer ?? []
    expect(unplaced).toBeNull()
    expect(line?.start).toBeCloseTo(84.1)
    expect(line?.end).toBeCloseTo(87.6)
    expect(line?.words?.map((word) => word.text)).toEqual(['夜空に', '浮かぶ'])
    expect(line?.words?.[0]?.start).toBeCloseTo(84.1)
    expect(line?.words?.[0]?.end).toBeCloseTo(84.9)
    expect(line?.words?.[1]?.start).toBeCloseTo(84.9)
    expect(line?.words?.[1]?.end).toBeCloseTo(87.6)
  })

  it('leaves out a span outside the stretch', async () => {
    // A two-second clip: one line inside it, one past its end, one before its start, and one
    // whose words run past it (the line keeps its span, its words are dropped).
    const aligner = fakeAligner(async () => ({
      ok: true,
      lines: [
        { start: 0.5, end: 1.5 },
        { start: 5, end: 6 },
        { start: -1, end: 0.4 },
        {
          start: 0.2,
          end: 1.9,
          words: [
            { text: 'a', start: 0.2, end: 1 },
            { text: 'b', start: 1, end: 9 }
          ]
        }
      ]
    }))
    const runner = createListenRunner({ aligner: aligner.factory, tempDir: dir })

    const answer = await runner.run(ask({ texts: ['a', 'b', 'c', 'a b'], clipStart: 10 }))

    expect(answer).toEqual([{ start: 10.5, end: 11.5 }, null, null, { start: 10.2, end: 11.9 }])
  })

  it('clears WAVs left behind when it starts', () => {
    writeFileSync(join(dir, 'left-behind.wav'), 'RIFF')
    writeFileSync(join(dir, 'notes.txt'), 'not ours')

    createListenRunner({
      aligner: fakeAligner(async () => ({ ok: true, lines: [] })).factory,
      tempDir: dir
    })

    expect(readdirSync(dir)).toEqual(['notes.txt'])
    // A temp folder that isn't there yet is nothing to clear.
    expect(() => createListenRunner({ aligner: null, tempDir: join(dir, 'missing') })).not.toThrow()
  })

  it('without the add-on it writes nothing and answers null', async () => {
    const runner = createListenRunner({ aligner: null, tempDir: dir })

    expect(runner.installed).toBe(false)
    expect(await runner.run(ask())).toBeNull()
    expect(readdirSync(dir)).toEqual([])
    expect(
      createListenRunner({
        aligner: fakeAligner(async () => ({ ok: true, lines: [] })).factory,
        tempDir: dir
      }).installed
    ).toBe(true)
  })

  it('busy while a run is out', async () => {
    let reply: (result: AlignResult) => void = () => {}
    const aligner = fakeAligner(
      () =>
        new Promise<AlignResult>((resolve) => {
          reply = resolve
        })
    )
    const runner = createListenRunner({ aligner: aligner.factory, tempDir: dir })
    expect(runner.busy()).toBe(false)

    const running = runner.run(ask())
    expect(runner.busy()).toBe(true)
    reply({ ok: true, lines: [{ start: 0.5, end: 1.5 }] })
    await running

    expect(runner.busy()).toBe(false)
  })

  it('stops its aligner when disposed', async () => {
    const aligner = fakeAligner(async () => ({ ok: true, lines: [{ start: 0.5, end: 1.5 }] }))
    const runner = createListenRunner({ aligner: aligner.factory, tempDir: dir })
    // Nothing is started before the first run.
    expect(aligner.made).toBe(0)

    await runner.run(ask())
    await runner.run(ask())
    expect(aligner.made).toBe(1)
    writeFileSync(join(dir, 'stray.wav'), 'RIFF')

    runner.dispose()

    expect(aligner.disposed).toBe(1)
    expect(readdirSync(dir)).toEqual([])
    // Disposed, it starts no new worker.
    expect(await runner.run(ask())).toBeNull()
    expect(aligner.made).toBe(1)
    expect(readdirSync(dir)).toEqual([])
  })

  it('stopped mid-run, answers null quietly and leaves no WAV', async () => {
    const aligner = fakeAligner(() => new Promise<AlignResult>(() => {}))
    const runner = createListenRunner({ aligner: aligner.factory, tempDir: dir })

    const running = runner.run(ask())
    expect(readdirSync(dir)).toHaveLength(1)
    runner.dispose()

    expect(await running).toBeNull()
    expect(readdirSync(dir)).toEqual([])
    expect(runner.busy()).toBe(false)
    // Closing the window isn't a failure.
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('never rejects: a failed write or a worker that won’t start answers null', async () => {
    // The temp folder sits under a file, so neither writing the WAV nor deleting it can work.
    writeFileSync(join(dir, 'blocker'), '')
    const aligner = fakeAligner(async () => ({ ok: true, lines: [{ start: 0.5, end: 1.5 }] }))
    const blocked = createListenRunner({
      aligner: aligner.factory,
      tempDir: join(dir, 'blocker', 'listen')
    })
    await expect(blocked.run(ask())).resolves.toBeNull()
    expect(aligner.align).not.toHaveBeenCalled()
    expect(blocked.busy()).toBe(false)
    expect(readdirSync(dir)).toEqual(['blocker'])

    const unstartable = createListenRunner({
      aligner: () => {
        throw new Error('No Python.')
      },
      tempDir: dir
    })
    await expect(unstartable.run(ask())).resolves.toBeNull()
    expect(unstartable.busy()).toBe(false)
    expect(readdirSync(dir)).toEqual(['blocker'])
  })

  it('logs fixed words only, never the aligner’s text or the WAV’s path', async () => {
    // Python's exception text can quote the lyrics, and the path is no one's business.
    const refused = fakeAligner(async () => ({ ok: false, error: 'No match for 夜空に浮かぶ' }))
    await createListenRunner({ aligner: refused.factory, tempDir: dir }).run(ask())
    const broken = fakeAligner(async (wavPath) => {
      throw new Error(`Couldn't read ${wavPath} for 夜空に浮かぶ`)
    })
    await createListenRunner({ aligner: broken.factory, tempDir: dir }).run(ask())

    const logged = vi.mocked(console.warn).mock.calls.map((call) => call.map(String).join(' '))
    expect(logged).toHaveLength(2)
    for (const line of logged) {
      expect(line).not.toContain('夜空')
      expect(line).not.toContain(dir)
    }
  })
})
