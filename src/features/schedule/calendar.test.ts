import { describe, expect, it } from 'vitest'
import { newTask, type Task } from '../tasks/model'
import { layoutRange, packDay, rangeStart, rangeTitle, shiftAnchor, slotToDue, type DayItem } from './calendar'

// The layout of the calendar, worked out from the tasks alone: where each task goes on its day, side by
// side with the ones it overlaps, and what a click on an empty place means. Every position is the
// wall clock of Jerusalem, whatever zone the machine is in.

const task = (id: string, patch: Partial<Task> = {}): Task => ({
  ...newTask('u-owner', id),
  title: id,
  assignee_id: 'u-dana',
  duration_min: 30,
  ...patch,
})

const item = (id: string, start: number, end: number): DayItem => ({ task: task(id), start, end })
const ids = (items: Array<{ task: Task }>) => items.map((placed) => placed.task.id)
const at = (hours: number, minutes = 0) => hours * 60 + minutes

describe('packDay', () => {
  it('gives each its own column when none of them overlap', () => {
    const placed = packDay([item('a', at(9), at(10)), item('b', at(11), at(12)), item('c', at(13), at(14))])
    expect(placed.map((p) => [p.task.id, p.column, p.columns])).toEqual([
      ['a', 0, 1],
      ['b', 0, 1],
      ['c', 0, 1],
    ])
  })

  it('puts two that overlap side by side, in two columns of two', () => {
    const placed = packDay([item('a', at(9), at(10)), item('b', at(9, 30), at(10, 30))])
    expect(placed.map((p) => [p.task.id, p.column, p.columns])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
    ])
  })

  it('uses two columns for a whole chain in which the first and the last do not touch', () => {
    const placed = packDay([item('a', at(9), at(10)), item('b', at(9, 30), at(10, 30)), item('c', at(10), at(11))])
    expect(placed.map((p) => [p.task.id, p.column, p.columns])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
      ['c', 0, 2],
    ])
  })

  it('gives three that are at the same time three columns', () => {
    const placed = packDay([item('a', at(9), at(10)), item('b', at(9), at(10)), item('c', at(9), at(10))])
    expect(placed.map((p) => [p.column, p.columns])).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
    ])
  })

  it('does not count one that ends exactly when another starts as overlapping it', () => {
    const placed = packDay([item('a', at(9), at(10)), item('b', at(10), at(11))])
    expect(placed.map((p) => [p.column, p.columns])).toEqual([
      [0, 1],
      [0, 1],
    ])
  })

  it('gives the full width to one that starts when two side by side end', () => {
    const placed = packDay([item('a', at(9), at(10)), item('b', at(9), at(10)), item('c', at(10), at(11))])
    expect(placed.map((p) => [p.task.id, p.column, p.columns])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
      ['c', 0, 1],
    ])
  })

  it('keeps a long task\'s cluster open while shorter ones come and go beside it', () => {
    const placed = packDay([item('long', at(9), at(12)), item('b', at(9, 30), at(10)), item('c', at(10, 30), at(11))])
    expect(placed.map((p) => [p.task.id, p.column, p.columns])).toEqual([
      ['long', 0, 2],
      ['b', 1, 2],
      ['c', 1, 2],
    ])
  })

  it('counts the columns of each cluster of overlaps by itself', () => {
    const placed = packDay([
      item('a', at(9), at(10)),
      item('b', at(9), at(10)),
      item('c', at(12), at(13)),
      item('d', at(14), at(15)),
      item('e', at(14, 30), at(15, 30)),
      item('f', at(14, 45), at(15, 45)),
    ])
    expect(placed.map((p) => [p.task.id, p.columns])).toEqual([
      ['a', 2],
      ['b', 2],
      ['c', 1],
      ['d', 3],
      ['e', 3],
      ['f', 3],
    ])
  })

  it('packs one that is shorter than half an hour as half an hour, so that it overlaps one that starts twenty minutes later', () => {
    const placed = packDay([item('short', at(9), at(9, 10)), item('next', at(9, 20), at(10))])
    expect(placed.map((p) => [p.task.id, p.column, p.columns])).toEqual([
      ['short', 0, 2],
      ['next', 1, 2],
    ])
    // The real end is kept: the half hour is for the packing only.
    expect(placed[0].end).toBe(at(9, 10))
  })

  it('does not make one that is shorter overlap one that starts when the half hour is over', () => {
    const placed = packDay([item('short', at(9), at(9, 10)), item('next', at(9, 30), at(10))])
    expect(placed.map((p) => p.columns)).toEqual([1, 1])
  })

  it('takes the shortest span that it is told to', () => {
    const items = [item('a', at(9), at(9, 10)), item('b', at(9, 40), at(10, 30))]
    expect(packDay(items, 30).map((p) => p.columns)).toEqual([1, 1])
    expect(packDay(items, 60).map((p) => p.columns)).toEqual([2, 2])
  })

  it('treats one that has no length at all as one of the shortest span', () => {
    const placed = packDay([item('a', at(9), at(9)), item('b', at(9, 10), at(10))])
    expect(placed.map((p) => p.columns)).toEqual([2, 2])
  })

  it('puts them in the order of their start, the longer first when they start together, and then by id', () => {
    const placed = packDay([
      item('late', at(11), at(12)),
      item('short', at(9), at(9, 30)),
      item('long', at(9), at(11)),
      item('b-same', at(10, 30), at(11)),
      item('a-same', at(10, 30), at(11)),
    ])
    expect(ids(placed)).toEqual(['long', 'short', 'a-same', 'b-same', 'late'])
  })

  it('leaves what it was given as it was', () => {
    const items = [item('b', at(9, 30), at(10, 30)), item('a', at(9), at(10))]
    const before = JSON.stringify(items)
    const order = ids(items)
    packDay(items)
    expect(JSON.stringify(items)).toBe(before)
    expect(ids(items)).toEqual(order)
    expect(items[0]).not.toHaveProperty('column')
  })

  it('has nothing to place when it is given nothing', () => {
    expect(packDay([])).toEqual([])
  })
})

