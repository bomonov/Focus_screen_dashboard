/** `<https://…?page=2>; rel="next", <…>; rel="last"` → the next page's URL, or null. */
export function nextLink(header: string | null): string | null {
  if (!header) return null
  for (const part of header.split(',')) {
    const match = /^\s*<([^>]+)>\s*;(.*)$/.exec(part)
    if (match && /(?:^|;)\s*rel="?next"?\s*(?:;|$)/i.test(match[2] ?? '')) return match[1] ?? null
  }
  return null
}
