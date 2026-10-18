import type { TaskPatch } from '../tasks/model'
import { readMoment, type ImportContext, type ImportItem, type ImportProblem } from './legacyFormat'
import { matchPerson, matchStatus } from './matching'

// The file of orders: what the order system (or a spreadsheet of orders) exports, with Hebrew or English
// headers, one order a row. Each new order becomes an open task, with no conversation in Glassix, at the
// time of treatment that the file gives, if it gives one.

export type OrderField =
  | 'shipStatus'
  | 'shipMethod'
  | 'due'
  | 'title'
  | 'order'
  | 'handler'
  | 'phone'
  | 'billing'
  | 'shipTo'
  | 'status'
  | 'name'
  | 'orderDate'

/** The names that a header may have for each field. Their order matters: the first field that finds a column keeps it. */
const HEADER_MAP: ReadonlyArray<readonly [OrderField, readonly string[]]> = [
  ['shipStatus', ['סטטוס משלוח', 'shipping status']],
  ['shipMethod', ['shipping method', 'שיטת משלוח', 'אופן משלוח']],
  ['due', ['מועד טיפול', 'due']],
  ['title', ['משימה', 'title', 'task']],
  ['order', ['הזמנה', 'מספר הזמנה', 'order number', 'order id', 'order']],
  ['handler', ['בטיפול של', 'מטפל', 'handler']],
  ['phone', ['טלפון', 'phone']],
  ['billing', ['חיוב', 'billing']],
  ['shipTo', ['שלח אל', 'ship to', 'shipping address', 'כתובת למשלוח']],
  ['status', ['מצב', 'סטטוס', 'status']],
  ['name', ['שם', 'לקוח', 'customer', 'name']],
  ['orderDate', ['תאריך', 'date']],
]

/** The names of the fields, for telling the person which columns were found. */
export const ORDER_FIELD_LABEL: Readonly<Record<OrderField, string>> = {
  order: 'הזמנה',
  name: 'שם',
  phone: 'טלפון',
  status: 'מצב',
  shipStatus: 'סטטוס משלוח',
  shipMethod: 'שיטת משלוח',
  handler: 'בטיפול של',
  billing: 'חיוב',
  shipTo: 'שלח אל',
  orderDate: 'תאריך',
  due: 'מועד טיפול',
  title: 'משימה',
}

/** The most orders that one import takes. */
export const MAX_ORDERS = 300

/**
 * The column of each field, found in the row of the headers: the header is lower-cased and the marks of a
 * sorted column (▼ ▲ and a colon) are taken off; each field first looks for a header that is one of its names,
 * and then for a header that has one of them in it. A column is used for one field only.
 */
export function mapHeaders(header: string[]): Partial<Record<OrderField, number>> {
  const map: Partial<Record<OrderField, number>> = {}
  const headers = header.map((value) => value.trim().toLowerCase().replace(/[▼▲:]/g, '').trim())
  for (const pass of ['equal', 'contains'] as const) {
    for (const [field, names] of HEADER_MAP) {
      if (field in map) continue
      const used = new Set(Object.values(map))
      const index = headers.findIndex((value, at) => !used.has(at) && names.some((name) => (pass === 'equal' ? value === name : value.includes(name))))
      if (index >= 0) map[field] = index
    }
  }
  return map
}

export interface OrdersContext extends ImportContext {
  /** The order numbers that tasks already have, without a leading "#": an order that is here is not imported again. */
  existingOrders: ReadonlySet<string>
  /** The reminder of a new task, in minutes: the one that the person who imports has chosen. */
  defaultRemindMin: number
}

export interface OrdersReading {
  items: ImportItem[]
  /** Orders left out because their number exists already or comes twice in the file. */
  duplicates: number
  /** The fields whose columns were found. */
  fields: OrderField[]
  /** New orders beyond the most that one import takes: they are not in `items`. */
  extra: number
  problems: ImportProblem[]
  /** The names in "בטיפול של" that are nobody in the team: the tasks keep them as text. */
  unmatchedHandlers: string[]
}

/**
 * The new orders of a file, as tasks to make. A row with no order number and no name is skipped; an order
 * number that exists or comes twice is a duplicate and is left out; at most 300 orders are taken and the rest
 * are counted. The title is what the file says, else "טיפול בהזמנה #…", else "לחזור אל …", as the old app made it.
 */
export function readOrders(rows: string[][], context: OrdersContext): OrdersReading | { error: string } {
  if (rows.length < 2) return { error: 'צריך שורת כותרות ולפחות שורת הזמנה אחת.' }
  const map = mapHeaders(rows[0])
  if (!('order' in map) && !('name' in map)) return { error: 'לא נמצאה עמודת "הזמנה" או "שם" בשורת הכותרות.' }

  const seen = new Set<string>()
  const all: Array<{ item: ImportItem; problems: ImportProblem[]; handler: string; matched: boolean }> = []
  let duplicates = 0

  rows.slice(1).forEach((row, offset) => {
    const number = offset + 2
    const cell = (field: OrderField) => {
      const index = map[field]
      return index === undefined ? '' : String(row[index] ?? '').trim()
    }
    const order = cell('order').replace(/^#\s*/, '')
    const name = cell('name')
    if (!order && !name) return
    if (order && (context.existingOrders.has(order) || seen.has(order))) {
      duplicates++
      return
    }
    if (order) seen.add(order)

    const problems: ImportProblem[] = []
    const due = readMoment(cell('due'))
    if (!due.ok) problems.push({ row: number, message: `מועד הטיפול "${cell('due')}" לא מובן: נשמרה משימה בלי מועד.` })
    const statusLabel = cell('status')
    const status = matchStatus(statusLabel, context.statuses)
    if (!status.exact) {
      const kept = context.statuses.find((candidate) => candidate.key === status.key)?.name_he ?? status.key
      problems.push({ row: number, message: `המצב "${statusLabel}" לא זוהה במלואו: נשמר "${kept}".` })
    }
    const handler = cell('handler')
    const assignee = matchPerson(handler, context.profiles)

    const patch: TaskPatch = {
      title: cell('title') || (order ? `טיפול בהזמנה #${order}` : `לחזור אל ${name}`),
      notes: '',
      due_at: due.ok ? due.at : null,
      duration_min: 30,
      remind_min: context.defaultRemindMin,
      order_number: order,
      customer_name: name,
      customer_phone: cell('phone'),
      status_key: status.key,
      assignee_id: assignee,
      legacy_handler: assignee === null ? handler : '',
      ship_method: cell('shipMethod'),
      ship_status: cell('shipStatus'),
      order_date: cell('orderDate'),
      billing: cell('billing'),
      ship_to: cell('shipTo'),
      // An order of a file has no conversation to name.
      no_glassix: true,
    }
    const notes = [...problems.map((problem) => problem.message), ...(handler && assignee === null ? [`"${handler}" אינו בצוות: השם נשמר כטקסט.`] : [])]
    all.push({ item: { legacyId: null, patch, ...(notes.length ? { note: notes.join(' ') } : {}) }, problems, handler, matched: assignee !== null })
  })

  const taken = all.slice(0, MAX_ORDERS)
  const unmatched: string[] = []
  for (const entry of taken) {
    if (entry.handler && !entry.matched && !unmatched.includes(entry.handler)) unmatched.push(entry.handler)
  }
  return {
    items: taken.map((entry) => entry.item),
    duplicates,
    fields: Object.keys(map) as OrderField[],
    extra: all.length - taken.length,
    problems: taken.flatMap((entry) => entry.problems),
    unmatchedHandlers: unmatched,
  }
}
