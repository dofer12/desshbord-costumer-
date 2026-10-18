import type { Profile } from '../auth/types'
import type { Status } from '../tasks/gateways'
import { KIND_LABEL, TASK_KINDS, type Priority, type Task, type TaskKind, type TaskPatch } from '../tasks/model'
import { fromDueAt, parseDuePreset, toDueAt } from '../tasks/validation'
import { neutralizeFormula, restoreFormula } from './csv'
import { matchPerson, matchStatus } from './matching'

// The layout of the backup file: the 22 columns of the old app, in the old order, so that a file of the
// old app is read here and a backup of this system can be opened by the old one; then the column that marks
// a deleted task, then the columns that the old app did not have. One row is one task.

const COL = {
  id: 'מזהה',
  title: 'משימה',
  due: 'מועד טיפול',
  duration: 'משך בדקות',
  remind: 'תזכורת בדקות',
  urgent: 'דחוף',
  done: 'בוצע',
  doneAt: 'בוצע בתאריך',
  notes: 'הערות',
  order: 'הזמנה',
  name: 'שם',
  phone: 'טלפון',
  status: 'מצב',
  handler: 'בטיפול של',
  shipMethod: 'Shipping Method',
  shipStatus: 'סטטוס משלוח',
  cargo: 'CARGO',
  orderDate: 'תאריך הזמנה',
  billing: 'חיוב',
  shipTo: 'שלח אל',
  created: 'נוצר',
  updated: 'עודכן',
  deleted: 'נמחק',
  systemId: 'מזהה במערכת',
  kind: 'סוג',
  glassix: 'מזהה שיחת Glassix',
  noGlassix: 'ללא Glassix',
  serviceCall: 'קריאת שירות',
  productName: 'שם מוצר',
  sku: 'מק״ט',
  cargoNumber: 'מספר CARGO',
} as const

/** The names of the columns, in the order of the file. */
export const BACKUP_COLUMNS: readonly string[] = Object.values(COL)

/** What the file says for "yes", for "very urgent" and for "no reminder". */
const YES = 'כן'
const VERY_URGENT = 'דחוף מאוד'
const NO_REMINDER = '-1'

const DEFAULT_REMIND_MIN = 15
const DEFAULT_DURATION_MIN = 30
const ID_SHAPE = /^[A-Za-z0-9_-]{1,80}$/
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** What the importer needs to know about the team and the moment. */
export interface ImportContext {
  statuses: Status[]
  profiles: Profile[]
  /** The moment of the import: a task that is done in the file with no time is done now. */
  now: Date
  /** The administrator who imports. */
  adminId: string
}

export interface ImportItem {
  /** The id that the file gave the task (its old id, or its id here); null for an item of the file of orders, whose key is the order number. */
  legacyId: string | null
  /** The id of the task here, when the file has one that is a UUID: importing the same file again then finds the same task. */
  id?: string
  patch: TaskPatch
  /** What the screen should say about the item: something was guessed, or could not be read. */
  note?: string
}

export interface ImportProblem {
  /** The row of the file, counted as a spreadsheet counts them: the row of the headers is 1. */
  row: number
  message: string
}

export interface BackupReading {
  items: ImportItem[]
  /** Tasks of the file that are marked deleted, which are not imported. */
  skippedDeleted: number
  problems: ImportProblem[]
  /** The names in "בטיפול של" that are nobody in the team: the tasks keep them as text. */
  unmatchedHandlers: string[]
}

/** The date and the time on the wall in Jerusalem at a moment, as the files write them: `15/10/2026 14:30`. Empty for none. */
export function formatWall(iso: string | null): string {
  const { dueDate, dueTime } = fromDueAt(iso)
  if (!dueDate) return ''
  const [year, month, day] = dueDate.split('-')
  return `${day}/${month}/${year} ${dueTime}`
}

