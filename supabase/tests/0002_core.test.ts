// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { addUser, createDb } from './helpers/pg'

let db: PGlite
let owner: string

beforeEach(async () => {
  db = await createDb()
  owner = await addUser(db, 'owner@example.com')
})

/** Runs `fn` as the given user: column defaults that use auth.uid() see that user. */
async function asUid<T>(id: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id])
  try {
    return await fn()
  } finally {
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
  }
}

/** Inserts a task row. Unless a test says otherwise it carries the "no Glassix conversation" tick. */
async function insertTask(columns: Record<string, unknown> = {}, by = owner) {
  const entries = Object.entries({ id: crypto.randomUUID(), no_glassix: true, ...columns })
  const names = entries.map(([name]) => name).join(', ')
  const marks = entries.map((_, i) => `$${i + 1}`).join(', ')
  const result = await asUid(by, () =>
    db.query<Record<string, unknown>>(
      `insert into public.tasks (${names}) values (${marks}) returning *`,
      entries.map(([, value]) => value),
    ),
  )
  return result.rows[0]
}

async function insertAttachment(taskId: string, extra: Record<string, unknown> = {}) {
  const entries = Object.entries({ id: crypto.randomUUID(), task_id: taskId, storage_path: `${taskId}/a.jpg`, kind: 'image', ...extra })
  const names = entries.map(([name]) => name).join(', ')
  const marks = entries.map((_, i) => `$${i + 1}`).join(', ')
  const result = await db.query<{ id: string }>(
    `insert into public.attachments (${names}) values (${marks}) returning id`,
    entries.map(([, value]) => value),
  )
  return result.rows[0].id
}

describe('seeds', () => {
  it('holds the 17 statuses of the old app with their names and colours, in order', async () => {
    const r = await db.query('select key, name_he, color, sort from public.statuses order by sort')
    expect(r.rows).toEqual([
      { key: 'processing', name_he: 'בטיפול', color: '#22a559', sort: 1 },
      { key: 'pending', name_he: 'בהמתנה לתשלום', color: '#6b7280', sort: 2 },
      { key: 'completed', name_he: 'הושלמו', color: '#7c9cc0', sort: 3 },
      { key: 'on-hold', name_he: 'משהה', color: '#e9a45c', sort: 4 },
      { key: 'cancelled', name_he: 'בוטלו', color: '#3a4250', sort: 5 },
      { key: 'refunded', name_he: 'החזר כספי', color: '#9aa3ad', sort: 6 },
      { key: 'failed', name_he: 'נכשלו', color: '#e0707a', sort: 7 },
      { key: 'cargo', name_he: 'Send to CARGO', color: '#1e88c9', sort: 8 },
      { key: 'late', name_he: 'חריגה מהצפי', color: '#f08a80', sort: 9 },
      { key: 'bank', name_he: 'ממתינה להעברה בנקאית', color: '#2fb86a', sort: 10 },
      { key: 'to-branch', name_he: 'הועבר לאיסוף מסניף', color: '#8fcf9b', sort: 11 },
      { key: 'await-pickup', name_he: 'ממתין לאיסוף לקוח', color: '#a78bda', sort: 12 },
      { key: 'courier', name_he: 'נמסר לחברת שליחויות', color: '#d4b800', sort: 13 },
      { key: 'delivered-branch', name_he: 'נמסר ללקוח בסניף', color: '#8aa7c7', sort: 14 },
      { key: 'pull', name_he: 'משיכה מסניפים', color: '#d93a32', sort: 15 },
      { key: 'manager', name_he: 'טיפול מנהל', color: '#c2185b', sort: 16 },
      { key: 'abroad', name_he: 'הזמנת חו"ל', color: '#18c13a', sort: 17 },
    ])
  })

  it('starts every status active', async () => {
    const r = await db.query('select count(*)::int as n from public.statuses where not is_active')
    expect(r.rows[0]).toEqual({ n: 0 })
  })

  it('holds the three settings with their defaults', async () => {
    const r = await db.query('select key, value from public.app_settings order by key')
    expect(r.rows).toEqual([
      { key: 'glassix_url_template', value: '' },
      { key: 'last_backup_at', value: null },
      { key: 'ship_methods', value: ['איסוף עצמי', 'משלוח עד הבית', 'נקודת איסוף', 'CARGO'] },
    ])
  })
})

describe('task defaults', () => {
  it('fills a task that only has an id the way the schema promises', async () => {
    const task = await insertTask()
    expect(task).toMatchObject({
      kind: 'general',
      created_by: owner,
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
      no_glassix: true,
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
    })
    expect(task.created_at).toBeInstanceOf(Date)
    expect(task.updated_at).toBeInstanceOf(Date)
  })

  it('takes created_by from the caller', async () => {
    const dana = await addUser(db, 'dana@example.com', { appMeta: { role: 'employee' } })
    expect(await insertTask({}, dana)).toMatchObject({ created_by: dana })
  })
})

