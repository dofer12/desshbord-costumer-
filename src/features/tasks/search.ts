const MAX_QUERY_LENGTH = 100

// Direction marks and zero-width characters travel with text copied from chats and web pages.
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g

/** The text of a search box as the search uses it: no invisible marks, single spaces, trimmed, short. */
export function normalizeQuery(query: string): string {
  return query.replace(INVISIBLE, '').replace(/\s+/g, ' ').slice(0, MAX_QUERY_LENGTH).trim()
}

/**
 * The digits to look for in the phone numbers, when the text is a phone number: only digits and the
 * punctuation of phone numbers, and at least three digits. The leading 0 or 972 of an Israeli number
 * is dropped, so that "050-123 4567", "+972 50 123 4567" and "0501234567" all find a customer whose
 * number was saved in any of those ways.
 */
export function phoneNeedle(query: string): string | null {
  const text = normalizeQuery(query)
  if (!/^[\d\s()+.-]+$/.test(text)) return null
  const digits = text.replace(/\D/g, '')
  if (digits.length < 3) return null
  if (/^972\d{8,9}$/.test(digits)) return digits.slice(3)
  if (/^0\d{8,9}$/.test(digits)) return digits.slice(1)
  return digits
}

/** `*text*` as a LIKE pattern in which the characters of the text mean themselves, then quoted for PostgREST. */
function containsPattern(text: string): string {
  // In LIKE, % and _ are wildcards and \ escapes them. PostgREST writes % as *.
  const pattern = `*${text.replace(/[\\%_]/g, '\\$&')}*`
  // Inside the double quotes of a PostgREST value only \ and " need a backslash.
  return `"${pattern.replace(/[\\"]/g, '\\$&')}"`
}

function clause(column: string, text: string): string {
  return `${column}.ilike.${containsPattern(text)}`
}

/**
 * The value for `.or(...)` that finds the tasks containing the text in their title, customer name,
 * phone digits, order number, service call number, Glassix id, Cargo number or SKU. Every value is
 * quoted, so that a comma, a parenthesis or a quote in the text cannot break the filter, and the %
 * and _ of the text are not wildcards. Null when there is nothing to look for.
 */
export function buildSearchFilter(query: string): string | null {
  const text = normalizeQuery(query)
  if (!text) return null
  const digits = phoneNeedle(text)
  return [
    clause('title', text),
    clause('customer_name', text),
    ...(digits ? [clause('customer_phone_digits', digits)] : []),
    clause('order_number', text),
    clause('service_call_number', text),
    clause('glassix_conversation_id', text),
    clause('cargo_number', text),
    clause('product_sku', text),
  ].join(',')
}
