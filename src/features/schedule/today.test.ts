import { describe, expect, it } from 'vitest'
import { newTask, type Task } from '../tasks/model'
import { buildToday, dueState, postponeTarget, todayBadge } from './today'

// The fixed moment of these tests is 12:00 in Jerusalem on Friday 2026-10-16 (09:00 UTC). The end of
// that day is 00:00 of the 17th, 21:00 UTC. A task is given by the hour on the wall in Jerusalem.

const ME = 'me'
const DANA = 'dana'
const NOW = new Date('2026-10-16T09:00:00Z')

let counter = 0
function task(over: Partial<Task> = {}): Task {
  return { ...newTask('creator', `t${String(++counter).padStart(3, '0')}`), created_at: '2026-10-01T00:00:00.000Z', assignee_id: ME, ...over }
}
const due = (iso: string, over: Partial<Task> = {}) => task({ due_at: iso, ...over })

const ids = (tasks: Task[]) => tasks.map((t) => t.id)

describe('dueState', () => {
  it.each([
    ['a done task, whatever its due time', { due_at: '2026-10-16T06:00:00Z', done_at: '2026-10-16T08:00:00Z' }, 'done'],
    ['a done task that never had a due time', { done_at: '2026-10-16T08:00:00Z' }, 'done'],
    ['a task without a due time', {}, 'none'],
    ['a task whose time has passed', { due_at: '2026-10-16T08:59:00Z' }, 'late'],
    ['a task due this very minute', { due_at: '2026-10-16T09:00:00Z' }, 'soon'],
    ['a task due in an hour', { due_at: '2026-10-16T10:00:00Z' }, 'soon'],
    ['a task due in an hour and a minute', { due_at: '2026-10-16T10:01:00Z' }, 'today'],
    ['a task due at the end of today', { due_at: '2026-10-16T20:59:00Z' }, 'today'],
    ['a task due at the start of tomorrow', { due_at: '2026-10-16T21:00:00Z' }, 'later'],
    ['a task due next week', { due_at: '2026-10-23T09:00:00Z' }, 'later'],
  ] as Array<[string, Partial<Task>, string]>)('%s is %s', (_what, over, state) => {
    expect(dueState(task(over), NOW)).toBe(state)
  })

  it('counts an hour ahead as soon even when it is past midnight', () => {
    // 23:30 in Jerusalem; a task at 00:15 is within the hour but is tomorrow's.
    expect(dueState(due('2026-10-16T21:15:00Z'), new Date('2026-10-16T20:30:00Z'))).toBe('soon')
  })
})

