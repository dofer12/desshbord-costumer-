import type { Profile } from '../auth/types'
import type { Backend } from '../tasks/backend'
import type { Status, TaskEvent } from '../tasks/gateways'
import { createMemoryAttachments, createMemoryDirectory, createMemoryTasks } from '../tasks/memoryGateways'
import { newTask, type Task } from '../tasks/model'
import { createMemoryOutboxStorage } from '../tasks/outbox'
import { fromDueAt, toDueAt } from '../tasks/validation'
import { DEMO_PROFILE, DEMO_USER_ID } from './demoGateway'

// The data of the demo build: a few colleagues and sixteen sample tasks, kept in memory. Only builds
// made with `--mode demo` use it; demoBuild.test.ts checks that a production build does not.
//
// Nothing in this file may run when the file is loaded. A build keeps a statement at the top of a
// module that calls something (a `.map`, a helper), even when nothing uses the result, and the demo
// data would go into a release with it. So the data is made by functions: a build leaves out the
// ones that nobody calls.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** The 17 statuses of the old app, as the database starts with them (supabase/migrations/0002_core.sql). */
export function demoStatuses(): Status[] {
  return (
    [
      ['processing', 'בטיפול', '#22a559'],
      ['pending', 'בהמתנה לתשלום', '#6b7280'],
      ['completed', 'הושלמו', '#7c9cc0'],
      ['on-hold', 'משהה', '#e9a45c'],
      ['cancelled', 'בוטלו', '#3a4250'],
      ['refunded', 'החזר כספי', '#9aa3ad'],
      ['failed', 'נכשלו', '#e0707a'],
      ['cargo', 'Send to CARGO', '#1e88c9'],
      ['late', 'חריגה מהצפי', '#f08a80'],
      ['bank', 'ממתינה להעברה בנקאית', '#2fb86a'],
      ['to-branch', 'הועבר לאיסוף מסניף', '#8fcf9b'],
      ['await-pickup', 'ממתין לאיסוף לקוח', '#a78bda'],
      ['courier', 'נמסר לחברת שליחויות', '#d4b800'],
      ['delivered-branch', 'נמסר ללקוח בסניף', '#8aa7c7'],
      ['pull', 'משיכה מסניפים', '#d93a32'],
      ['manager', 'טיפול מנהל', '#c2185b'],
      ['abroad', 'הזמנת חו"ל', '#18c13a'],
    ] as const
  ).map(([key, name_he, color], index) => ({ key, name_he, color, sort: index + 1, is_active: true }))
}

/** The people of the demo besides the user: three colleagues, so that a task can be given to somebody. */
export function demoColleagues(): Profile[] {
  const colleague = (id: string, name: string): Profile => ({
    id: `demo-${id}`,
    email: `${id}@moked.invalid`,
    display_name: name,
    role: 'employee',
    is_active: true,
    must_change_password: false,
  })
  return [colleague('dana', 'דנה כהן'), colleague('avi', 'אבי לוי'), colleague('michal', 'מיכל ברק')]
}

const ME = DEMO_USER_ID
const DANA = 'demo-dana'
const AVI = 'demo-avi'
const MICHAL = 'demo-michal'

const round5 = (ms: number) => Math.round(ms / (5 * MINUTE)) * 5 * MINUTE

/** A day that is `days` after the day of `at` in Jerusalem, at a time of day there, as a moment. */
function onDay(at: Date, days: number, time: string): string {
  const [year, month, day] = fromDueAt(at.toISOString()).dueDate.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
  return toDueAt(date, time)!
}

/**
 * The sample tasks, made from the time the demo starts: some are late, some are due soon or later
 * today, some tomorrow or further on, and some have no date; some are done. They obey the rules of the
 * app itself, so that every one of them can be opened and saved as it is.
 */