describe('layoutRange', () => {
  const me = { assignee: 'me', meId: 'u-dana' }
  const week = (tasks: Task[], options = me) => layoutRange(tasks, '2026-10-18', 7, options)
  const on = (layout: ReturnType<typeof layoutRange>, key: string) => layout.days.find((day) => day.key === key)?.items ?? []

  it('has a column for each day of the range, in order, also across the end of a month and of a year', () => {
    expect(week([]).days.map((day) => day.key)).toEqual(['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'])
    expect(layoutRange([], '2026-12-30', 4, me).days.map((day) => day.key)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
    expect(layoutRange([], '2026-10-20', 1, me).days.map((day) => day.key)).toEqual(['2026-10-20'])
  })

  it('puts a task on the day that it is in Jerusalem, at the minute of the wall clock', () => {
    // 06:00 UTC is 09:00 in Jerusalem in October.
    const layout = week([task('a', { due_at: '2026-10-20T06:00:00.000Z', duration_min: 45 })])
    expect(on(layout, '2026-10-20').map((p) => [p.task.id, p.start, p.end])).toEqual([['a', at(9), at(9, 45)]])
    expect(layout.days.flatMap((day) => day.items)).toHaveLength(1)
  })

  it('puts a task that is after midnight in Jerusalem on the next day, though it is the evening in UTC', () => {
    // 22:30 UTC on 2026-10-25 is 00:30 on the 26th: the clocks went back that night.
    const layout = layoutRange([task('night', { due_at: '2026-10-25T22:30:00.000Z' })], '2026-10-25', 3, me)
    expect(on(layout, '2026-10-25')).toEqual([])
    expect(on(layout, '2026-10-26').map((p) => [p.task.id, p.start])).toEqual([['night', 30]])
  })

  it('ends a task when its length is over, and cuts it at midnight', () => {
    const layout = week([
      task('a', { due_at: '2026-10-20T06:00:00.000Z', duration_min: 60 }),
      // 23:30 in Jerusalem for an hour and a half would end after midnight.
      task('b', { due_at: '2026-10-20T20:30:00.000Z', duration_min: 90 }),
    ])
    expect(on(layout, '2026-10-20').map((p) => [p.task.id, p.start, p.end])).toEqual([
      ['a', at(9), at(10)],
      ['b', at(23, 30), 1440],
    ])
  })

  it.each([
    ['nought', 0],
    ['negative', -15],
    ['not a number', Number.NaN],
    ['missing', undefined],
  ])('takes half an hour for a task whose length is %s', (_name, duration) => {
    const layout = week([task('a', { due_at: '2026-10-20T06:00:00.000Z', duration_min: duration as number })])
    expect(on(layout, '2026-10-20')[0].end).toBe(at(9, 30))
  })

  it('does not place a task without a time, or a deleted one, and places a done one', () => {
    const layout = week([
      task('none', { due_at: null }),
      task('gone', { due_at: '2026-10-20T06:00:00.000Z', deleted_at: '2026-10-19T06:00:00.000Z' }),
      task('done', { due_at: '2026-10-20T07:00:00.000Z', done_at: '2026-10-20T08:00:00.000Z' }),
    ])
    expect(ids(layout.days.flatMap((day) => day.items))).toEqual(['done'])
  })

  it('does not place a task that is before the range or after it', () => {
    const layout = week([
      task('before', { due_at: '2026-10-17T10:00:00.000Z' }),
      task('first', { due_at: '2026-10-18T10:00:00.000Z' }),
      task('last', { due_at: '2026-10-24T10:00:00.000Z' }),
      task('after', { due_at: '2026-10-25T10:00:00.000Z' }),
    ])
    expect(ids(layout.days.flatMap((day) => day.items))).toEqual(['first', 'last'])
  })

  describe('whose tasks', () => {
    const tasks = [
      task('mine', { due_at: '2026-10-20T06:00:00.000Z', assignee_id: 'u-dana' }),
      task('theirs', { due_at: '2026-10-20T07:00:00.000Z', assignee_id: 'u-owner' }),
      task('nobodys', { due_at: '2026-10-20T08:00:00.000Z', assignee_id: null }),
    ]
    const shown = (assignee: string) => ids(layoutRange(tasks, '2026-10-20', 1, { assignee, meId: 'u-dana' }).days[0].items)

    it('shows my tasks for "me"', () => expect(shown('me')).toEqual(['mine']))
    it('shows everybody\'s for "all"', () => expect(shown('all')).toEqual(['mine', 'theirs', 'nobodys']))
    it('shows the ones that nobody has for "none"', () => expect(shown('none')).toEqual(['nobodys']))
    it('shows the tasks of a person for their id', () => expect(shown('u-owner')).toEqual(['theirs']))
    it('shows nothing for a person who has none', () => expect(shown('u-stranger')).toEqual([]))
  })

  describe('the hours', () => {
    it('are seven to twenty-one when nothing is outside them', () => {
      const layout = week([task('a', { due_at: '2026-10-20T06:00:00.000Z' })])
      expect([layout.fromHour, layout.toHour]).toEqual([7, 21])
      expect([week([]).fromHour, week([]).toHour]).toEqual([7, 21])
    })

    it('start earlier for an early task, at the hour that it is in', () => {
      // 05:30 in Jerusalem is 02:30 UTC.
      const layout = week([task('early', { due_at: '2026-10-20T02:30:00.000Z' })])
      expect(layout.fromHour).toBe(5)
      expect(layout.toHour).toBe(21)
    })

    it('go on later for a late task, to the hour after it ends', () => {
      // 22:10 in Jerusalem for an hour ends at 23:10, so the day is shown to midnight.
      const layout = week([task('late', { due_at: '2026-10-20T19:10:00.000Z', duration_min: 60 })])
      expect(layout.toHour).toBe(24)
      // 21:30 for half an hour ends at 22:00 exactly.
      const edge = week([task('edge', { due_at: '2026-10-20T18:30:00.000Z', duration_min: 30 })])
      expect(edge.toHour).toBe(22)
    })

    it('do not go past midnight, or before it', () => {
      const night = week([task('night', { due_at: '2026-10-20T20:45:00.000Z', duration_min: 600 }), task('dawn', { due_at: '2026-10-19T21:15:00.000Z' })])
      expect(night.toHour).toBe(24)
      expect(night.fromHour).toBe(0)
    })

    it('do not change for a task that is outside the range', () => {
      const layout = week([task('away', { due_at: '2026-10-30T02:30:00.000Z' })])
      expect([layout.fromHour, layout.toHour]).toEqual([7, 21])
    })

    it('count a done task and not a deleted one', () => {
      const layout = week([
        task('done', { due_at: '2026-10-20T02:30:00.000Z', done_at: '2026-10-20T03:00:00.000Z' }),
        task('gone', { due_at: '2026-10-20T22:30:00.000Z', deleted_at: '2026-10-20T03:00:00.000Z' }),
      ])
      expect([layout.fromHour, layout.toHour]).toEqual([5, 21])
    })
  })

  describe('on the days that the clocks change', () => {
    it('places the two 01:30 of the night that has 25 hours at the same minute, each once', () => {
      // On 2026-10-25 the clocks go back at 02:00: 01:30 comes twice, at 22:30 UTC and at 23:30 UTC.
      const layout = layoutRange(
        [
          task('first', { due_at: '2026-10-24T22:30:00.000Z' }),
          task('second', { due_at: '2026-10-24T23:30:00.000Z' }),
          task('noon', { due_at: '2026-10-25T10:00:00.000Z' }),
        ],
        '2026-10-24',
        3,
        me,
      )
      expect(on(layout, '2026-10-24')).toEqual([])
      const day = on(layout, '2026-10-25')
      expect(day.map((p) => [p.task.id, p.start, p.column, p.columns])).toEqual([
        ['first', at(1, 30), 0, 2],
        ['second', at(1, 30), 1, 2],
        ['noon', at(12), 0, 1],
      ])
      expect(layout.days.flatMap((d) => d.items)).toHaveLength(3)
    })

    it('places a task on the day that has 23 hours by the wall clock, and loses none', () => {
      // On 2026-03-27 the clocks go forward at 02:00: there is no 02:30.
      const layout = layoutRange(
        [
          task('before', { due_at: '2026-03-26T23:30:00.000Z' }),
          task('after', { due_at: '2026-03-27T01:30:00.000Z' }),
          task('evening', { due_at: '2026-03-27T17:00:00.000Z' }),
        ],
        '2026-03-26',
        3,
        me,
      )
      const day = on(layout, '2026-03-27')
      expect(day.map((p) => [p.task.id, p.start])).toEqual([
        ['before', at(1, 30)],
        ['after', at(4, 30)],
        ['evening', at(20)],
      ])
      expect(layout.days.flatMap((d) => d.items)).toHaveLength(3)
    })
  })

  it('packs the tasks of each day, side by side when they overlap', () => {
    const layout = week([
      task('a', { due_at: '2026-10-20T06:00:00.000Z', duration_min: 60 }),
      task('b', { due_at: '2026-10-20T06:30:00.000Z', duration_min: 60 }),
      task('c', { due_at: '2026-10-21T06:00:00.000Z' }),
    ])
    expect(on(layout, '2026-10-20').map((p) => [p.task.id, p.column, p.columns])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
    ])
    expect(on(layout, '2026-10-21').map((p) => [p.column, p.columns])).toEqual([[0, 1]])
  })

  it('does not change the tasks that it is given', () => {
    const tasks = [task('b', { due_at: '2026-10-20T06:30:00.000Z' }), task('a', { due_at: '2026-10-20T06:00:00.000Z' })]
    const before = JSON.stringify(tasks)
    week(tasks)
    expect(JSON.stringify(tasks)).toBe(before)
  })
})

