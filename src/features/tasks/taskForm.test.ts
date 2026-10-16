import { describe, expect, it } from 'vitest'
import { newTask, type Task } from './model'
import { changedFields, isDirty, mergeRemote, normalizedTask, toDraft, type Draft } from './taskForm'

function task(patch: Partial<Task> = {}): Task {
  return {
    ...newTask('u-dana', 'a'),
    created_at: '2026-10-01T08:00:00.000Z',
    updated_at: '2026-10-01T08:00:00.000Z',
    title: 'לחזור ללקוח',
    customer_name: 'רונית כהן',
    no_glassix: true,
    ...patch,
  }
}

/** The draft of a task, with some of its fields typed over. */
function typed(base: Task, over: Partial<Task> = {}, due: Partial<Pick<Draft, 'dueDate' | 'dueTime'>> = {}): Draft {
  const draft = toDraft(base)
  return { ...draft, task: { ...draft.task, ...over }, ...due }
}

describe('toDraft', () => {
  it('copies the fields, and shows the due moment as a date and a time on the wall in Jerusalem', () => {
    const base = task({ due_at: '2026-10-16T06:00:00.000Z', notes: 'x' })
    const draft = toDraft(base)
    expect(draft.task).toEqual(base)
    expect(draft).toMatchObject({ dueDate: '2026-10-16', dueTime: '09:00' })
  })

  it('has no date and no time for a task without a due moment', () => {
    expect(toDraft(task({ due_at: null }))).toMatchObject({ dueDate: '', dueTime: '' })
  })

  it('is a copy: typing in the draft does not change the task', () => {
    const base = task()
    const draft = toDraft(base)
    draft.task.title = 'changed'
    expect(base.title).toBe('לחזור ללקוח')
  })
})

describe('normalizedTask', () => {
  it('trims the text fields, and takes the "#" off the order number', () => {
    const draft = typed(task(), { title: '  לטפל  ', customer_phone: ' 050-1 ', order_number: ' #1234 ', notes: ' a\n', ship_to: ' x ' })
    expect(normalizedTask(draft)).toMatchObject({
      title: 'לטפל',
      customer_phone: '050-1',
      order_number: '1234',
      notes: 'a',
      ship_to: 'x',
    })
    expect(normalizedTask(typed(task(), { order_number: '# 55' })).order_number).toBe('55')
    expect(normalizedTask(typed(task(), { order_number: 'AB#1' })).order_number).toBe('AB#1')
  })

  it('makes a title from the order number or the name of the customer, when there is none', () => {
    expect(normalizedTask(typed(task(), { title: '', order_number: '#1234' })).title).toBe('טיפול בהזמנה #1234')
    expect(normalizedTask(typed(task(), { title: ' ', order_number: '', customer_name: 'רונית' })).title).toBe('לחזור אל רונית')
  })

  it('turns the date and the time into the due moment: 09:00 without a time, none without a date', () => {
    expect(normalizedTask(typed(task(), {}, { dueDate: '2026-10-16', dueTime: '' })).due_at).toBe('2026-10-16T06:00:00.000Z')
    expect(normalizedTask(typed(task(), {}, { dueDate: '2026-10-16', dueTime: '14:30' })).due_at).toBe('2026-10-16T11:30:00.000Z')
    expect(normalizedTask(typed(task({ due_at: '2026-10-16T06:00:00.000Z' }), {}, { dueDate: '', dueTime: '' })).due_at).toBeNull()
  })

  it('refuses a date that cannot exist, and leaves the draft as it was', () => {
    const draft = typed(task(), { title: ' x ' }, { dueDate: '2026-02-30', dueTime: '' })
    expect(() => normalizedTask(draft)).toThrow()
    expect(draft.task.title).toBe(' x ')
  })
})