export function createDemoTasks(at: Date): Task[] {
  const t = at.getTime()
  const from = (offset: number) => new Date(round5(t + offset)).toISOString()
  const sample = (id: string, patch: Partial<Task>): Task => {
    const created = new Date(t - 3 * DAY).toISOString()
    const task: Task = { ...newTask(ME, id), created_at: created, updated_at: created, ...patch }
    return { ...task, customer_phone_digits: task.customer_phone.replace(/\D/g, '') }
  }

  return [
    sample('demo-late-delivery', {
      title: 'לחזור ללקוח לגבי עיכוב במשלוח',
      kind: 'delivery',
      priority: 'high',
      status_key: 'late',
      order_number: '900101',
      customer_name: 'לקוח לדוגמה א׳',
      customer_phone: '050-0000001',
      assignee_id: ME,
      due_at: from(-40 * MINUTE),
      duration_min: 15,
      remind_min: 10,
      ship_method: 'משלוח עד הבית',
      ship_status: 'בדרך',
      glassix_conversation_id: 'demo-4801',
      cargo_number: 'CG-100234',
      sent_to_cargo: true,
    }),
    sample('demo-bank', {
      title: 'לאשר קבלת העברה בנקאית',
      status_key: 'bank',
      order_number: '900102',
      customer_name: 'לקוח לדוגמה ב׳',
      customer_phone: '050-0000002',
      assignee_id: DANA,
      created_by: DANA,
      due_at: from(20 * MINUTE),
      duration_min: 15,
      remind_min: 15,
      ship_method: 'איסוף עצמי',
      no_glassix: true,
    }),
    sample('demo-pickup', {
      title: 'לתאם איסוף מהסניף',
      kind: 'pickup',
      status_key: 'await-pickup',
      order_number: '900103',
      customer_name: 'לקוח לדוגמה ג׳',
      customer_phone: '050-0000003',
      assignee_id: ME,
      due_at: from(2 * HOUR),
      product_name: 'מקדחה אלחוטית',
      product_sku: 'DR-2040',
      ship_method: 'איסוף עצמי',
      glassix_conversation_id: 'demo-4803',
    }),
    sample('demo-manager', {
      title: 'בדיקת מנהל לבקשת החזר כספי',
      priority: 'urgent',
      status_key: 'manager',
      order_number: '900104',
      customer_name: 'לקוח לדוגמה ד׳',
      customer_phone: '050-0000004',
      assignee_id: AVI,
      due_at: onDay(at, 1, '10:00'),
      remind_min: 30,
      notes: 'הלקוח מבקש החזר מלא. לבדוק את תנאי ההחזרה לפני שחוזרים אליו.',
      glassix_conversation_id: 'demo-4804',
    }),
    sample('demo-cargo', {
      title: 'להעביר את המשלוח ל-CARGO',
      kind: 'delivery',
      status_key: 'cargo',
      order_number: '900105',
      customer_name: 'לקוח לדוגמה ה׳',
      customer_phone: '050-0000005',
      ship_method: 'CARGO',
      no_glassix: true,
    }),
    sample('demo-defective', {
      title: 'להחזיר שיחה בנוגע למוצר פגום',
      service_call_number: 'SC-5521',
      customer_name: 'לקוחה לדוגמה ו׳',
      customer_phone: '050-0000006',
      assignee_id: ME,
      due_at: from(4 * HOUR),
      notes: 'הלקוחה צירפה תמונה של המוצר.',
      glassix_conversation_id: 'demo-4806',
    }),
    sample('demo-quote', {
      title: 'לשלוח הצעת מחיר',
      status_key: 'pending',
      customer_name: 'לקוח לדוגמה ז׳',
      customer_phone: '050-0000007',
      assignee_id: DANA,
      created_by: AVI,
      due_at: onDay(at, 1, '14:00'),
      no_glassix: true,
    }),
    sample('demo-supplier', {
      title: 'לברר עם הספק על אספקה',
      priority: 'high',
      status_key: 'on-hold',
      order_number: '900108',
      assignee_id: AVI,
      due_at: from(-DAY),
      no_glassix: true,
    }),
    sample('demo-courier', {
      title: 'לעקוב אחרי משלוח שליח',
      kind: 'delivery',
      status_key: 'courier',
      order_number: '900109',
      customer_name: 'לקוח לדוגמה ח׳',
      customer_phone: '050-0000008',
      assignee_id: DANA,
      due_at: from(HOUR),
      ship_method: 'משלוח עד הבית',
      ship_status: 'נמסר לחברת שליחויות',
      cargo_number: 'CG-100301',
      sent_to_cargo: true,
      no_glassix: true,
    }),
    sample('demo-complaint', {
      title: 'לטפל בתלונה של לקוחה',
      priority: 'urgent',
      status_key: 'manager',
      customer_name: 'לקוחה לדוגמה ט׳',
      customer_phone: '050-0000009',
      assignee_id: ME,
      due_at: from(-2 * HOUR),
      glassix_conversation_id: 'demo-4810',
    }),
    sample('demo-pickup-glue', {
      title: 'איסוף דבק קרמיקה',
      kind: 'pickup',
      status_key: 'to-branch',
      order_number: '900111',
      customer_name: 'לקוח לדוגמה י׳',
      customer_phone: '050-0000010',
      assignee_id: MICHAL,
      created_by: MICHAL,
      due_at: onDay(at, 3, '09:00'),
      product_name: 'דבק קרמיקה',
      product_sku: 'GL-9001',
      ship_method: 'נקודת איסוף',
      no_glassix: true,
    }),
    sample('demo-stock', {
      title: 'לבדוק מלאי מוצר',
      service_call_number: 'SC-5530',
      no_glassix: true,
    }),
    sample('demo-done-today', {
      title: 'לעדכן כתובת למשלוח',
      status_key: 'completed',
      order_number: '900112',
      customer_name: 'לקוח לדוגמה יא׳',
      customer_phone: '050-0000011',
      assignee_id: ME,
      due_at: from(-4 * HOUR),
      done_at: from(-3 * HOUR),
      done_by: ME,
      updated_at: from(-3 * HOUR),
      no_glassix: true,
    }),
    sample('demo-done-days-ago', {
      title: 'לברר מצב הזמנה מחו"ל',
      status_key: 'abroad',
      order_number: '900060',
      customer_name: 'לקוחה לדוגמה יב׳',
      customer_phone: '050-0000012',
      assignee_id: DANA,
      done_at: from(-5 * DAY),
      done_by: DANA,
      updated_at: from(-5 * DAY),
      no_glassix: true,
    }),
    sample('demo-old-done', {
      title: 'חיוב כפול בהזמנה ישנה',
      status_key: 'refunded',
      order_number: '880042',
      customer_name: 'לקוח לדוגמה יג׳',
      customer_phone: '050-0000013',
      assignee_id: AVI,
      created_at: from(-50 * DAY),
      done_at: from(-45 * DAY),
      done_by: AVI,
      updated_at: from(-45 * DAY),
      no_glassix: true,
    }),
  ]
}

