import { describe, expect, it } from 'vitest'
import { newTask, type Task } from './model'
import { MY_OPEN_TASKS, filterTasks, isOverdue, paginate, sortByChoice, sortTasks, statusCounts, type SortChoice, type TaskFilter } from './selectors'

const ME = 'user-me'

function task(id: string, patch: Partial<Task> = {}): Task {
  return { ...newTask('user-1', id), no_glassix: true, title: `task ${id}`, ...patch }
}

const everything: TaskFilter = { statusKey: null, assignee: 'all', shipMethod: null, state: 'all', text: '' }
const ids = (tasks: Task[]) => tasks.map((t) => t.id)

describe('filterTasks', () => {
  const tasks = [
    task('a', { status_key: 'processing', assignee_id: ME, ship_method: 'CARGO' }),
    task('b', { status_key: 'cargo', assignee_id: 'user-2', ship_method: 'איסוף עצמי', done_at: '2026-10-10T10:00:00Z' }),
    task('c', { status_key: 'processing', assignee_id: null, ship_method: 'CARGO' }),
    task('d', { status_key: 'processing', assignee_id: ME, deleted_at: '2026-10-11T10:00:00Z' }),
  ]

  it('gives every task that is not deleted when nothing is asked for', () => {
    expect(ids(filterTasks(tasks, everything, ME))).toEqual(['a', 'b', 'c'])
  })

  it('never shows a deleted task', () => {
    expect(ids(filterTasks(tasks, { ...everything, assignee: ME }, ME))).toEqual(['a'])
    expect(ids(filterTasks(tasks, { ...everything, state: 'open' }, ME))).not.toContain('d')
  })

  it('filters by status', () => {
    expect(ids(filterTasks(tasks, { ...everything, statusKey: 'cargo' }, ME))).toEqual(['b'])
    expect(ids(filterTasks(tasks, { ...everything, statusKey: 'processing' }, ME))).toEqual(['a', 'c'])
    expect(ids(filterTasks(tasks, { ...everything, statusKey: 'unknown' }, ME))).toEqual([])
  })

  it('filters by assignee: me, everybody, a person, or nobody', () => {
    expect(ids(filterTasks(tasks, { ...everything, assignee: 'me' }, ME))).toEqual(['a'])
    expect(ids(filterTasks(tasks, { ...everything, assignee: 'all' }, ME))).toEqual(['a', 'b', 'c'])
    expect(ids(filterTasks(tasks, { ...everything, assignee: 'user-2' }, ME))).toEqual(['b'])
    expect(ids(filterTasks(tasks, { ...everything, assignee: 'none' }, ME))).toEqual(['c'])
  })

  it('filters by shipping method', () => {
    expect(ids(filterTasks(tasks, { ...everything, shipMethod: 'CARGO' }, ME))).toEqual(['a', 'c'])
    expect(ids(filterTasks(tasks, { ...everything, shipMethod: 'איסוף עצמי' }, ME))).toEqual(['b'])
  })

  it('filters by open, done or all', () => {
    expect(ids(filterTasks(tasks, { ...everything, state: 'open' }, ME))).toEqual(['a', 'c'])
    expect(ids(filterTasks(tasks, { ...everything, state: 'done' }, ME))).toEqual(['b'])
  })

  it('combines the filters', () => {
    expect(ids(filterTasks(tasks, { ...everything, statusKey: 'processing', assignee: 'me', state: 'open' }, ME))).toEqual(['a'])
    expect(ids(filterTasks(tasks, { ...everything, statusKey: 'processing', assignee: 'me', state: 'done' }, ME))).toEqual([])
  })

  it('does not change the list it was given', () => {
    const copy = structuredClone(tasks)
    filterTasks(tasks, { ...everything, statusKey: 'cargo' }, ME)
    expect(tasks).toEqual(copy)
  })

  describe('text', () => {
    const found = (text: string, list: Task[]) => ids(filterTasks(list, { ...everything, text }, ME))

    it('looks in the fields that the search on the server looks in', () => {
      const list = [
        task('title', { title: 'לחזור אל דנה' }),
        task('name', { title: 'x', customer_name: 'אבי כהן' }),
        task('order', { title: 'x', order_number: '90210' }),
        task('call', { title: 'x', service_call_number: 'SC-77' }),
        task('glassix', { title: 'x', glassix_conversation_id: 'c-4821' }),
        task('cargo', { title: 'x', cargo_number: 'CG-555' }),
        task('sku', { title: 'x', product_sku: 'SKU-A1' }),
        task('other', { title: 'x', notes: 'דנה כהן', ship_to: 'אבי' }),
      ]
      expect(found('דנה', list)).toEqual(['title'])
      expect(found('כהן', list)).toEqual(['name'])
      expect(found('9021', list)).toEqual(['order'])
      expect(found('sc-77', list)).toEqual(['call'])
      expect(found('C-4821', list)).toEqual(['glassix'])
      expect(found('cg-555', list)).toEqual(['cargo'])
      expect(found('sku-a1', list)).toEqual(['sku'])
    })

    it('finds a phone number however it is written, by its digits', () => {
      const list = [
        task('p1', { customer_phone: '050-123 4567', customer_phone_digits: '0501234567' }),
        task('p2', { customer_phone: '+972 52 999 8888', customer_phone_digits: '972529998888' }),
      ]
      for (const written of ['050-123 4567', '+972 50 123 4567', '0501234567', '(050) 123-4567']) {
        expect(found(written, list), written).toEqual(['p1'])
      }
      expect(found('052-999 8888', list)).toEqual(['p2'])
    })

    it('uses the phone of a task that has not reached the server yet', () => {
      // The database makes the digits; a task that is only here does not have them.
      const local = task('local', { customer_phone: '050-123 4567', customer_phone_digits: '' })
      expect(found('0501234567', [local])).toEqual(['local'])
    })

    it('ignores case and surrounding space, and treats % and quotes as ordinary characters', () => {
      const list = [task('a', { title: 'Order 100% "done"' }), task('b', { title: 'something else' })]
      expect(found('  ORDER  ', list)).toEqual(['a'])
      expect(found('%', list)).toEqual(['a'])
      expect(found('"done"', list)).toEqual(['a'])
    })

    it('does not filter for text that is empty or only spaces', () => {
      const list = [task('a'), task('b')]
      expect(found('', list)).toEqual(['a', 'b'])
      expect(found('   ', list)).toEqual(['a', 'b'])
    })
  })
})