describe('changedFields', () => {
  it('is nothing when nothing was touched', () => {
    const base = task({ due_at: '2026-10-16T06:00:00.000Z' })
    expect(changedFields(base, toDraft(base))).toEqual({})
  })

  it('holds exactly the field that was typed over', () => {
    const base = task()
    expect(changedFields(base, typed(base, { notes: 'a note' }))).toEqual({ notes: 'a note' })
  })

  it.each([
    ['kind', { kind: 'delivery' }],
    ['priority', { priority: 'urgent' }],
    ['status_key', { status_key: 'cargo' }],
    ['assignee_id', { assignee_id: 'u-owner' }],
    ['duration_min', { duration_min: 60 }],
    ['remind_min', { remind_min: 10 }],
    ['no_glassix', { no_glassix: false }],
    ['sent_to_cargo', { sent_to_cargo: true }],
    ['customer_name', { customer_name: 'אחר' }],
    ['customer_phone', { customer_phone: '050' }],
    ['service_call_number', { service_call_number: '77' }],
    ['glassix_conversation_id', { glassix_conversation_id: 'gx-1' }],
    ['cargo_number', { cargo_number: 'CG-1' }],
    ['product_name', { product_name: 'מקרר' }],
    ['product_sku', { product_sku: 'SKU-1' }],
    ['ship_method', { ship_method: 'CARGO' }],
    ['ship_status', { ship_status: 'נשלח' }],
    ['order_date', { order_date: '2026-10-01' }],
    ['billing', { billing: 'אשראי' }],
    ['ship_to', { ship_to: 'רחוב 1' }],
  ] as Array<[string, Partial<Task>]>)('carries %s when it is changed', (field, over) => {
    const base = task()
    expect(Object.keys(changedFields(base, typed(base, over)))).toEqual([field])
  })

  it('carries the new text with the "#" taken off the order number, and not the title that was not touched', () => {
    const base = task({ title: 'כותרת' })
    expect(changedFields(base, typed(base, { order_number: '#77' }))).toEqual({ order_number: '77' })
  })

  it('leaves out an order number that was not touched, though it has a "#" from the old app', () => {
    const base = task({ order_number: '#555' })
    expect(changedFields(base, typed(base, { notes: 'x' }))).toEqual({ notes: 'x' })
  })

  it('leaves out a change that comes to nothing once the text is trimmed', () => {
    const base = task({ title: 'כותרת' })
    expect(changedFields(base, typed(base, { title: 'כותרת  ' }))).toEqual({})
  })

  it('makes a title when the title is cleared and there is an order number', () => {
    const base = task({ title: 'כותרת', order_number: '99' })
    expect(changedFields(base, typed(base, { title: '' }))).toEqual({ title: 'טיפול בהזמנה #99' })
  })

  it('carries the due moment when the date or the time is changed, null when the date is cleared, and not otherwise', () => {
    const base = task({ due_at: '2026-10-16T06:00:00.000Z' })
    expect(changedFields(base, typed(base, {}, { dueDate: '2026-10-17' }))).toEqual({ due_at: '2026-10-17T06:00:00.000Z' })
    expect(changedFields(base, typed(base, {}, { dueTime: '14:30' }))).toEqual({ due_at: '2026-10-16T11:30:00.000Z' })
    expect(changedFields(base, typed(base, {}, { dueDate: '', dueTime: '' }))).toEqual({ due_at: null })
    expect(changedFields(task(), typed(task(), {}, { dueDate: '2026-10-17', dueTime: '08:00' }))).toEqual({ due_at: '2026-10-17T05:00:00.000Z' })
    expect(changedFields(base, typed(base, { notes: 'x' }))).not.toHaveProperty('due_at')
  })

  it('does not carry the due moment when the time is cleared on a task that is due at the usual 09:00, because it comes to the same moment', () => {
    const base = task({ due_at: '2026-10-16T06:00:00.000Z' })
    expect(changedFields(base, typed(base, {}, { dueTime: '' }))).toEqual({})
  })

  it('never carries what the card does not edit or what the server keeps', () => {
    const base = task()
    const draft = typed(base, {
      id: 'other',
      done_at: '2026-10-02T00:00:00.000Z',
      deleted_at: '2026-10-02T00:00:00.000Z',
      thumb_attachment_id: 'x',
      created_by: 'someone',
      updated_at: '2030-01-01T00:00:00.000Z',
      customer_phone_digits: '123',
      legacy_id: 'L1',
    })
    expect(changedFields(base, draft)).toEqual({})
  })
})

