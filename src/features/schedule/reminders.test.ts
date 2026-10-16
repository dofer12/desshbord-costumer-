import { describe, expect, it } from 'vitest'
import { newTask, type Task } from '../tasks/model'
import {
  activeReminders,
  isReminderTask,
  nextFreeId,
  notificationId,
  planNotifications,
  PLAN_HORIZON_MS,
  PLAN_MAX,
  reminderAt,
  SNOOZE_MS,
  type Snoozed,
} from './reminders'

// The moment of these tests is 12:00 in Jerusalem on 2026-10-16 (09:00 UTC).

const ME = 'me'
const NOW = new Date('2026-10-16T09:00:00Z')
const MIN = 60_000

let counter = 0
function task(over: Partial<Task> = {}): Task {
  return { ...newTask('creator', `t${String(++counter).padStart(3, '0')}`), assignee_id: ME, title: 'להתקשר ללקוח', ...over }
}
/** A task of the signed-in person that is due at an ISO moment with a reminder that many minutes before. */
const remind = (dueAt: string, minutes: number, over: Partial<Task> = {}) => task({ due_at: dueAt, remind_min: minutes, ...over })

describe('reminderAt', () => {
  it('is the due time minus the reminder', () => {
    expect(reminderAt(remind('2026-10-16T12:00:00Z', 15))?.toISOString()).toBe('2026-10-16T11:45:00.000Z')
    expect(reminderAt(remind('2026-10-16T12:00:00Z', 1440))?.toISOString()).toBe('2026-10-15T12:00:00.000Z')
  })

  it('is the due time itself for a reminder of zero minutes', () => {
    expect(reminderAt(remind('2026-10-16T12:00:00Z', 0))?.toISOString()).toBe('2026-10-16T12:00:00.000Z')
  })

  it('is nothing without a due time or without a reminder', () => {
    expect(reminderAt(task({ remind_min: 15 }))).toBeNull()
    expect(reminderAt(task({ due_at: '2026-10-16T12:00:00Z' }))).toBeNull()
  })
})

describe('isReminderTask', () => {
  const good = remind('2026-10-16T12:00:00Z', 15)

  it('is true for an open task of the person with a due time and a reminder, a reminder of zero included', () => {
    expect(isReminderTask(good, ME)).toBe(true)
    expect(isReminderTask(remind('2026-10-16T12:00:00Z', 0), ME)).toBe(true)
  })

  it.each([
    ['a done task', { done_at: '2026-10-16T08:00:00Z' }],
    ['a deleted task', { deleted_at: '2026-10-16T08:00:00Z' }],
    ["somebody else's task", { assignee_id: 'dana' }],
    ['a task of nobody', { assignee_id: null }],
    ['a task without a due time', { due_at: null }],
    ['a task without a reminder', { remind_min: null }],
  ] as Array<[string, Partial<Task>]>)('is false for %s', (_what, over) => {
    expect(isReminderTask({ ...good, ...over }, ME)).toBe(false)
  })
})

describe('activeReminders', () => {
  it('starts at the reminder time, inclusive, and not before', () => {
    expect(activeReminders([remind('2026-10-16T09:15:00Z', 15)], NOW, {}, ME)).toHaveLength(1)
    expect(activeReminders([remind('2026-10-16T09:16:00Z', 15)], NOW, {}, ME)).toHaveLength(0)
  })

  it('ends twelve hours after the due time, inclusive, and not after', () => {
    expect(activeReminders([remind('2026-10-15T21:00:00Z', 15)], NOW, {}, ME)).toHaveLength(1)
    expect(activeReminders([remind('2026-10-15T20:59:59Z', 15)], NOW, {}, ME)).toHaveLength(0)
  })

  it('hides a task while it is snoozed, and shows it again when the snooze is over', () => {
    const a = remind('2026-10-16T08:00:00Z', 15, { id: 'a' })
    const snoozed = (until: number): Snoozed => ({ a: until })
    expect(activeReminders([a], NOW, snoozed(NOW.getTime() + 1), ME)).toHaveLength(0)
    expect(activeReminders([a], NOW, snoozed(NOW.getTime()), ME)).toHaveLength(1)
    expect(activeReminders([a], NOW, snoozed(NOW.getTime() - 1), ME)).toHaveLength(1)
    // The snooze of another task does not hide this one.
    expect(activeReminders([a], NOW, { other: NOW.getTime() + SNOOZE_MS }, ME)).toHaveLength(1)
  })

  it('sorts by due time, and leaves out what is not a reminder of the person', () => {
    const list = activeReminders(
      [
        remind('2026-10-16T09:30:00Z', 60, { id: 'later' }),
        remind('2026-10-16T08:00:00Z', 15, { id: 'earlier' }),
        remind('2026-10-16T08:00:00Z', 15, { id: 'dana', assignee_id: 'dana' }),
        remind('2026-10-16T08:00:00Z', 15, { id: 'done', done_at: '2026-10-16T08:30:00Z' }),
        remind('2026-10-16T08:00:00Z', 15, { id: 'deleted', deleted_at: '2026-10-16T08:30:00Z' }),
        task({ id: 'plain', due_at: '2026-10-16T08:00:00Z' }),
      ],
      NOW,
      {},
      ME,
    )
    expect(list.map((t) => t.id)).toEqual(['earlier', 'later'])
  })
})

