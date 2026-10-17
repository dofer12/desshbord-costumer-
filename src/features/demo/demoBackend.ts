import { createMemoryAdminGateway } from '../admin/memoryAdminGateway'
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
    default_remind_min: 15,
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

/** The id of the picture of the sample pickup, which is also the picture that the task has set as its product. */
const DEMO_PICTURE_ID = 'demo-pickup-photo'

/** A drawing of a drill, as the picture of the product of the sample pickup. It is made when the demo starts. */
function demoProductPicture(): Blob {
  const drawing = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" width="640" height="480">',
    '<rect width="640" height="480" fill="#eef3f6"/>',
    '<rect x="150" y="170" width="260" height="110" rx="30" fill="#1e88c9"/>',
    '<rect x="390" y="195" width="130" height="60" rx="12" fill="#14262e"/>',
    '<rect x="200" y="270" width="70" height="150" rx="16" fill="#1e88c9"/>',
    '<text x="320" y="460" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#14262e">DR-2040</text>',
    '</svg>',
  ].join('')
  return new Blob([drawing], { type: 'image/svg+xml' })
}

/** Gives the first picture of the demo its fixed id, and every other one an id of its own. */
function demoPictureIds(): () => string {
  let first = true
  return () => {
    if (!first) return crypto.randomUUID()
    first = false
    return DEMO_PICTURE_ID
  }
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
      thumb_attachment_id: DEMO_PICTURE_ID,
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
      remind_min: 20,
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
      assignee_id: ME,
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
    sample('demo-failed-payment', {
      title: 'לטפל בתשלום שנכשל בהזמנה',
      priority: 'high',
      status_key: 'failed',
      order_number: '900114',
      customer_name: 'לקוח לדוגמה יד׳',
      customer_phone: '050-0000014',
      assignee_id: DANA,
      due_at: from(-3 * HOUR),
      remind_min: 15,
      glassix_conversation_id: 'demo-4814',
    }),
    sample('demo-cancelled-order', {
      title: 'לאשר ללקוחה שההזמנה בוטלה',
      status_key: 'cancelled',
      order_number: '900115',
      customer_name: 'לקוחה לדוגמה טו׳',
      customer_phone: '050-0000015',
      assignee_id: MICHAL,
      created_by: MICHAL,
      due_at: from(-2 * DAY),
      done_at: from(-2 * DAY + HOUR),
      done_by: MICHAL,
      updated_at: from(-2 * DAY + HOUR),
      no_glassix: true,
    }),
    sample('demo-delivered-branch', {
      title: 'לוודא שהלקוח קיבל את המוצר בסניף',
      kind: 'pickup',
      status_key: 'delivered-branch',
      order_number: '900116',
      customer_name: 'לקוח לדוגמה טז׳',
      customer_phone: '050-0000016',
      assignee_id: ME,
      due_at: from(-5 * HOUR),
      done_at: from(-HOUR),
      done_by: ME,
      updated_at: from(-HOUR),
      product_name: 'סט ברגים',
      product_sku: 'SC-310',
      ship_method: 'נקודת איסוף',
      no_glassix: true,
    }),
    sample('demo-pull-stock', {
      title: 'לבקש משיכת מלאי מסניף חיפה',
      status_key: 'pull',
      order_number: '900117',
      customer_name: 'לקוח לדוגמה יז׳',
      customer_phone: '050-0000017',
      assignee_id: AVI,
      due_at: onDay(at, 1, '08:30'),
      remind_min: 30,
      glassix_conversation_id: 'demo-4817',
    }),
    sample('demo-invoice', {
      title: 'לשלוח חשבונית מתוקנת ללקוחה',
      customer_name: 'לקוחה לדוגמה יח׳',
      customer_phone: '050-0000018',
      order_number: '900118',
      assignee_id: DANA,
      notes: 'החשבונית הקודמת יצאה על שם העסק ולא על שם הלקוחה.',
      no_glassix: true,
    }),
    sample('demo-address-change', {
      title: 'לעדכן כתובת משלוח לפני היציאה',
      kind: 'delivery',
      status_key: 'cargo',
      priority: 'high',
      order_number: '900119',
      customer_name: 'לקוח לדוגמה יט׳',
      customer_phone: '050-0000019',
      assignee_id: ME,
      due_at: from(25 * MINUTE),
      remind_min: 10,
      ship_method: 'CARGO',
      ship_to: 'רחוב הרצל 14, תל אביב',
      cargo_number: 'CG-100412',
      glassix_conversation_id: 'demo-4819',
    }),
    sample('demo-warranty', {
      title: 'לבדוק אחריות על מכשיר שהתקלקל',
      status_key: 'on-hold',
      service_call_number: 'SC-5560',
      customer_name: 'לקוחה לדוגמה כ׳',
      customer_phone: '050-0000020',
      assignee_id: AVI,
      due_at: onDay(at, 4, '11:00'),
      no_glassix: true,
    }),
    sample('demo-callback-urgent', {
      title: 'לחזור ללקוח כועס בנוגע להזמנה שהתעכבה',
      priority: 'urgent',
      status_key: 'manager',
      order_number: '900121',
      customer_name: 'לקוח לדוגמה כא׳',
      customer_phone: '050-0000021',
      assignee_id: ME,
      due_at: from(40 * MINUTE),
      duration_min: 15,
      remind_min: 5,
      glassix_conversation_id: 'demo-4821',
    }),
    sample('demo-pickup-tiles', {
      title: 'לתאם איסוף של אריחים מהמחסן',
      kind: 'pickup',
      status_key: 'await-pickup',
      order_number: '900122',
      customer_name: 'לקוח לדוגמה כב׳',
      customer_phone: '050-0000022',
      assignee_id: DANA,
      due_at: from(5 * HOUR),
      product_name: 'אריחי קרמיקה 60×60',
      product_sku: 'TL-6060',
      ship_method: 'איסוף עצמי',
      no_glassix: true,
    }),
    sample('demo-courier-delay', {
      title: 'לברר מול השליח למה המשלוח מתעכב',
      kind: 'delivery',
      status_key: 'late',
      priority: 'high',
      order_number: '900123',
      customer_name: 'לקוחה לדוגמה כג׳',
      customer_phone: '050-0000023',
      assignee_id: MICHAL,
      created_by: AVI,
      due_at: from(-DAY - 2 * HOUR),
      ship_method: 'משלוח עד הבית',
      ship_status: 'בדרך',
      glassix_conversation_id: 'demo-4823',
    }),
    sample('demo-bank-transfer', {
      title: 'לבדוק שההעברה הבנקאית נכנסה',
      status_key: 'bank',
      order_number: '900124',
      customer_name: 'לקוח לדוגמה כד׳',
      customer_phone: '050-0000024',
      assignee_id: DANA,
      due_at: onDay(at, 1, '15:00'),
      no_glassix: true,
    }),
    sample('demo-abroad-tracking', {
      title: 'לעקוב אחרי הזמנה שהוזמנה מחו"ל',
      status_key: 'abroad',
      order_number: '900125',
      customer_name: 'לקוחה לדוגמה כה׳',
      customer_phone: '050-0000025',
      assignee_id: AVI,
      due_at: onDay(at, 5, '10:00'),
      notes: 'ההזמנה אמורה להגיע לנמל בסוף השבוע הבא.',
      glassix_conversation_id: 'demo-4825',
    }),
    sample('demo-completed-yesterday', {
      title: 'לשלוח ללקוח אישור על קבלת החזר',
      status_key: 'completed',
      order_number: '900126',
      customer_name: 'לקוח לדוגמה כו׳',
      customer_phone: '050-0000026',
      assignee_id: ME,
      due_at: from(-DAY),
      done_at: from(-DAY + 2 * HOUR),
      done_by: ME,
      updated_at: from(-DAY + 2 * HOUR),
      no_glassix: true,
    }),
    sample('demo-cargo-pending', {
      title: 'להעביר ל-CARGO הזמנה של ריהוט',
      kind: 'delivery',
      status_key: 'cargo',
      order_number: '900127',
      customer_name: 'לקוחה לדוגמה כז׳',
      customer_phone: '050-0000027',
      assignee_id: null,
      due_at: from(3 * HOUR),
      ship_method: 'CARGO',
      no_glassix: true,
    }),
    sample('demo-price-question', {
      title: 'לענות ללקוח על שאלה בנוגע למחיר',
      customer_name: 'לקוח לדוגמה כח׳',
      customer_phone: '050-0000028',
      assignee_id: MICHAL,
      due_at: from(90 * MINUTE),
      glassix_conversation_id: 'demo-4828',
    }),
    sample('demo-callback-tomorrow', {
      title: 'לחזור ללקוחה לגבי החלפת מוצר',
      order_number: '900129',
      customer_name: 'לקוחה לדוגמה כט׳',
      customer_phone: '050-0000029',
      assignee_id: ME,
      due_at: onDay(at, 1, '11:30'),
      remind_min: 30,
      glassix_conversation_id: 'demo-4829',
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
  const pictures = createMemoryAttachments({
    userId: ME,
    now,
    // A picture is shown from the memory of the browser.
    signedUrl: (_path, picture) => (picture ? URL.createObjectURL(picture) : ''),
    // A picture is written on the history of its task, as the database does.
    events: memory.events,
    newId: demoPictureIds(),
  })
  // The sample pickup comes with the picture of its product. Adding it takes no waiting.
  void pictures.gateway.add('demo-pickup', { full: demoProductPicture(), thumb: demoProductPicture(), kind: 'product', width: 640, height: 480 })
  const directory = createMemoryDirectory({
    statuses: demoStatuses(),
    profiles: [DEMO_PROFILE, ...demoColleagues()],
    settings: { glassix_url_template: 'https://example.com/glassix/{id}' },
  })
  return {
    tasks: memory.gateway,
    directory: directory.gateway,
    attachments: pictures.gateway,
    // The user of the demo is an administrator, and the people of the demo are the ones that they manage.
    admin: createMemoryAdminGateway({ directory, currentUserId: ME }),
    outbox: () => createMemoryOutboxStorage(),
  }
}
