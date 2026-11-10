import { describe, expect, it } from 'vitest'
import { eachCsvRow, splitCsvLine } from './csv'

async function* chunked(text: string, size: number): AsyncGenerator<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size)
}

async function rows(text: string, columns: readonly string[], size = 7): Promise<string[][]> {
  const found: string[][] = []
  await eachCsvRow(chunked(text, size), columns, (values) => found.push([...values]))
  return found
}

describe('splitCsvLine', () => {
  it('splits plain and quoted fields', () => {
    expect(splitCsvLine('10,19042,Old 27th Av')).toEqual(['10', '19042', 'Old 27th Av'])
    expect(splitCsvLine('10,"Mill Ave, north","say ""hi""",')).toEqual([
      '10',
      'Mill Ave, north',
      'say "hi"',
      ''
    ])
  })
})

describe('eachCsvRow', () => {
  it('picks columns by the header’s names, whatever their order', async () => {
    const text =
      '\uFEFFstop_id,stop_code,stop_name\r\n10,19042,"Old 27th Av & Baseline PNR"\r\n100,16619,Bell Rd\r\n'
    expect(await rows(text, ['stop_name', 'stop_id', 'zone_id'])).toEqual([
      ['Old 27th Av & Baseline PNR', '10', ''],
      ['Bell Rd', '100', '']
    ])
  })

  it('trims padded values and skips blank lines', async () => {
    const text = 'stop_id,stop_lat\n10,  33.377274\n\n11,33.5'
    expect(await rows(text, ['stop_id', 'stop_lat'])).toEqual([
      ['10', '33.377274'],
      ['11', '33.5']
    ])
  })

  it('keeps a line break inside quotes, split across chunks or not', async () => {
    const text = 'id,note\n1,"two\nlines"\n2,"é, ü"\n'
    for (const size of [1, 3, 64]) {
      expect(await rows(text, ['id', 'note'], size)).toEqual([
        ['1', 'two\nlines'],
        ['2', 'é, ü']
      ])
    }
  })
})
