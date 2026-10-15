import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SHIP_METHODS,
  KIND_LABEL,
  PRIORITIES,
  PRIORITY_LABEL,
  SERVER_OWNED_FIELDS,
  TASK_KINDS,
  newTask,
  taskToPatch,
} from './model'

describe('newTask', () => {
  it('starts with the defaults of the database', () => {
    expect(newTask('user-1', 'task-1')).toMatchObject({
      id: 'task-1',
      kind: 'general',
      created_by: 'user-1',
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
    })
  })

  it('makes a new id for every task, unless the caller supplies one', () => {
    const first = newTask('user-1')
    const second = newTask('user-1')
    expect(first.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(second.id).not.toBe(first.id)
    expect(newTask('user-1', 'chosen').id).toBe('chosen')
  })

  it('stamps the creation and the last change with the same moment', () => {
    const before = Date.now()
    const task = newTask('user-1')
    expect(task.created_at).toBe(task.updated_at)
    expect(Date.parse(task.created_at)).toBeGreaterThanOrEqual(before)
    expect(Date.parse(task.created_at)).toBeLessThanOrEqual(Date.now())
  })
})

describe('taskToPatch', () => {
  it('carries every field of the task except the ones that the database keeps itself', () => {
    const task = newTask('user-1', 'task-1')
    const patch = taskToPatch(task)
    expect(Object.keys(patch).sort()).toEqual(Object.keys(task).filter((field) => !SERVER_OWNED_FIELDS.has(field)).sort())
    for (const field of ['id', 'created_by', 'created_at', 'updated_at', 'done_by', 'customer_phone_digits']) {
      expect(patch).not.toHaveProperty(field)
    }
  })

  it('keeps the values, including the empty ones and null, because a new task is sent whole', () => {
    const patch = taskToPatch({ ...newTask('user-1', 'task-1'), title: 'x', assignee_id: null, notes: '' })
    expect(patch).toMatchObject({ title: 'x', assignee_id: null, notes: '', status_key: 'processing', duration_min: 30 })
  })

  it('does not change the task it was given', () => {
    const task = newTask('user-1', 'task-1')
    const before = structuredClone(task)
    taskToPatch(task)
    expect(task).toEqual(before)
  })
})

describe('the Hebrew labels', () => {
  it('name every kind and every priority', () => {
    expect(Object.keys(KIND_LABEL).sort()).toEqual([...TASK_KINDS].sort())
    expect(Object.keys(PRIORITY_LABEL).sort()).toEqual([...PRIORITIES].sort())
    for (const label of [...Object.values(KIND_LABEL), ...Object.values(PRIORITY_LABEL)]) {
      expect(label).toMatch(/[א-ת]/)
    }
    expect(new Set(Object.values(PRIORITY_LABEL)).size).toBe(PRIORITIES.length)
  })

  it('call the second priority "דחוף", the flag of the old app', () => {
    expect(PRIORITY_LABEL.high).toBe('דחוף')
  })
})

describe('DEFAULT_SHIP_METHODS', () => {
  it('are the four ways of the old app', () => {
    expect(DEFAULT_SHIP_METHODS).toEqual(['איסוף עצמי', 'משלוח עד הבית', 'נקודת איסוף', 'CARGO'])
  })
})