const pad2 = (value: string) => value.padStart(2, '0')
const WALL_DAY_FIRST = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})(?:[ ,T]+(\d{1,2}):(\d{2}))?$/
const WALL_YEAR_FIRST = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]+(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/

export type MomentReading = { ok: true; at: string | null } | { ok: false }

/**
 * A moment as a file writes it: `15/10/2026 14:30` (the day first, `/` or `.`, a year of two digits too,
 * the time optional) or `2026-10-15 14:30` is the wall clock of Jerusalem; `2026-10-15T11:30:00Z`, with a
 * zone, is that moment. A date with no time is 09:00. Empty is no moment. Anything else, or a day that
 * does not exist, is not ok.
 */
export function readMoment(value: string): MomentReading {
  const text = value.trim()
  if (!text) return { ok: true, at: null }
  const zoned = parseDuePreset(text)
  if (zoned) return { ok: true, at: zoned }

  let date: string | null = null
  let time = ''
  const dayFirst = WALL_DAY_FIRST.exec(text)
  const yearFirst = WALL_YEAR_FIRST.exec(text)
  if (dayFirst) {
    const year = dayFirst[3].length === 2 ? `20${dayFirst[3]}` : dayFirst[3]
    date = `${year}-${pad2(dayFirst[2])}-${pad2(dayFirst[1])}`
    time = dayFirst[4] === undefined ? '' : `${pad2(dayFirst[4])}:${dayFirst[5]}`
  } else if (yearFirst) {
    date = `${yearFirst[1]}-${yearFirst[2]}-${yearFirst[3]}`
    time = yearFirst[4] === undefined ? '' : `${pad2(yearFirst[4])}:${yearFirst[5]}`
  }
  if (date === null) return { ok: false }
  try {
    return { ok: true, at: toDueAt(date, time) }
  } catch {
    return { ok: false }
  }
}

/** The rows of a backup file for the tasks, the row of the headers first. Deleted tasks are in it, marked. */
export function tasksToBackupRows(tasks: Task[], profiles: Profile[], statuses: Status[]): string[][] {
  const people = new Map(profiles.map((profile) => [profile.id, profile.display_name]))
  const statusNames = new Map(statuses.map((status) => [status.key, status.name_he]))
  const yes = (flag: boolean) => (flag ? YES : '')
  // A text that a spreadsheet could take for a formula is written with an apostrophe in front of it.
  const text = neutralizeFormula

  const rows = tasks.map((task) => {
    const cells: Record<string, string> = {
      [COL.id]: task.legacy_id ?? task.id,
      [COL.title]: text(task.title),
      [COL.due]: formatWall(task.due_at),
      [COL.duration]: String(task.duration_min),
      [COL.remind]: task.remind_min === null ? NO_REMINDER : String(task.remind_min),
      [COL.urgent]: task.priority === 'urgent' ? VERY_URGENT : yes(task.priority === 'high'),
      [COL.done]: yes(task.done_at !== null),
      [COL.doneAt]: formatWall(task.done_at),
      [COL.notes]: text(task.notes),
      [COL.order]: text(task.order_number),
      [COL.name]: text(task.customer_name),
      [COL.phone]: text(task.customer_phone),
      [COL.status]: text(statusNames.get(task.status_key) ?? task.status_key),
      [COL.handler]: text((task.assignee_id ? people.get(task.assignee_id) : undefined) ?? task.legacy_handler),
      [COL.shipMethod]: text(task.ship_method),
      [COL.shipStatus]: text(task.ship_status),
      [COL.cargo]: yes(task.sent_to_cargo),
      [COL.orderDate]: text(task.order_date),
      [COL.billing]: text(task.billing),
      [COL.shipTo]: text(task.ship_to),
      [COL.created]: task.created_at,
      [COL.updated]: task.updated_at,
      [COL.deleted]: task.deleted_at ?? '',
      [COL.systemId]: task.id,
      [COL.kind]: KIND_LABEL[task.kind],
      [COL.glassix]: text(task.glassix_conversation_id),
      [COL.noGlassix]: yes(task.no_glassix),
      [COL.serviceCall]: text(task.service_call_number),
      [COL.productName]: text(task.product_name),
      [COL.sku]: text(task.product_sku),
      [COL.cargoNumber]: text(task.cargo_number),
    }
    return BACKUP_COLUMNS.map((column) => cells[column] ?? '')
  })
  return [[...BACKUP_COLUMNS], ...rows]
}

function readKind(value: string): TaskKind | null {
  const found = TASK_KINDS.find((kind) => kind === value || KIND_LABEL[kind] === value)
  return found ?? null
}

function readPriority(value: string): Priority {
  if (value === '') return 'normal'
  return value === VERY_URGENT ? 'urgent' : 'high'
}

/** The minutes of the reminder: empty is 15, -1 is none (as the old app's "ללא" was), a number is itself; anything else is 15 or 0, and a problem. */
function readRemind(value: string): { minutes: number | null; problem?: string } {
  if (value === '') return { minutes: DEFAULT_REMIND_MIN }
  if (value === NO_REMINDER) return { minutes: null }
  if (!/^-?\d{1,5}$/.test(value)) {
    return { minutes: DEFAULT_REMIND_MIN, problem: `התזכורת "${value}" אינה מספר של דקות: נשמרו ${DEFAULT_REMIND_MIN} דקות.` }
  }
  const minutes = Number(value)
  return minutes < 0 ? { minutes: 0, problem: `התזכורת "${value}" שלילית: נשמרה תזכורת בזמן המשימה.` } : { minutes }
}

function readDuration(value: string): number {
  const minutes = /^\d{1,5}$/.test(value) ? Number(value) : 0
  return minutes > 0 ? minutes : DEFAULT_DURATION_MIN
}

/**
 * The tasks of a backup file, as changes to make. The file is the one that tasksToBackupRows writes, or a
 * file of the old app with its 22 columns. A row with no id (or one that is not an id) or with no task is
 * left out and told; of an id that comes twice the last row counts; a row marked deleted is left out and
 * counted. What a row says that cannot be read is told and a default is used.
 */
export function readBackup(rows: string[][], context: ImportContext): BackupReading | { error: string } {
  if (rows.length === 0) return { error: 'הקובץ ריק.' }
  const header = rows[0].map((value) => value.trim())
  const column = (name: string) => header.indexOf(name)
  if (column(COL.id) < 0 || column(COL.title) < 0) {
    return { error: 'זה לא קובץ גיבוי של המערכת: בשורת הכותרות חסרות העמודות "מזהה" ו"משימה".' }
  }
  const hasNoGlassixColumn = column(COL.noGlassix) >= 0

  interface Candidate {
    legacyId: string
    deleted: boolean
    item: ImportItem
    problems: ImportProblem[]
    handler: string
    matched: boolean
  }
  const problems: ImportProblem[] = []
  const winners = new Map<string, Candidate>()

  rows.slice(1).forEach((row, offset) => {
    const number = offset + 2
    const cell = (name: string) => {
      const index = column(name)
      return index < 0 ? '' : restoreFormula(String(row[index] ?? '')).trim()
    }
    const rowProblems: ImportProblem[] = []
    const problem = (message: string) => rowProblems.push({ row: number, message })

    const legacyId = cell(COL.id)
    const title = cell(COL.title)
    if (!legacyId || !ID_SHAPE.test(legacyId)) {
      problems.push({ row: number, message: legacyId ? `המזהה "${legacyId}" אינו תקין: השורה דולגה.` : 'אין מזהה: השורה דולגה.' })
      return
    }
    if (!title) {
      problems.push({ row: number, message: 'אין משימה: השורה דולגה.' })
      return
    }

    const kindCell = cell(COL.kind)
    const kind = readKind(kindCell)
    if (kindCell && kind === null) problem(`סוג המשימה "${kindCell}" לא מוכר: נשמרה משימה כללית.`)

    const due = readMoment(cell(COL.due))
    if (!due.ok) problem(`מועד הטיפול "${cell(COL.due)}" לא מובן: נשמרה משימה בלי מועד.`)
    const remind = readRemind(cell(COL.remind))
    if (remind.problem) problem(remind.problem)

    const isDone = cell(COL.done) !== ''
    const doneMoment = readMoment(cell(COL.doneAt))
    if (isDone && !doneMoment.ok) problem(`תאריך הביצוע "${cell(COL.doneAt)}" לא מובן: נשמר הזמן של הייבוא.`)
    const doneAt = isDone ? (doneMoment.ok && doneMoment.at ? doneMoment.at : context.now.toISOString()) : null

    const statusLabel = cell(COL.status)
    const status = matchStatus(statusLabel, context.statuses)
    if (!status.exact) problem(`המצב "${statusLabel}" לא זוהה במלואו: נשמר "${context.statuses.find((s) => s.key === status.key)?.name_he ?? status.key}".`)

    const handler = cell(COL.handler)
    const assignee = matchPerson(handler, context.profiles)

    const glassixId = cell(COL.glassix)
    // The database refuses a task that has no conversation and does not say that it has none, and a file of the old app has no such column.
    const noGlassix = !hasNoGlassixColumn || cell(COL.noGlassix) !== '' || glassixId === ''

    const systemId = cell(COL.systemId)
    const id = UUID_SHAPE.test(systemId) ? systemId : UUID_SHAPE.test(legacyId) ? legacyId : undefined

    const patch: TaskPatch = {
      kind: kind ?? 'general',
      title,
      notes: cell(COL.notes),
      priority: readPriority(cell(COL.urgent)),
      status_key: status.key,
      assignee_id: assignee,
      due_at: due.ok ? due.at : null,
      duration_min: readDuration(cell(COL.duration)),
      remind_min: remind.minutes,
      done_at: doneAt,
      customer_name: cell(COL.name),
      customer_phone: cell(COL.phone),
      order_number: cell(COL.order),
      service_call_number: cell(COL.serviceCall),
      glassix_conversation_id: glassixId,
      no_glassix: noGlassix,
      cargo_number: cell(COL.cargoNumber),
      sent_to_cargo: cell(COL.cargo) !== '',
      product_name: cell(COL.productName),
      product_sku: cell(COL.sku),
      ship_method: cell(COL.shipMethod),
      ship_status: cell(COL.shipStatus),
      order_date: cell(COL.orderDate),
      billing: cell(COL.billing),
      ship_to: cell(COL.shipTo),
      legacy_id: legacyId,
      legacy_handler: assignee === null ? handler : '',
    }
    const notes = [...rowProblems.map((p) => p.message), ...(handler && assignee === null ? [`"${handler}" אינו בצוות: השם נשמר כטקסט.`] : [])]
    const item: ImportItem = { legacyId, ...(id === undefined ? {} : { id }), patch, ...(notes.length ? { note: notes.join(' ') } : {}) }

    // Of an id that comes twice the last row counts, wherever it stands.
    winners.delete(legacyId)
    winners.set(legacyId, { legacyId, deleted: cell(COL.deleted) !== '', item, problems: rowProblems, handler, matched: assignee !== null })
  })

  const items: ImportItem[] = []
  const unmatched: string[] = []
  let skippedDeleted = 0
  for (const candidate of winners.values()) {
    if (candidate.deleted) {
      skippedDeleted++
      continue
    }
    items.push(candidate.item)
    problems.push(...candidate.problems)
    if (candidate.handler && !candidate.matched && !unmatched.includes(candidate.handler)) unmatched.push(candidate.handler)
  }
  problems.sort((a, b) => a.row - b.row)
  return { items, skippedDeleted, problems, unmatchedHandlers: unmatched }
}
