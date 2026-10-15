export const TASK_KINDS = ['general', 'delivery', 'pickup'] as const
export type TaskKind = (typeof TASK_KINDS)[number]

export const PRIORITIES = ['normal', 'high', 'urgent'] as const
export type Priority = (typeof PRIORITIES)[number]

export const KIND_LABEL: Record<TaskKind, string> = {
  general: 'כללית',
  delivery: 'משלוח',
  pickup: 'איסוף',
}

// "high" is the "דחוף" flag of the old app, so the old and the new data read the same.
export const PRIORITY_LABEL: Record<Priority, string> = {
  normal: 'רגילה',
  high: 'דחוף',
  urgent: 'דחוף מאוד',
}

/** The shipping methods of a new installation. The list in use is the `ship_methods` setting. */
export const DEFAULT_SHIP_METHODS: readonly string[] = ['איסוף עצמי', 'משלוח עד הבית', 'נקודת איסוף', 'CARGO']

/** A row of the `tasks` table, with the same column names. */
export interface Task {
  id: string
  kind: TaskKind
  created_by: string
  created_at: string
  updated_at: string
  deleted_at: string | null

  title: string
  notes: string
  priority: Priority
  status_key: string
  assignee_id: string | null
  due_at: string | null
  duration_min: number
  remind_min: number | null
  done_at: string | null
  done_by: string | null

  customer_name: string
  customer_phone: string
  /** The digits of the phone number, kept by the database for searching. Never sent. */
  customer_phone_digits: string
  order_number: string
  service_call_number: string
  glassix_conversation_id: string
  no_glassix: boolean

  cargo_number: string
  sent_to_cargo: boolean

  product_name: string
  product_sku: string
  thumb_attachment_id: string | null

  ship_method: string
  ship_status: string
  order_date: string
  billing: string
  ship_to: string

  legacy_id: string | null
  legacy_handler: string
}

/** The fields that a change may carry. The others are kept by the database itself. */
export type TaskPatch = Partial<
  Omit<Task, 'id' | 'created_by' | 'created_at' | 'updated_at' | 'done_by' | 'customer_phone_digits'>
>

/** A new, empty task with the defaults of the database. Its id is made here, so that a resend is safe. */
export function newTask(createdBy: string, id: string = crypto.randomUUID()): Task {
  const now = new Date().toISOString()
  return {
    id,
    kind: 'general',
    created_by: createdBy,
    created_at: now,
    updated_at: now,
    deleted_at: null,

    title: '',
    notes: '',
    priority: 'normal',
    status_key: 'processing',
    assignee_id: null,
    due_at: null,
    duration_min: 30,
    remind_min: null,
    done_at: null,
    done_by: null,

    customer_name: '',
    customer_phone: '',
    customer_phone_digits: '',
    order_number: '',
    service_call_number: '',
    glassix_conversation_id: '',
    no_glassix: false,

    cargo_number: '',
    sent_to_cargo: false,

    product_name: '',
    product_sku: '',
    thumb_attachment_id: null,

    ship_method: '',
    ship_status: '',
    order_date: '',
    billing: '',
    ship_to: '',

    legacy_id: null,
    legacy_handler: '',
  }
}