describe('notificationId', () => {
  it('is the same for the same task every time', () => {
    expect(notificationId('3f2c1a40-7a6e-4a0e-9f11-2b9d1e0f6a11')).toBe(notificationId('3f2c1a40-7a6e-4a0e-9f11-2b9d1e0f6a11'))
  })

  it('is a positive whole number that fits in 31 bits', () => {
    for (const id of ['a', 'b', 'task-1', '00000000-0000-4000-8000-000000000001', '', 'x'.repeat(500)]) {
      const n = notificationId(id)
      expect(Number.isInteger(n)).toBe(true)
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(2_147_483_647)
    }
  })

  it('differs between different tasks', () => {
    const ids = Array.from({ length: 200 }, (_, i) => notificationId(`task-${i}`))
    expect(new Set(ids).size).toBe(200)
  })

  it('moves on to the next free number when one is taken', () => {
    const first = notificationId('x')
    const second = notificationId('x', new Set([first]))
    expect(second).not.toBe(first)
    expect(second).toBeGreaterThanOrEqual(1)
    const third = notificationId('x', new Set([first, second]))
    expect(new Set([first, second, third]).size).toBe(3)
  })

})

describe('nextFreeId', () => {
  it('is the number itself when it is free', () => {
    expect(nextFreeId(7, new Set())).toBe(7)
    expect(nextFreeId(7, new Set([8]))).toBe(7)
  })

  it('walks up to the first free number', () => {
    expect(nextFreeId(7, new Set([7]))).toBe(8)
    expect(nextFreeId(7, new Set([7, 8, 9]))).toBe(10)
  })

  it('wraps from the top of the range to 1, and never leaves the range', () => {
    const top = 2_147_483_647
    expect(nextFreeId(top, new Set([top]))).toBe(1)
    expect(nextFreeId(top, new Set([top, 1, 2]))).toBe(3)
  })
})