describe('the Glassix rule', () => {
  it('refuses a task with neither a conversation id nor the "no conversation" tick', async () => {
    await expect(insertTask({ no_glassix: false, glassix_conversation_id: '' })).rejects.toThrow(/tasks_glassix_rule/)
  })

  it('accepts a conversation id', async () => {
    expect(await insertTask({ no_glassix: false, glassix_conversation_id: 'c-4821' })).toMatchObject({
      glassix_conversation_id: 'c-4821',
    })
  })

  it('accepts the "no conversation" tick without an id', async () => {
    expect(await insertTask({ no_glassix: true, glassix_conversation_id: '' })).toMatchObject({ no_glassix: true })
  })

  it('refuses to take the id away from a task that has no tick', async () => {
    const task = await insertTask({ no_glassix: false, glassix_conversation_id: 'c-1' })
    await expect(db.query(`update public.tasks set glassix_conversation_id = '' where id = $1`, [task.id])).rejects.toThrow(
      /tasks_glassix_rule/,
    )
  })
})

describe('value checks', () => {
  it('refuses an unknown kind, priority or status', async () => {
    await expect(insertTask({ kind: 'repair' })).rejects.toThrow(/tasks_kind_check/)
    await expect(insertTask({ priority: 'whenever' })).rejects.toThrow(/tasks_priority_check/)
    await expect(insertTask({ status_key: 'nope' })).rejects.toThrow(/foreign key/i)
  })

  it('accepts every kind and priority the app offers', async () => {
    for (const kind of ['general', 'delivery', 'pickup']) await insertTask({ kind })
    for (const priority of ['normal', 'high', 'urgent']) await insertTask({ priority })
  })

  it('refuses a zero duration and a negative reminder, and accepts no reminder and a reminder at the start', async () => {
    await expect(insertTask({ duration_min: 0 })).rejects.toThrow(/tasks_duration_min_check/)
    await expect(insertTask({ remind_min: -1 })).rejects.toThrow(/tasks_remind_min_check/)
    expect(await insertTask({ remind_min: null })).toMatchObject({ remind_min: null })
    expect(await insertTask({ remind_min: 0 })).toMatchObject({ remind_min: 0 })
  })

  it('refuses an unknown attachment kind', async () => {
    const task = await insertTask()
    await expect(insertAttachment(task.id as string, { kind: 'video' })).rejects.toThrow(/attachments_kind_check/)
    for (const kind of ['image', 'screenshot', 'product']) await insertAttachment(task.id as string, { kind })
  })

  it('refuses an unknown history event type', async () => {
    const task = await insertTask()
    await expect(
      db.query(`insert into public.task_events (task_id, type) values ($1, 'exploded')`, [task.id]),
    ).rejects.toThrow(/task_events_type_check/)
  })
})

describe('the phone digits column', () => {
  it('keeps only the digits of the phone number, so a search finds any spelling', async () => {
    const task = await insertTask({ customer_phone: '+972 (50) 123-4567' })
    expect(task.customer_phone_digits).toBe('972501234567')
  })

  it('follows an update of the phone number', async () => {
    const task = await insertTask({ customer_phone: '050-111 2222' })
    const r = await db.query<{ customer_phone_digits: string }>(
      `update public.tasks set customer_phone = '052 333 4444' where id = $1 returning customer_phone_digits`,
      [task.id],
    )
    expect(r.rows[0].customer_phone_digits).toBe('0523334444')
  })
})

describe('references', () => {
  it('keeps a task whose assignee is removed, and clears the assignment', async () => {
    const dana = await addUser(db, 'dana@example.com', { appMeta: { role: 'employee' } })
    const task = await insertTask({ assignee_id: dana })
    await db.query('delete from auth.users where id = $1', [dana])
    const r = await db.query('select assignee_id from public.tasks where id = $1', [task.id])
    expect(r.rows[0]).toEqual({ assignee_id: null })
  })

  it('does not let a user who created tasks be deleted, so the history keeps its author', async () => {
    const dana = await addUser(db, 'dana@example.com', { appMeta: { role: 'employee' } })
    await insertTask({}, dana)
    await expect(db.query('delete from auth.users where id = $1', [dana])).rejects.toThrow(/foreign key/i)
  })

  it('clears the pickup thumbnail when that attachment is deleted', async () => {
    const task = await insertTask({ kind: 'pickup' })
    const attachment = await insertAttachment(task.id as string, { kind: 'product' })
    await db.query('update public.tasks set thumb_attachment_id = $1 where id = $2', [attachment, task.id])
    await db.query('delete from public.attachments where id = $1', [attachment])
    const r = await db.query('select thumb_attachment_id from public.tasks where id = $1', [task.id])
    expect(r.rows[0]).toEqual({ thumb_attachment_id: null })
  })

  it('removes the attachments and the history together with a task', async () => {
    const task = await insertTask()
    await insertAttachment(task.id as string)
    await db.query(`insert into public.task_events (task_id, type) values ($1, 'updated')`, [task.id])
    await db.query('delete from public.tasks where id = $1', [task.id])
    const a = await db.query('select count(*)::int as n from public.attachments where task_id = $1', [task.id])
    const e = await db.query('select count(*)::int as n from public.task_events where task_id = $1', [task.id])
    expect(a.rows[0]).toEqual({ n: 0 })
    expect(e.rows[0]).toEqual({ n: 0 })
  })
})

describe('legacy_id', () => {
  it('lets many tasks have none', async () => {
    await insertTask({ legacy_id: null })
    await insertTask({ legacy_id: null })
  })

  it('refuses a second task with the same old id, which is what stops a double import', async () => {
    await insertTask({ legacy_id: 'L-100' })
    await expect(insertTask({ legacy_id: 'L-100' })).rejects.toThrow(/duplicate key/i)
  })
})