describe('slotToDue', () => {
  it('rounds a click to the nearest half hour, at the middle upwards', () => {
    expect(slotToDue('2026-10-20', at(9, 14))).toBe('2026-10-20T06:00:00.000Z')
    expect(slotToDue('2026-10-20', at(9, 15))).toBe('2026-10-20T06:30:00.000Z')
    expect(slotToDue('2026-10-20', at(9, 44))).toBe('2026-10-20T06:30:00.000Z')
    expect(slotToDue('2026-10-20', at(9, 45))).toBe('2026-10-20T07:00:00.000Z')
    expect(slotToDue('2026-10-20', 554.9)).toBe('2026-10-20T06:00:00.000Z')
  })

  it('keeps a click after a quarter to midnight on the same day, at half past eleven', () => {
    // It would round to midnight of the next day, and the new task would be on the wrong day.
    expect(slotToDue('2026-10-20', at(23, 44))).toBe('2026-10-20T20:30:00.000Z')
    expect(slotToDue('2026-10-20', at(23, 45))).toBe('2026-10-20T20:30:00.000Z')
    expect(slotToDue('2026-10-20', at(23, 59))).toBe('2026-10-20T20:30:00.000Z')
  })

  it('holds an offset that is before the day or after it to the day', () => {
    expect(slotToDue('2026-10-20', -45)).toBe('2026-10-19T21:00:00.000Z')
    expect(slotToDue('2026-10-20', 0)).toBe('2026-10-19T21:00:00.000Z')
    expect(slotToDue('2026-10-20', 5000)).toBe('2026-10-20T20:30:00.000Z')
  })

  it('is the moment of that time in Jerusalem, in winter as in summer', () => {
    expect(slotToDue('2026-12-20', at(9))).toBe('2026-12-20T07:00:00.000Z')
    expect(slotToDue('2026-07-20', at(9))).toBe('2026-07-20T06:00:00.000Z')
  })

  it('is the moment of that time on the days that the clocks change', () => {
    // The night of 2026-10-25 has 25 hours: from the morning it is winter time.
    expect(slotToDue('2026-10-25', at(9, 30))).toBe('2026-10-25T07:30:00.000Z')
    // The day of 2026-03-27 has 23 hours: at noon it is summer time, and 02:30 does not exist, so it is 03:30.
    expect(slotToDue('2026-03-27', at(12))).toBe('2026-03-27T09:00:00.000Z')
    expect(slotToDue('2026-03-27', at(2, 30))).toBe('2026-03-27T00:30:00.000Z')
  })
})