describe('planNotifications', () => {
  it('plans a notification at the reminder time, with the title and the time of the task', () => {
    const plan = planNotifications([remind('2026-10-16T12:00:00Z', 15, { id: 'a', title: 'להתקשר ללקוח' })], NOW, {}, ME)
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ taskId: 'a', title: 'תזכורת: להתקשר ללקוח', body: 'היום · 15:00' })
    expect(plan[0].at.toISOString()).toBe('2026-10-16T11:45:00.000Z')
    expect(plan[0].id).toBe(notificationId('a'))
  })

  it('writes the day of the task as it will be when the notification arrives, not as it is when it is planned', () => {
    // Planned at 23:00 on the 16th for 09:00 on the 17th, for a task at 12:00 on the 17th: when it arrives
    // the task is "today", although at the moment of planning it was "tomorrow".
    const plan = planNotifications([remind('2026-10-17T09:00:00Z', 180, { id: 'a' })], new Date('2026-10-16T20:00:00Z'), {}, ME)
    expect(plan[0].at.toISOString()).toBe('2026-10-17T06:00:00.000Z')
    expect(plan[0].body).toBe('היום · 12:00')
  })

  it('writes "tomorrow" for a task of the day after the one on which the notification arrives', () => {
    const plan = planNotifications([remind('2026-10-18T06:00:00Z', 1440, { id: 'a' })], new Date('2026-10-16T21:00:00Z'), {}, ME)
    expect(plan[0].at.toISOString()).toBe('2026-10-17T06:00:00.000Z')
    expect(plan[0].body).toBe('מחר · 09:00')
  })

  it('says nothing but the title and the time: no customer, no phone, no order', () => {
    const plan = planNotifications(
      [remind('2026-10-16T12:00:00Z', 15, { title: 'לבדוק משלוח', customer_name: 'סוד כהן', customer_phone: '050-1234567', order_number: '900123', notes: 'פרטים אישיים' })],
      NOW,
      {},
      ME,
    )
    const text = `${plan[0].title} ${plan[0].body}`
    for (const secret of ['סוד', '050', '1234567', '900123', 'פרטים']) expect(text).not.toContain(secret)
  })

  it('names a task without a title by its order or its customer, or says that it has none', () => {
    const plan = planNotifications(
      [
        remind('2026-10-16T12:00:00Z', 15, { id: 'a', title: '', customer_name: 'דנה' }),
        remind('2026-10-16T12:05:00Z', 15, { id: 'b', title: '' }),
      ],
      NOW,
      {},
      ME,
    )
    expect(plan.map((p) => p.title)).toEqual(['תזכורת: לחזור אל דנה', 'תזכורת: ללא כותרת'])
  })

  it('keeps to the next 48 hours, the end included, and to the future', () => {
    const horizon = NOW.getTime() + 48 * 60 * MIN // 2026-10-18T09:00:00Z, written out so that a change of the constant is noticed
    expect(PLAN_HORIZON_MS).toBe(48 * 60 * MIN)
    const at = (ms: number) => new Date(ms).toISOString()
    const plan = planNotifications(
      [
        remind(at(horizon + 15 * MIN), 15, { id: 'at-the-edge' }),
        remind(at(horizon + 16 * MIN), 15, { id: 'too-far' }),
        remind(at(NOW.getTime() + 15 * MIN), 15, { id: 'right-now' }), // reminder time is now: not in the future
        remind(at(NOW.getTime() + 16 * MIN), 15, { id: 'in-a-minute' }),
      ],
      NOW,
      {},
      ME,
    )
    expect(plan.map((p) => p.taskId)).toEqual(['in-a-minute', 'at-the-edge'])
  })

  it('plans nothing for a task whose reminder time has passed, even when its due time is still ahead', () => {
    expect(planNotifications([remind('2026-10-16T09:10:00Z', 15)], NOW, {}, ME)).toEqual([])
  })

  it('plans at most 60, the earliest first', () => {
    expect(PLAN_MAX).toBe(60)
    const tasks = Array.from({ length: 70 }, (_, i) => remind(new Date(NOW.getTime() + (20 + i) * MIN).toISOString(), 15, { id: `n${String(i).padStart(3, '0')}` }))
    const plan = planNotifications([...tasks].reverse(), NOW, {}, ME)
    expect(plan).toHaveLength(60)
    expect(plan[0].taskId).toBe('n000')
    expect(plan.at(-1)?.taskId).toBe('n059')
    expect(planNotifications(tasks, NOW, {}, ME, { max: 5 })).toHaveLength(5)
  })

  it('is sorted by time, a tie settled by the id', () => {
    const plan = planNotifications(
      [remind('2026-10-16T13:00:00Z', 15, { id: 'z' }), remind('2026-10-16T12:00:00Z', 15, { id: 'late-in-list' }), remind('2026-10-16T13:00:00Z', 15, { id: 'a' })],
      NOW,
      {},
      ME,
    )
    expect(plan.map((p) => p.taskId)).toEqual(['late-in-list', 'a', 'z'])
  })

  it('plans a snoozed task once, at the end of the snooze, and not at its original time', () => {
    const t = remind('2026-10-16T09:10:00Z', 15, { id: 'a' }) // its reminder time (08:55) has passed
    const until = NOW.getTime() + SNOOZE_MS
    const plan = planNotifications([t], NOW, { a: until }, ME)
    expect(plan).toHaveLength(1)
    expect(plan[0].at.getTime()).toBe(until)
    // The text is about the due time as it reads when the notification arrives (at 12:10, ten minutes after the due time).
    expect(plan[0].body).toBe('היום · 12:10')
  })

  it('plans nothing for a snooze that is over and a reminder that has passed', () => {
    const t = remind('2026-10-16T09:10:00Z', 15, { id: 'a' })
    expect(planNotifications([t], NOW, { a: NOW.getTime() - 1 }, ME)).toEqual([])
    expect(planNotifications([t], NOW, { a: NOW.getTime() }, ME)).toEqual([])
  })

  it('keeps the original time when the snooze would end before it', () => {
    const t = remind('2026-10-16T12:00:00Z', 15, { id: 'a' }) // reminder 11:45
    const plan = planNotifications([t], NOW, { a: NOW.getTime() + SNOOZE_MS }, ME)
    expect(plan[0].at.toISOString()).toBe('2026-10-16T11:45:00.000Z')
  })

  it('does not plan a snooze that would end more than twelve hours after the due time', () => {
    const t = remind('2026-10-15T21:00:00Z', 15, { id: 'a' }) // due 12 hours ago
    expect(planNotifications([t], NOW, { a: NOW.getTime() + SNOOZE_MS }, ME)).toEqual([])
  })

  it('plans only the tasks of the person who is signed in', () => {
    const plan = planNotifications(
      [
        remind('2026-10-16T12:00:00Z', 15, { id: 'mine' }),
        remind('2026-10-16T12:00:00Z', 15, { id: 'dana', assignee_id: 'dana' }),
        remind('2026-10-16T12:00:00Z', 15, { id: 'nobody', assignee_id: null }),
      ],
      NOW,
      {},
      ME,
    )
    expect(plan.map((p) => p.taskId)).toEqual(['mine'])
    expect(planNotifications([remind('2026-10-16T12:00:00Z', 15, { id: 'mine' })], NOW, {}, 'someone-else')).toEqual([])
  })

  it('gives every notification of a plan its own id, the same ids as the next time', () => {
    const tasks = Array.from({ length: 40 }, (_, i) => remind(new Date(NOW.getTime() + (20 + i) * MIN).toISOString(), 15, { id: `t-${i}` }))
    const first = planNotifications(tasks, NOW, {}, ME)
    expect(new Set(first.map((p) => p.id)).size).toBe(40)
    expect(planNotifications(tasks, NOW, {}, ME)).toEqual(first)
  })

  it('gives different numbers to two tasks whose ids happen to hash alike', () => {
    // Two ids found by searching: they have the same number, which is what the plan has to untangle.
    const [a, b] = ['bvnmq6-pbi', '1kb9cwt-10h9']
    expect(notificationId(a)).toBe(notificationId(b))
    const plan = planNotifications(
      [remind('2026-10-16T12:00:00Z', 15, { id: a }), remind('2026-10-16T13:00:00Z', 15, { id: b })],
      NOW,
      {},
      ME,
    )
    expect(plan.map((p) => p.taskId)).toEqual([a, b])
    expect(plan[0].id).toBe(notificationId(a))
    expect(plan[1].id).toBe(notificationId(a) + 1)
  })

  it('follows a change of the task: a new time moves it, and done, deleted, reassigned or no reminder take it out', () => {
    const base = remind('2026-10-16T12:00:00Z', 15, { id: 'a' })
    const planned = (t: Task) => planNotifications([t], NOW, {}, ME)
    expect(planned(base)[0].at.toISOString()).toBe('2026-10-16T11:45:00.000Z')
    expect(planned({ ...base, due_at: '2026-10-16T13:00:00Z' })[0].at.toISOString()).toBe('2026-10-16T12:45:00.000Z')
    expect(planned({ ...base, remind_min: 30 })[0].at.toISOString()).toBe('2026-10-16T11:30:00.000Z')
    expect(planned({ ...base, done_at: '2026-10-16T09:00:00Z' })).toEqual([])
    expect(planned({ ...base, deleted_at: '2026-10-16T09:00:00Z' })).toEqual([])
    expect(planned({ ...base, assignee_id: 'dana' })).toEqual([])
    expect(planned({ ...base, remind_min: null })).toEqual([])
    expect(planned({ ...base, due_at: null })).toEqual([])
  })
})
