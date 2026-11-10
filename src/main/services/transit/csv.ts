// GTFS's CSV files (RFC 4180: quoted fields, "" for a quote, CRLF or LF), read as they stream
// out of the zip. Lines without quotes, nearly all of them, take a fast path.

/** One line's fields, with quotes undone. A field may hold commas, quotes and line breaks. */
export function splitCsvLine(line: string): string[] {
  if (!line.includes('"')) return line.split(',')
  const fields: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (quoted) {
      if (char !== '"') field += char
      else if (line[i + 1] === '"') {
        field += '"'
        i++
      } else quoted = false
    } else if (char === '"') quoted = true
    else if (char === ',') {
      fields.push(field)
      field = ''
    } else field += char
  }
  fields.push(field)
  return fields
}

/** An odd number of quotes so far: the line break is inside a quoted field. */
function opensQuote(line: string): boolean {
  let count = 0
  for (let i = line.indexOf('"'); i !== -1; i = line.indexOf('"', i + 1)) count++
  return count % 2 === 1
}

/** One value per asked-for column, in the same order. */
export type CsvValues<C extends readonly string[]> = { -readonly [K in keyof C]: string }

/**
 * Calls `onRow` with each row's values for `columns` (by the header's names, "" for a column
 * the file hasn't got). Values are trimmed: Valley Metro pads some numbers with spaces.
 */
export async function eachCsvRow<const C extends readonly string[]>(
  chunks: AsyncIterable<Uint8Array>,
  columns: C,
  onRow: (values: CsvValues<C>) => void
): Promise<void> {
  const decoder = new TextDecoder()
  let indexes: number[] | null = null
  let carry = ''
  const line = (raw: string): void => {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (indexes === null) {
      const header = splitCsvLine(text.replace(/^\uFEFF/, '')).map((name) => name.trim())
      indexes = columns.map((column) => header.indexOf(column))
      return
    }
    if (text === '') return
    const fields = splitCsvLine(text)
    // One value per column, as many as `columns` has: the tuple type says just that.
    onRow(indexes.map((index) => (fields[index] ?? '').trim()) as CsvValues<C>)
  }
  const take = (text: string): void => {
    let start = 0
    for (let end = text.indexOf('\n'); end !== -1; end = text.indexOf('\n', end + 1)) {
      const candidate = carry + text.slice(start, end)
      if (opensQuote(candidate)) {
        carry = `${candidate}\n`
      } else {
        carry = ''
        line(candidate)
      }
      start = end + 1
    }
    carry += text.slice(start)
  }
  for await (const chunk of chunks) take(decoder.decode(chunk, { stream: true }))
  take(decoder.decode())
  if (carry !== '') line(carry)
}