describe('MY_OPEN_TASKS', () => {
  // What the tasks screen shows at first, and the number on its tab.
  it('is the tasks of the person that are not done and not deleted', () => {
    const tasks = [
      task('mine', { assignee_id: ME }),
      task('theirs', { assignee_id: 'user-2' }),
      task('nobodys', { assignee_id: null }),
      task('done', { assignee_id: ME, done_at: '2026-10-10T10:00:00Z' }),
      task('deleted', { assignee_id: ME, deleted_at: '2026-10-11T10:00:00Z' }),
    ]
    expect(ids(filterTasks(tasks, MY_OPEN_TASKS, ME))).toEqual(['mine'])
  })
})

describe('sortTasks', () => {
  const dated = (id: string, due: string | null, extra: Partial<Task> = {}) => task(id, { due_at: due, ...extra })

  it('puts the earliest due date first and the tasks without a date last', () => {
    const list = [dated('late', '2026-10-20T10:00:00Z'), dated('none', null), dated('soon', '2026-10-16T10:00:00Z')]
    expect(ids(sortTasks(list, 'due', 'asc'))).toEqual(['soon', 'late', 'none'])
  })

  it('keeps the tasks without a date last when the order is reversed', () => {
    const list = [dated('late', '2026-10-20T10:00:00Z'), dated('none', null), dated('soon', '2026-10-16T10:00:00Z')]
    expect(ids(sortTasks(list, 'due', 'desc'))).toEqual(['late', 'soon', 'none'])
  })

  it('puts open tasks before done ones when sorting by due date', () => {
    const list = [
      dated('done-early', '2026-10-01T10:00:00Z', { done_at: '2026-10-01T11:00:00Z' }),
      dated('open-late', '2026-10-30T10:00:00Z'),
    ]
    expect(ids(sortTasks(list, 'due', 'asc'))).toEqual(['open-late', 'done-early'])
  })

  it('sorts by title in Hebrew order, numbers by value', () => {
    const list = [task('1', { title: 'תיק 10' }), task('2', { title: 'אבא' }), task('3', { title: 'תיק 9' })]
    expect(ids(sortTasks(list, 'title', 'asc'))).toEqual(['2', '3', '1'])
    expect(ids(sortTasks(list, 'title', 'desc'))).toEqual(['1', '3', '2'])
  })

  it('sorts by the time of the last change', () => {
    const list = [
      task('old', { updated_at: '2026-10-01T10:00:00Z' }),
      task('new', { updated_at: '2026-10-09T10:00:00Z' }),
      task('mid', { updated_at: '2026-10-05T10:00:00Z' }),
    ]
    expect(ids(sortTasks(list, 'updated', 'desc'))).toEqual(['new', 'mid', 'old'])
    expect(ids(sortTasks(list, 'updated', 'asc'))).toEqual(['old', 'mid', 'new'])
  })

  it('breaks a tie by the id, so that the order never jumps around', () => {
    const list = [dated('b', null), dated('a', null), dated('c', null)]
    expect(ids(sortTasks(list, 'due', 'asc'))).toEqual(['a', 'b', 'c'])
    expect(ids(sortTasks(list, 'due', 'desc'))).toEqual(['a', 'b', 'c'])
  })

  it('does not change the list it was given', () => {
    const list = [dated('b', '2026-10-20T10:00:00Z'), dated('a', '2026-10-16T10:00:00Z')]
    sortTasks(list, 'due', 'asc')
    expect(ids(list)).toEqual(['b', 'a'])
  })
})

