import type { Profile } from '../auth/types'
import type { Status, TaskEvent } from './gateways'
import { KIND_LABEL, PRIORITY_LABEL } from './model'
import { fromDueAt } from './validation'

/** What the history needs to turn the ids of an event into names. */
export interface Names {
  statuses: Status[]
  profiles: Profile[]
}

export const ACTOR_SYSTEM = 'המערכת'
export const ACTOR_UNKNOWN = 'משתמש אחר'
const UNKNOWN_PERSON = 'משתמש לא ידוע'

/** Who made a change: the person, "the system" when nobody did, and "another user" for one that the directory does not know. */
export function actorName(actorId: string | null, profiles: Profile[]): string {
  if (actorId === null) return ACTOR_SYSTEM
  return profiles.find((person) => person.id === actorId)?.display_name ?? ACTOR_UNKNOWN
}

/** The fields that an update shows, with their names in Hebrew, in the order of the card. */
const FIELD_LABEL = {
  title: 'כותרת',
  kind: 'סוג',
  assignee_id: 'שיוך',
  priority: 'עדיפות',
  status_key: 'סטטוס',
  due_at: 'מועד',
  duration_min: 'משך',
  remind_min: 'תזכורת',
  done_at: 'מועד הסיום',
  notes: 'הערות',
  customer_name: 'שם לקוח',
  customer_phone: 'טלפון',
  order_number: 'מספר הזמנה',
  service_call_number: 'מספר קריאת שירות',
  glassix_conversation_id: 'מזהה שיחת Glassix',
  no_glassix: 'אין שיחה ב-Glassix',
  cargo_number: 'מספר Cargo',
  sent_to_cargo: 'נשלח ל-CARGO',
  product_name: 'שם מוצר',
  product_sku: 'מק״ט',
  thumb_attachment_id: 'תמונת מוצר',
  ship_method: 'שיטת משלוח',
  ship_status: 'סטטוס משלוח',
  order_date: 'תאריך הזמנה',
  billing: 'חיוב',
  ship_to: 'כתובת למשלוח',
} as const

type Field = keyof typeof FIELD_LABEL
const FIELD_ORDER = Object.keys(FIELD_LABEL) as Field[]
const LONGEST_TEXT = 60

/** A text on one line, with a single space between the words, and cut with "…" when it is long. */
export function shorten(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > LONGEST_TEXT ? `${flat.slice(0, LONGEST_TEXT - 1).trimEnd()}…` : flat
}

const isEmpty = (value: unknown) => value === null || value === undefined || value === ''

/** A moment as the date and the time on the wall in Jerusalem: "16.10.2026 09:00". */
function moment(value: unknown): string {
  const { dueDate, dueTime } = fromDueAt(String(value))
  if (!dueDate) return shorten(String(value))
  const [year, month, day] = dueDate.split('-').map(Number)
  return `${day}.${month}.${year} ${dueTime}`
}

/** What a value of a field looks like to a person: a name where the value is an id, words where it is a number. Empty for nothing. */
function show(field: string, value: unknown, names: Names): string {
  if (isEmpty(value)) return ''
  if (typeof value === 'boolean') return value ? 'כן' : 'לא'
  switch (field) {
    case 'status_key':
      return names.statuses.find((status) => status.key === value)?.name_he ?? String(value)
    case 'assignee_id':
      return names.profiles.find((person) => person.id === value)?.display_name ?? UNKNOWN_PERSON
    case 'priority':
      return (PRIORITY_LABEL as Record<string, string>)[String(value)] ?? String(value)
    case 'kind':
      return (KIND_LABEL as Record<string, string>)[String(value)] ?? String(value)
    case 'due_at':
    case 'done_at':
      return moment(value)
    case 'duration_min':
      return typeof value === 'number' ? `${value} דקות` : shorten(String(value))
    case 'remind_min':
      return typeof value === 'number' ? (value === 0 ? 'בזמן המשימה' : `${value} דקות לפני`) : shorten(String(value))
    default:
      return shorten(String(value))
  }
}

/** One change as a line, or null when it is not a pair of an old and a new value, or changes nothing that a person can see. */
function changeLine(field: Field, change: unknown, names: Names): string | null {
  const label = FIELD_LABEL[field]
  if (!Array.isArray(change) || change.length !== 2) return null
  const [before, after] = change
  // The ids of the pictures say nothing: say what was done with the picture of the product.
  if (field === 'thumb_attachment_id') {
    if (isEmpty(before) && isEmpty(after)) return null
    return `${label}: ${isEmpty(before) ? 'נקבעה' : isEmpty(after) ? 'הוסרה' : 'הוחלפה'}`
  }
  const was = show(field, before, names)
  const now = show(field, after, names)
  if (was === '' && now === '') return null
  if (was === '') return `${label}: נקבע ל-${now}`
  if (now === '') return `${label}: הוסר (היה ${was})`
  return `${label}: מ-${was} ל-${now}`
}

/** What an event says, as lines for a person: one for what happened, or one for each field that an update changed. */
export function describeEvent(event: TaskEvent, names: Names): string[] {
  switch (event.type) {
    case 'created':
      return ['המשימה נוצרה']
    case 'done':
      return ['המשימה סומנה כבוצעה']
    case 'reopened':
      return ['סימון הביצוע בוטל']
    case 'deleted':
      return ['המשימה נמחקה']
    case 'restored':
      return ['המשימה שוחזרה']
    case 'attachment_added':
      return ['נוספה תמונה']
    case 'attachment_removed':
      return ['הוסרה תמונה']
    case 'status':
      return [changeLine('status_key', event.changes.status_key, names) ?? 'הסטטוס שונה']
    case 'assigned':
      return [changeLine('assignee_id', event.changes.assignee_id, names) ?? 'השיוך שונה']
    case 'updated': {
      const found = FIELD_ORDER.map((field) => changeLine(field, event.changes[field], names)).filter((line): line is string => line !== null)
      return found.length > 0 ? found : ['פרטי המשימה עודכנו']
    }
  }
}