describe('rangeTitle', () => {
  it('names a week by its first and last day, with the year once', () => {
    expect(rangeTitle('2026-10-18', 7)).toBe('18.10 – 24.10/2026')
  })

  it('gives the day and the month two digits', () => {
    expect(rangeTitle('2026-03-01', 7)).toBe('01.03 – 07.03/2026')
  })

  it('goes across the end of a month', () => {
    expect(rangeTitle('2026-10-28', 7)).toBe('28.10 – 03.11/2026')
  })

  it('names both years when the range goes across the end of a year', () => {
    expect(rangeTitle('2026-12-28', 7)).toBe('28.12/2026 – 03.01/2027')
  })

  it('names three days by the first and the last', () => {
    expect(rangeTitle('2026-10-18', 3)).toBe('18.10 – 20.10/2026')
  })

  it('names one day by its weekday', () => {
    expect(rangeTitle('2026-10-18', 1)).toBe('יום א׳ 18.10/2026')
    expect(rangeTitle('2026-10-24', 1)).toBe('יום ש׳ 24.10/2026')
  })
})

describe('rangeStart and shiftAnchor', () => {
  it('starts a week on the Sunday on or before the day', () => {
    expect(rangeStart('2026-10-18', 7)).toBe('2026-10-18')
    expect(rangeStart('2026-10-21', 7)).toBe('2026-10-18')
    expect(rangeStart('2026-10-24', 7)).toBe('2026-10-18')
    expect(rangeStart('2026-10-25', 7)).toBe('2026-10-25')
  })

  it('starts three days and one day at the day itself', () => {
    expect(rangeStart('2026-10-21', 3)).toBe('2026-10-21')
    expect(rangeStart('2026-10-21', 1)).toBe('2026-10-21')
  })

  it('moves by the width of the range, forward and back', () => {
    expect(shiftAnchor('2026-10-18', 7, 1)).toBe('2026-10-25')
    expect(shiftAnchor('2026-10-18', 7, -1)).toBe('2026-10-11')
    expect(shiftAnchor('2026-10-18', 3, 1)).toBe('2026-10-21')
    expect(shiftAnchor('2026-10-18', 3, -1)).toBe('2026-10-15')
    expect(shiftAnchor('2026-10-18', 1, 1)).toBe('2026-10-19')
    expect(shiftAnchor('2026-10-18', 1, -1)).toBe('2026-10-17')
  })

  it('goes across the end of a month and of a year', () => {
    expect(shiftAnchor('2026-10-28', 7, 1)).toBe('2026-11-04')
    expect(shiftAnchor('2026-12-30', 7, 1)).toBe('2027-01-06')
    expect(shiftAnchor('2027-01-02', 7, -1)).toBe('2026-12-26')
  })
})