describe('buildToday: the counts', () => {
  const tasks = [
    due('2026-10-16T07:00:00Z', { id: 'late-2h' }), // 10:00, late
    due('2026-10-16T08:59:00Z', { id: 'late-1m' }), // 11:59, late
    due('2026-10-16T09:00:00Z', { id: 'now' }), // 12:00 exactly, not late
    due('2026-10-16T09:30:00Z', { id: 'soon' }), // 12:30
    due('2026-10-16T10:00:00Z', { id: 'soon-edge' }), // 13:00, exactly 60 minutes
    due('2026-10-16T10:01:00Z', { id: 'not-soon' }), // 13:01
    due('2026-10-16T20:59:00Z', { id: 'last-minute' }), // 23:59
    due('2026-10-16T21:00:00Z', { id: 'tomorrow' }), // 00:00 of the 17th
    task({ id: 'no-date-1' }),
    task({ id: 'no-date-2' }),
    due('2026-10-16T06:00:00Z', { id: 'done-late', done_at: '2026-10-16T08:00:00Z' }),
    due('2026-10-16T07:00:00Z', { id: 'deleted', deleted_at: '2026-10-16T08:00:00Z' }),
  ]

  it('counts what is late, what is left of today, what is within the hour, what has no date and what was done today', () => {
    const { counts } = buildToday(tasks, NOW, { meId: ME, mine: false })
    expect(counts).toEqual({ late: 2, remaining: 5, soon: 3, undated: 2, doneToday: 1 })
  })

  it('does not count a deleted task anywhere', () => {
    const view = buildToday([due('2026-10-16T07:00:00Z', { deleted_at: '2026-10-16T08:00:00Z', done_at: '2026-10-16T08:00:00Z' })], NOW, { meId: ME, mine: false })
    expect(view.counts).toEqual({ late: 0, remaining: 0, soon: 0, undated: 0, doneToday: 0 })
    expect(view.workload).toEqual([])
  })

  it('counts a task as done today by the day in Jerusalem and not by the day in UTC', () => {
    const doneAt = (iso: string) => buildToday([task({ done_at: iso })], NOW, { meId: ME, mine: false }).counts.doneToday
    expect(doneAt('2026-10-15T20:59:59Z')).toBe(0) // 23:59:59 yesterday
    expect(doneAt('2026-10-15T21:00:00Z')).toBe(1) // 00:00 today
    expect(doneAt('2026-10-16T20:59:59Z')).toBe(1) // 23:59:59 today
    expect(doneAt('2026-10-16T21:00:00Z')).toBe(0) // 00:00 tomorrow
  })

  it('only counts the tasks of the person when asked for "mine", and all of them otherwise', () => {
    const mixed = [
      due('2026-10-16T07:00:00Z', { assignee_id: ME }),
      due('2026-10-16T07:00:00Z', { assignee_id: DANA }),
      due('2026-10-16T07:00:00Z', { assignee_id: null }),
      task({ assignee_id: DANA }),
      task({ assignee_id: null, done_at: '2026-10-16T08:00:00Z' }),
    ]
    expect(buildToday(mixed, NOW, { meId: ME, mine: true }).counts).toEqual({ late: 1, remaining: 0, soon: 0, undated: 0, doneToday: 0 })
    expect(buildToday(mixed, NOW, { meId: ME, mine: false }).counts).toEqual({ late: 3, remaining: 0, soon: 0, undated: 1, doneToday: 1 })
  })

  it('has the day of Jerusalem on the day the clocks go back, which has 25 hours', () => {
    // 23:30 on 2026-10-25, after the clocks went back (UTC+2). Midnight is at 22:00 UTC.
    const now = new Date('2026-10-25T21:30:00Z')
    const view = buildToday(
      [due('2026-10-25T21:45:00Z', { id: 'before-midnight' }), due('2026-10-25T22:30:00Z', { id: 'after-midnight' })],
      now,
      { meId: ME, mine: false },
    )
    expect(ids(view.queue)).toEqual(['before-midnight'])
    expect(view.counts.remaining).toBe(1)
    // The task after midnight is within the hour, but it is not today's, so it is not "soon" either.
    expect(view.counts.soon).toBe(1)
  })

  it('has the day of Jerusalem on the day the clocks go forward, which has 23 hours', () => {
    // 00:30 on 2026-03-28 (UTC+3). Its midnight was at 21:00 UTC the day before.
    const now = new Date('2026-03-27T21:30:00Z')
    const view = buildToday(
      [due('2026-03-27T21:15:00Z', { id: 'just-late' }), due('2026-03-28T20:59:00Z', { id: 'last-minute' }), due('2026-03-28T21:00:00Z', { id: 'next-day' })],
      now,
      { meId: ME, mine: false },
    )
    expect(view.counts.late).toBe(1)
    expect(ids(view.queue)).toEqual(['just-late', 'last-minute'])
  })
})

