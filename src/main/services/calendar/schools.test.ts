import { describe, expect, it } from 'vitest'
import { ASU, isAsu, loadCatalog, parseCatalog, schoolForEmails, searchSchools } from './schools'

describe('the school list', () => {
  it('reads the bundled list, every row checked', async () => {
    const catalog = await loadCatalog()
    expect(catalog.length).toBeGreaterThan(9000)
    expect(catalog).toContainEqual({ ...ASU, domains: ['asu.edu'] })
    expect(
      parseCatalog({ schools: [['', 'US', []], ['X', 'usa', []], 'junk', ['Y', 'US']] })
    ).toEqual([{ name: 'Y', country: 'US', domains: [] }])
  })

  it('finds a school by the start of its words, its initials or its email name', async () => {
    const catalog = await loadCatalog()
    expect(searchSchools(catalog, 'arizona state')[0]).toEqual(ASU)
    expect(searchSchools(catalog, 'asu').map((school) => school.name)).toContain(ASU.name)
    expect(searchSchools(catalog, 'purdue')[0]?.name).toBe('Purdue University')
    expect(searchSchools(catalog, '   ')).toEqual([])
    expect(searchSchools(catalog, 'univ', 5)).toHaveLength(5)
  })

  it('suggests the school an email address belongs to, departments too', async () => {
    const catalog = await loadCatalog()
    expect(schoolForEmails(catalog, ['someone@asu.edu'])).toEqual(ASU)
    expect(schoolForEmails(catalog, ['x@engineering.asu.edu', 'me@gmail.com'])).toEqual(ASU)
    expect(schoolForEmails(catalog, ['me@gmail.com'])).toBeNull()
    // Two schools: no telling which.
    expect(schoolForEmails(catalog, ['a@asu.edu', 'b@purdue.edu'])).toBeNull()
  })

  it('knows ASU, which has a list of its own', () => {
    expect(isAsu(ASU)).toBe(true)
    expect(isAsu({ name: 'Arizona State University', country: 'CA' })).toBe(false)
  })
})