describe('isDirty', () => {
  it('is false for a draft that was not touched, and true for any field that was', () => {
    const base = task({ due_at: '2026-10-16T06:00:00.000Z' })
    expect(isDirty(base, toDraft(base))).toBe(false)
    expect(isDirty(base, typed(base, { notes: 'x' }))).toBe(true)
    expect(isDirty(base, typed(base, {}, { dueDate: '2026-10-20' }))).toBe(true)
    expect(isDirty(base, typed(base, {}, { dueTime: '10:00' }))).toBe(true)
  })

  it('counts a space typed at the end as a change, because the person did type something', () => {
    const base = task()
    expect(isDirty(base, typed(base, { title: `${base.title} ` }))).toBe(true)
  })

  it('does not count a change of what the card does not edit', () => {
    const base = task()
    expect(isDirty(base, typed(base, { done_at: '2026-10-02T00:00:00.000Z' }))).toBe(false)
  })
})

describe('mergeRemote', () => {
  const before = task({ notes: 'old notes', status_key: 'processing', title: 'old title' })

  it('shows the fields that somebody else changed, where the person has typed nothing', () => {
    const draft = toDraft(before)
    const after = task({ notes: 'new notes', status_key: 'cargo', title: 'old title' })
    const merged = mergeRemote(draft, before, after)
    expect(merged.task).toMatchObject({ notes: 'new notes', status_key: 'cargo', title: 'old title' })
  })

  it('keeps what the person typed, even when somebody else changed the same field', () => {
    const draft = typed(before, { notes: 'my notes' })
    const after = task({ notes: 'their notes', status_key: 'cargo', title: 'old title' })
    const merged = mergeRemote(draft, before, after)
    expect(merged.task.notes).toBe('my notes')
    expect(merged.task.status_key).toBe('cargo')
  })

  it('takes what the card does not edit from the new version', () => {
    const draft = toDraft(before)
    const after = task({ done_at: '2026-10-02T00:00:00.000Z', updated_at: '2026-10-02T00:00:00.000Z', thumb_attachment_id: 'p1' })
    const merged = mergeRemote(draft, before, after)
    expect(merged.task).toMatchObject({ done_at: '2026-10-02T00:00:00.000Z', updated_at: '2026-10-02T00:00:00.000Z', thumb_attachment_id: 'p1' })
  })

  it('follows the date and the time one by one', () => {
    const base = task({ due_at: '2026-10-16T06:00:00.000Z' })
    const after = task({ due_at: '2026-10-20T07:00:00.000Z' })
    expect(mergeRemote(toDraft(base), base, after)).toMatchObject({ dueDate: '2026-10-20', dueTime: '10:00' })
    expect(mergeRemote(typed(base, {}, { dueTime: '15:00' }), base, after)).toMatchObject({ dueDate: '2026-10-20', dueTime: '15:00' })
    expect(mergeRemote(typed(base, {}, { dueDate: '2026-10-30' }), base, after)).toMatchObject({ dueDate: '2026-10-30', dueTime: '10:00' })
  })

  it('counts a field that was typed back to what it was as not touched', () => {
    const draft = typed(before, { notes: 'x' })
    draft.task.notes = before.notes
    const merged = mergeRemote(draft, before, task({ notes: 'new notes' }))
    expect(merged.task.notes).toBe('new notes')
  })

  it('makes a new draft, and leaves the three it was given alone', () => {
    const draft = typed(before, { notes: 'mine' })
    const after = task({ notes: 'theirs', status_key: 'cargo' })
    const copies = structuredClone([draft, before, after])
    const merged = mergeRemote(draft, before, after)
    expect([draft, before, after]).toEqual(copies)
    expect(merged).not.toBe(draft)
    expect(merged.task).not.toBe(after)
  })
})
