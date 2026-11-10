import { describe, expect, it } from 'vitest'
import { nextLink } from './linkHeader'

describe('nextLink', () => {
  it('finds the next page among Canvas’s links', () => {
    const header =
      '<https://canvas.example.edu/api/v1/courses?page=1&per_page=100>; rel="current",' +
      '<https://canvas.example.edu/api/v1/courses?page=2&per_page=100>; rel="next",' +
      '<https://canvas.example.edu/api/v1/courses?page=1&per_page=100>; rel="first"'
    expect(nextLink(header)).toBe('https://canvas.example.edu/api/v1/courses?page=2&per_page=100')
  })

  it('is null on the last page or without a header', () => {
    expect(nextLink('<https://a.example/x?page=1>; rel="first"')).toBeNull()
    expect(nextLink(null)).toBeNull()
    expect(nextLink('')).toBeNull()
  })

  it('doesn’t mistake rel="nextish" for next', () => {
    expect(nextLink('<https://a.example/x>; rel="nextish"')).toBeNull()
  })
})
