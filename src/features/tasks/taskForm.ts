import type { Task, TaskPatch } from './model'
import { fallbackTitle, fromDueAt, toDueAt } from './validation'

/** What the card edits: the fields of a task, and the due moment as the two inputs show it. */
export interface Draft {
  task: Task
  dueDate: string
  dueTime: string
}

/** The text fields: they are trimmed when the task is saved. */
const TEXT_FIELDS = [
  'title',
  'notes',
  'customer_name',
  'customer_phone',
  'order_number',
  'service_call_number',
  'glassix_conversation_id',
  'cargo_number',
  'product_name',
  'product_sku',
  'ship_method',
  'ship_status',
  'order_date',
  'billing',
  'ship_to',
] as const

/** Every field that the card has an input for, besides the due moment. The others are changed by their own buttons, or by the server. */
const EDITABLE = [
  ...TEXT_FIELDS,
  'kind',
  'priority',
  'status_key',
  'assignee_id',
  'duration_min',
  'remind_min',
  'no_glassix',
  'sent_to_cargo',
] as const

type Editable = (typeof EDITABLE)[number]

const read = (task: Task, field: Editable): unknown => (task as unknown as Record<string, unknown>)[field]

export function toDraft(task: Task): Draft {
  const { dueDate, dueTime } = fromDueAt(task.due_at)
  return { task: { ...task }, dueDate, dueTime }
}

/**
 * The task as it is saved: the text trimmed, the "#" off the order number, a title made from the
 * order number or the customer when there is none, and the due moment made from the date and the
 * time. Throws for a date that cannot exist, so a draft is checked with validateTask first.
 */
export function normalizedTask(draft: Draft): Task {
  const next = { ...draft.task }
  for (const field of TEXT_FIELDS) next[field] = next[field].trim()
  next.order_number = next.order_number.replace(/^#\s*/, '')
  next.title = fallbackTitle(next)
  next.due_at = toDueAt(draft.dueDate, draft.dueTime)
  return next
}

/**
 * The fields to send for a task that already exists: only the ones that the person touched, in the
 * form in which they are saved. A field that was left alone is not sent, even when what is stored
 * would be written differently (an old order number with a "#"), and a change that comes to nothing
 * once the text is trimmed is not a change.
 */
export function changedFields(base: Task, draft: Draft): TaskPatch {
  const next = normalizedTask(draft)
  const patch: Record<string, unknown> = {}
  for (const field of EDITABLE) {
    if (read(draft.task, field) !== read(base, field) && read(next, field) !== read(base, field)) patch[field] = read(next, field)
  }
  const was = fromDueAt(base.due_at)
  if ((draft.dueDate !== was.dueDate || draft.dueTime !== was.dueTime) && next.due_at !== base.due_at) patch.due_at = next.due_at
  return patch as TaskPatch
}

/** Whether the person has typed or chosen anything since the card was opened. */
export function isDirty(base: Task, draft: Draft): boolean {
  const was = fromDueAt(base.due_at)
  return EDITABLE.some((field) => read(draft.task, field) !== read(base, field)) || draft.dueDate !== was.dueDate || draft.dueTime !== was.dueTime
}

/**
 * A new version of the task came from the server while the card is open. A field that the person
 * has not touched shows the new value; a field that they have typed over stays as they typed it.
 * What the card does not edit (done, the picture, the time of the change) always follows the server.
 */
export function mergeRemote(draft: Draft, oldBase: Task, newBase: Task): Draft {
  const task: Record<string, unknown> = { ...newBase }
  for (const field of EDITABLE) if (read(draft.task, field) !== read(oldBase, field)) task[field] = read(draft.task, field)
  const was = fromDueAt(oldBase.due_at)
  const now = fromDueAt(newBase.due_at)
  return {
    task: task as unknown as Task,
    dueDate: draft.dueDate === was.dueDate ? now.dueDate : draft.dueDate,
    dueTime: draft.dueTime === was.dueTime ? now.dueTime : draft.dueTime,
  }
}