describe('buildToday: the queue and the list without a date', () => {
  it('puts the late tasks first and the rest of today after them, each group by time', () => {
    const view = buildToday(
      [
        due('2026-10-16T12:00:00Z', { id: 'c' }),
        due('2026-10-16T07:30:00Z', { id: 'late-b' }),
        due('2026-10-16T09:30:00Z', { id: 'a' }),
        due('2026-10-16T07:00:00Z', { id: 'late-a' }),
        due('2026-10-17T07:00:00Z', { id: 'tomorrow' }),
      ],
      NOW,
      { meId: ME, mine: false },
    )
    expect(ids(view.queue)).toEqual(['late-a', 'late-b', 'a', 'c'])
  })

  it('settles a tie by the id, so that the order never jumps around', () => {
    const view = buildToday([due('2026-10-16T07:00:00Z', { id: 'z' }), due('2026-10-16T07:00:00Z', { id: 'a' })], NOW, { meId: ME, mine: false })
    expect(ids(view.queue)).toEqual(['a', 'z'])
  })

  it('leaves out the done tasks and, when asked for "mine", the tasks of others and of nobody', () => {
    const view = buildToday(
      [
        due('2026-10-16T07:00:00Z', { id: 'mine' }),
        due('2026-10-16T07:00:00Z', { id: 'dana', assignee_id: DANA }),
        due('2026-10-16T07:00:00Z', { id: 'nobody', assignee_id: null }),
        due('2026-10-16T07:00:00Z', { id: 'done', done_at: '2026-10-16T08:00:00Z' }),
      ],
      NOW,
      { meId: ME, mine: true },
    )
    expect(ids(view.queue)).toEqual(['mine'])
  })

  it('lists the open tasks without a date, the oldest first, and does not cut the list', () => {
    const view = buildToday(
      [
        task({ id: 'new', created_at: '2026-10-10T00:00:00.000Z' }),
        task({ id: 'old', created_at: '2026-10-01T00:00:00.000Z' }),
        task({ id: 'older-same-moment-b', created_at: '2026-09-01T00:00:00.000Z' }),
        task({ id: 'older-same-moment-a', created_at: '2026-09-01T00:00:00.000Z' }),
        task({ id: 'done', done_at: '2026-10-16T08:00:00Z' }),
        due('2026-10-17T07:00:00Z', { id: 'dated' }),
        ...Array.from({ length: 10 }, (_, i) => task({ id: `more-${i}`, created_at: '2026-10-11T00:00:00.000Z' })),
      ],
      NOW,
      { meId: ME, mine: false },
    )
    expect(view.undated).toHaveLength(14)
    expect(ids(view.undated).slice(0, 4)).toEqual(['older-same-moment-a', 'older-same-moment-b', 'old', 'new'])
    expect(view.counts.undated).toBe(14)
  })
})

describe('buildToday: the workload', () => {
  const tasks = [
    due('2026-10-16T07:00:00Z', { assignee_id: DANA }), // late
    due('2026-10-16T12:00:00Z', { assignee_id: DANA }), // today
    due('2026-10-17T12:00:00Z', { assignee_id: DANA }), // tomorrow
    due('2026-10-16T07:00:00Z', { assignee_id: ME }), // late
    task({ assignee_id: null }), // nobody, no date
    due('2026-10-16T12:00:00Z', { assignee_id: null }), // nobody, today
    due('2026-10-16T07:00:00Z', { assignee_id: DANA, done_at: '2026-10-16T08:00:00Z' }), // done: not open
    due('2026-10-16T07:00:00Z', { assignee_id: DANA, deleted_at: '2026-10-16T08:00:00Z' }), // deleted
  ]

  it('counts the open tasks of each person, with those of nobody under "none"', () => {
    const { workload } = buildToday(tasks, NOW, { meId: ME, mine: false })
    expect(workload).toEqual([
      { key: DANA, open: 3, late: 1, today: 1 },
      { key: ME, open: 1, late: 1, today: 0 },
      { key: 'none', open: 2, late: 0, today: 1 },
    ])
  })

  it('is the same for everybody whatever the switch says', () => {
    expect(buildToday(tasks, NOW, { meId: ME, mine: true }).workload).toEqual(buildToday(tasks, NOW, { meId: ME, mine: false }).workload)
  })

  it('puts the person with the most late tasks first, then the one with the most open tasks', () => {
    const { workload } = buildToday(
      [
        ...Array.from({ length: 5 }, () => task({ assignee_id: 'busy' })),
        ...Array.from({ length: 2 }, () => due('2026-10-16T07:00:00Z', { assignee_id: 'late-ones' })),
        due('2026-10-16T07:00:00Z', { assignee_id: 'one-late' }),
        ...Array.from({ length: 3 }, () => task({ assignee_id: 'three' })),
      ],
      NOW,
      { meId: ME, mine: false },
    )
    expect(workload.map((row) => row.key)).toEqual(['late-ones', 'one-late', 'busy', 'three'])
  })

  it('has no rows when there are no open tasks', () => {
    expect(buildToday([], NOW, { meId: ME, mine: false }).workload).toEqual([])
  })
})