/** The first lines of the history of the sample tasks: who made each, and who finished it. */
function createDemoEvents(tasks: Task[]): TaskEvent[] {
  const events: Array<Omit<TaskEvent, 'id'>> = []
  for (const task of tasks) {
    events.push({ task_id: task.id, actor_id: task.created_by, type: 'created', changes: {}, at: task.created_at })
    if (task.done_at !== null) {
      events.push({ task_id: task.id, actor_id: task.done_by, type: 'done', changes: { done_at: [null, task.done_at] }, at: task.done_at })
    }
  }
  return events.map((event, index) => ({ ...event, id: index + 1 }))
}

/** The backend of the demo build: no server, the people and the tasks above, and everything in memory. */
export function createDemoBackend(now: () => Date = () => new Date()): Backend {
  const tasks = createDemoTasks(now())
  const memory = createMemoryTasks({ userId: ME, tasks, events: createDemoEvents(tasks), now, echo: true, live: true })
  return {
    tasks: memory.gateway,
    directory: createMemoryDirectory({
      statuses: demoStatuses(),
      profiles: [DEMO_PROFILE, ...demoColleagues()],
      settings: { glassix_url_template: 'https://example.com/glassix/{id}' },
    }).gateway,
    attachments: createMemoryAttachments({
      userId: ME,
      now,
      // A picture that was added in the demo is shown from the memory of the browser.
      signedUrl: (_path, picture) => (picture ? URL.createObjectURL(picture) : ''),
      // A picture is written on the history of its task, as the database does.
      events: memory.events,
    }).gateway,
    outbox: () => createMemoryOutboxStorage(),
  }
}