describe('statusCounts', () => {
  it('counts the tasks of each status', () => {
    const list = [
      task('1', { status_key: 'processing' }),
      task('2', { status_key: 'processing' }),
      task('3', { status_key: 'cargo' }),
    ]
    expect(statusCounts(list)).toEqual({ processing: 2, cargo: 1 })
  })

  it('is empty for no tasks', () => {
    expect(statusCounts([])).toEqual({})
  })
})

describe('paginate', () => {
  const items = Array.from({ length: 250 }, (_, i) => i)

  it('gives pages of 100, numbered from 1', () => {
    const first = paginate(items, 1)
    expect(first).toMatchObject({ page: 1, pageCount: 3, total: 250 })
    expect(first.items).toHaveLength(100)
    expect(first.items[0]).toBe(0)
    expect(paginate(items, 2).items[0]).toBe(100)
    const last = paginate(items, 3)
    expect(last.items).toHaveLength(50)
    expect(last.items.at(-1)).toBe(249)
  })

  it('stays inside the pages when the page asked for is not there', () => {
    expect(paginate(items, 0).page).toBe(1)
    expect(paginate(items, -4).page).toBe(1)
    expect(paginate(items, 99)).toMatchObject({ page: 3, pageCount: 3 })
    expect(paginate(items, Number.NaN).page).toBe(1)
  })

  it('has one empty page for an empty list, and one page for exactly a hundred', () => {
    expect(paginate([], 1)).toEqual({ items: [], page: 1, pageCount: 1, total: 0 })
    expect(paginate(items.slice(0, 100), 1)).toMatchObject({ pageCount: 1, total: 100 })
    expect(paginate(items.slice(0, 101), 2).items).toEqual([100])
  })

  it('takes another page size', () => {
    expect(paginate(items, 2, 10)).toMatchObject({ page: 2, pageCount: 25 })
    expect(paginate(items, 2, 10).items[0]).toBe(10)
  })
})

describe('isOverdue', () => {
  const now = new Date('2026-10-15T12:00:00.000Z')

  it('is true for an open task whose time has passed', () => {
    expect(isOverdue(task('a', { due_at: '2026-10-15T11:59:59.000Z' }), now)).toBe(true)
    expect(isOverdue(task('a', { due_at: '2025-01-01T00:00:00.000Z' }), now)).toBe(true)
  })

  it('is false for a task that is not due yet, that is due this very moment, or that has no time', () => {
    expect(isOverdue(task('a', { due_at: '2026-10-15T12:00:01.000Z' }), now)).toBe(false)
    expect(isOverdue(task('a', { due_at: '2026-10-15T12:00:00.000Z' }), now)).toBe(false)
    expect(isOverdue(task('a', { due_at: null }), now)).toBe(false)
  })

  it('is false for a task that is done, however late it was', () => {
    expect(isOverdue(task('a', { due_at: '2026-10-01T00:00:00.000Z', done_at: '2026-10-02T00:00:00.000Z' }), now)).toBe(false)
  })
})

describe('sortByChoice', () => {
  const list = [
    task('a', { title: 'ב', due_at: '2026-10-16T06:00:00.000Z', updated_at: '2026-10-10T00:00:00.000Z' }),
    task('b', { title: 'א', due_at: '2026-10-15T06:00:00.000Z', updated_at: '2026-10-12T00:00:00.000Z' }),
    task('c', { title: 'ג', due_at: null, updated_at: '2026-10-11T00:00:00.000Z' }),
  ]
  const order = (choice: SortChoice) => ids(sortByChoice(list, choice))

  it('puts each choice in its order', () => {
    expect(order('due-asc')).toEqual(['b', 'a', 'c'])
    expect(order('due-desc')).toEqual(['a', 'b', 'c'])
    expect(order('title-asc')).toEqual(['b', 'a', 'c'])
    expect(order('updated-desc')).toEqual(['b', 'c', 'a'])
    expect(order('updated-asc')).toEqual(['a', 'c', 'b'])
  })

  it('does not change the list that it is given', () => {
    const before = ids(list)
    sortByChoice(list, 'updated-asc')
    expect(ids(list)).toEqual(before)
  })
})