describe('postponeTarget', () => {
  it('goes forward from now, and not from the old time, for a task that is late', () => {
    const late = due('2026-10-16T05:00:00Z') // 08:00
    expect(postponeTarget(late, '30', NOW)).toBe('2026-10-16T09:30:00.000Z')
    expect(postponeTarget(late, '60', NOW)).toBe('2026-10-16T10:00:00.000Z')
  })

  it('goes forward from the due time for a task that is still ahead', () => {
    const ahead = due('2026-10-16T12:00:00Z') // 15:00
    expect(postponeTarget(ahead, '30', NOW)).toBe('2026-10-16T12:30:00.000Z')
    expect(postponeTarget(ahead, '60', NOW)).toBe('2026-10-16T13:00:00.000Z')
  })

  it('moves a task twice when it is chosen twice', () => {
    const first = postponeTarget(due('2026-10-16T12:00:00Z'), '30', NOW)
    const second = postponeTarget(due(first), '30', NOW)
    expect(second).toBe('2026-10-16T13:00:00.000Z')
  })

  it('goes from now for a task without a due time', () => {
    expect(postponeTarget(task(), '30', NOW)).toBe('2026-10-16T09:30:00.000Z')
  })

  it('drops the seconds and the milliseconds', () => {
    expect(postponeTarget(task(), '30', new Date('2026-10-16T09:00:42.500Z'))).toBe('2026-10-16T09:30:00.000Z')
    expect(postponeTarget(due('2026-10-16T12:00:59.999Z'), '60', NOW)).toBe('2026-10-16T13:00:00.000Z')
  })

  it('puts "tomorrow" at 09:00 on the next day in Jerusalem, from now and not from the due time', () => {
    const far = due('2026-10-30T12:00:00Z')
    expect(postponeTarget(far, 'tomorrow', NOW)).toBe('2026-10-17T06:00:00.000Z')
    expect(postponeTarget(task(), 'tomorrow', new Date('2026-10-16T20:50:00Z'))).toBe('2026-10-17T06:00:00.000Z') // asked at 23:50
    expect(postponeTarget(task(), 'tomorrow', new Date('2026-10-16T21:10:00Z'))).toBe('2026-10-18T06:00:00.000Z') // asked at 00:10 of the 17th
  })

  it('puts "tomorrow" at 09:00 by the clock that is in force on that day when the clocks change', () => {
    expect(postponeTarget(task(), 'tomorrow', new Date('2026-10-24T09:00:00Z'))).toBe('2026-10-25T07:00:00.000Z') // UTC+2 from 02:00
    expect(postponeTarget(task(), 'tomorrow', new Date('2026-03-26T09:00:00Z'))).toBe('2026-03-27T06:00:00.000Z') // UTC+3 from 02:00
  })
})

describe('todayBadge', () => {
  const tasks = [
    due('2026-10-16T07:00:00Z'), // mine, late
    due('2026-10-16T12:00:00Z'), // mine, today
    due('2026-10-16T20:59:00Z'), // mine, today
    due('2026-10-16T21:00:00Z'), // mine, tomorrow
    task(), // mine, no date
    due('2026-10-16T12:00:00Z', { done_at: '2026-10-16T08:00:00Z' }), // done
    due('2026-10-16T12:00:00Z', { deleted_at: '2026-10-16T08:00:00Z' }), // deleted
    due('2026-10-16T07:00:00Z', { assignee_id: DANA }), // somebody else's, late
  ]

  it('counts the open tasks of the person that are due before the end of today, the late ones included', () => {
    expect(todayBadge(tasks, NOW, ME)).toEqual({ count: 3, late: true })
  })

  it('is not late when nothing of the person is late, whatever others have', () => {
    expect(todayBadge(tasks.slice(1), NOW, ME)).toEqual({ count: 2, late: false })
  })

  it('does not call a task that is due this very minute late', () => {
    expect(todayBadge([due('2026-10-16T09:00:00Z')], NOW, ME)).toEqual({ count: 1, late: false })
  })

  it('is zero and not late when there is nothing', () => {
    expect(todayBadge([], NOW, ME)).toEqual({ count: 0, late: false })
  })
})
