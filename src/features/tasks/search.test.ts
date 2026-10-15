import { describe, expect, it } from 'vitest'
import { buildSearchFilter, normalizeQuery, phoneNeedle } from './search'

interface Clause {
  column: string
  operator: string
  value: string
}

/**
 * Reads a filter the way PostgREST reads the value of `or=(...)`: clauses are separated by commas,
 * except inside double quotes, where a backslash can only escape a backslash or a double quote.
 */
function parseOrFilter(filter: string): Clause[] {
  const clauses: Clause[] = []
  let i = 0
  while (i < filter.length) {
    const columnEnd = filter.indexOf('.', i)
    const operatorEnd = filter.indexOf('.', columnEnd + 1)
    const column = filter.slice(i, columnEnd)
    const operator = filter.slice(columnEnd + 1, operatorEnd)
    i = operatorEnd + 1
    let value = ''
    if (filter[i] === '"') {
      i++
      while (filter[i] !== '"') {
        if (filter[i] === '\\') {
          expect(['\\', '"']).toContain(filter[i + 1])
          i++
        }
        value += filter[i++]
      }
      i++
    } else {
      while (i < filter.length && filter[i] !== ',') value += filter[i++]
    }
    clauses.push({ column, operator, value })
    if (i < filter.length) {
      expect(filter[i]).toBe(',')
      i++
    }
  }
  return clauses
}

const TEXT_COLUMNS = [
  'title',
  'customer_name',
  'order_number',
  'service_call_number',
  'glassix_conversation_id',
  'cargo_number',
  'product_sku',
]

describe('buildSearchFilter', () => {
  it('gives no filter for an empty query or one of spaces', () => {
    expect(buildSearchFilter('')).toBeNull()
    expect(buildSearchFilter('   ')).toBeNull()
    expect(buildSearchFilter('\u200f \u200e')).toBeNull()
  })

  it('looks for the text in the title, the customer, the order, the service call, Glassix, Cargo and the SKU', () => {
    const clauses = parseOrFilter(buildSearchFilter('דנה')!)
    expect(clauses.map((c) => c.column)).toEqual(TEXT_COLUMNS)
    for (const clause of clauses) {
      expect(clause.operator).toBe('ilike')
      expect(clause.value).toBe('*דנה*')
    }
  })

  it('also looks in the phone digits when the text is a phone number', () => {
    const clauses = parseOrFilter(buildSearchFilter('050-123 4567')!)
    expect(clauses.map((c) => c.column)).toEqual([
      'title',
      'customer_name',
      'customer_phone_digits',
      'order_number',
      'service_call_number',
      'glassix_conversation_id',
      'cargo_number',
      'product_sku',
    ])
    const phone = clauses.find((c) => c.column === 'customer_phone_digits')
    expect(phone).toEqual({ column: 'customer_phone_digits', operator: 'ilike', value: '*501234567*' })
    expect(clauses.find((c) => c.column === 'title')?.value).toBe('*050-123 4567*')
  })

  it('finds the same customer however the number is written', () => {
    for (const written of ['050-123 4567', '+972 50 123 4567', '0501234567', '(050) 123-4567', '\u200e+972-50-123-4567']) {
      const phone = parseOrFilter(buildSearchFilter(written)!).find((c) => c.column === 'customer_phone_digits')
      expect(phone?.value, written).toBe('*501234567*')
    }
  })

  it('matches a number stored with the country code and one stored with the leading zero alike', () => {
    // The clause is a substring of the digits, and 501234567 is inside both spellings.
    const needle = '501234567'
    expect('0501234567'.includes(needle)).toBe(true)
    expect('972501234567'.includes(needle)).toBe(true)
  })

  it('uses the digits as typed when they are not a whole Israeli number', () => {
    const phone = (query: string) =>
      parseOrFilter(buildSearchFilter(query)!).find((c) => c.column === 'customer_phone_digits')?.value
    expect(phone('050-123')).toBe('*050123*')
    expect(phone('1234')).toBe('*1234*')
    expect(phone('+1 212 555 0100')).toBe('*12125550100*')
  })

  it('leaves the phone digits out for text with letters and for very short numbers', () => {
    const columns = (query: string) => parseOrFilter(buildSearchFilter(query)!).map((c) => c.column)
    expect(columns('SKU-12345')).not.toContain('customer_phone_digits')
    expect(columns('דנה 050')).not.toContain('customer_phone_digits')
    expect(columns('50')).not.toContain('customer_phone_digits')
  })

  it('quotes the text, so a comma, a parenthesis or a colon stays inside one value', () => {
    for (const text of ['כהן, דנה', 'a(b)c', 'x:y', 'a.b', 'one,two,three']) {
      const clauses = parseOrFilter(buildSearchFilter(text)!)
      expect(clauses.map((c) => c.column)).toEqual(TEXT_COLUMNS)
      for (const clause of clauses) expect(clause.value, text).toBe(`*${text}*`)
    }
  })

  it('escapes a double quote and a backslash for the quoting', () => {
    const quote = parseOrFilter(buildSearchFilter('say "hi"')!)
    expect(quote.every((c) => c.value === '*say "hi"*')).toBe(true)
    // A backslash is a backslash for LIKE too, so it is doubled once for LIKE and once for the quotes.
    const raw = buildSearchFilter('a\\b')!
    expect(raw).toContain('title.ilike."*a\\\\\\\\b*"')
    const clauses = parseOrFilter(raw)
    expect(clauses.every((c) => c.value === '*a\\\\b*')).toBe(true)
  })

  it('does not let a percent sign or an underscore act as a wildcard', () => {
    // After PostgREST has read the quotes, LIKE sees \% and \_, which stand for the characters themselves.
    const percent = parseOrFilter(buildSearchFilter('%')!)
    expect(percent.every((c) => c.value === '*\\%*')).toBe(true)
    const mixed = parseOrFilter(buildSearchFilter('100%_off')!)
    expect(mixed.every((c) => c.value === '*100\\%\\_off*')).toBe(true)
  })

  it('trims the text, folds runs of spaces, and drops invisible direction marks', () => {
    const title = (query: string) => parseOrFilter(buildSearchFilter(query)!)[0].value
    expect(title('  דנה   כהן  ')).toBe('*דנה כהן*')
    expect(title('\u200fדנה\u200e')).toBe('*דנה*')
  })

  it('cuts a very long query short', () => {
    const title = parseOrFilter(buildSearchFilter('א'.repeat(500))!)[0].value
    expect(title).toBe(`*${'א'.repeat(100)}*`)
  })
})

describe('normalizeQuery and phoneNeedle', () => {
  it('clean the text the same way for the server and for the list on the screen', () => {
    expect(normalizeQuery('  a \u200f  b ')).toBe('a b')
    expect(phoneNeedle('050-123 4567')).toBe('501234567')
    expect(phoneNeedle('דנה')).toBeNull()
    expect(phoneNeedle('')).toBeNull()
  })
})
