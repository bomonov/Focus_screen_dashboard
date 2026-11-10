import { describe, expect, it } from 'vitest'
import { zipOf } from './testFixtures'
import { readZipDirectory, zipEntryChunks, ZipError } from './zip'

async function text(chunks: AsyncIterable<Uint8Array>): Promise<string> {
  const parts: Uint8Array[] = []
  for await (const chunk of chunks) parts.push(chunk)
  return Buffer.concat(parts).toString('utf8')
}

describe('zip reading', () => {
  const zip = zipOf(
    { 'routes.txt': 'route_id\nVENU\n'.repeat(50), 'agency.txt': 'agency_id\n1\n' },
    ['agency.txt']
  )

  it('lists the files and reads deflated and stored ones', async () => {
    const entries = readZipDirectory(zip)
    expect([...entries.keys()]).toEqual(['routes.txt', 'agency.txt'])
    const routes = entries.get('routes.txt')
    const agency = entries.get('agency.txt')
    if (!routes || !agency) throw new Error('missing')
    expect(routes.method).toBe(8)
    expect(await text(zipEntryChunks(zip, routes, 10_000))).toBe('route_id\nVENU\n'.repeat(50))
    expect(await text(zipEntryChunks(zip, agency, 10_000))).toBe('agency_id\n1\n')
  })

  it('stops reading a file bigger than allowed', async () => {
    const routes = readZipDirectory(zip).get('routes.txt')
    if (!routes) throw new Error('missing')
    await expect(text(zipEntryChunks(zip, routes, 100))).rejects.toThrow(ZipError)
  })

  it('refuses what isn’t a zip, or one cut short', () => {
    expect(() => readZipDirectory(new TextEncoder().encode('not a zip at all, no'))).toThrow(
      ZipError
    )
    const cut = zip.slice(0, zip.length - 30)
    expect(() => readZipDirectory(cut)).toThrow(ZipError)
  })
})
