import { describe, expect, it, vi } from 'vitest'
import { activeReminders, planNotifications } from '../schedule/reminders'
import type { TaskChangeEvent } from '../tasks/gateways'
import type { Task } from '../tasks/model'
import { fromDueAt, glassixUrl, validateTask } from '../tasks/validation'
import { createDemoBackend, createDemoDirectory, createDemoTasks, demoColleagues, demoStatuses } from './demoBackend'
import { DEMO_PROFILE } from './demoGateway'

// 15 October 2026, 15:00 in Jerusalem: a Thursday afternoon.
const NOW = new Date('2026-10-15T12:00:00.000Z')
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('the statuses of the demo', () => {
  it('are the 17 statuses of the old app, in its order', () => {
    expect(demoStatuses().map((s) => s.key)).toEqual([
      'processing',
      'pending',
      'completed',
      'on-hold',
      'cancelled',
      'refunded',
      'failed',
      'cargo',
      'late',
      'bank',
      'to-branch',
      'await-pickup',
      'courier',
      'delivered-branch',
      'pull',
      'manager',
      'abroad',
    ])
    expect(demoStatuses().map((s) => s.sort)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1))
    expect(demoStatuses().every((s) => s.is_active && /^#[0-9a-f]{6}$/.test(s.color))).toBe(true)
  })
})

describe('the sample tasks', () => {
  const tasks = createDemoTasks(NOW)
  const open = tasks.filter((t) => t.done_at === null)

  it('use only statuses, people and kinds that exist, and have different ids', () => {
    const statuses = new Set(demoStatuses().map((s) => s.key))
    const people = new Set([DEMO_PROFILE.id, ...demoColleagues().map((p) => p.id)])
    for (const task of tasks) {
      expect(statuses.has(task.status_key), task.id).toBe(true)
      expect(task.assignee_id === null || people.has(task.assignee_id), task.id).toBe(true)
      expect(people.has(task.created_by), task.id).toBe(true)
    }
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length)
  })

  it('pass the rules of the app itself, so that a sample can be opened and saved as it is', () => {
    for (const task of tasks) {
      expect(validateTask(task, fromDueAt(task.due_at)), task.id).toEqual({})
    }
  })

  it('keep the phone digits that the database would keep', () => {
    for (const task of tasks) expect(task.customer_phone_digits, task.id).toBe(task.customer_phone.replace(/\D/g, ''))
  })

  it('are about thirty, so that the screen has something to scroll and to page', () => {
    expect(tasks.length).toBeGreaterThanOrEqual(28)
    expect(tasks.length).toBeLessThanOrEqual(36)
  })

  it('use every one of the statuses, so that every chip of the screen has something under it', () => {
    expect(new Set(tasks.map((t) => t.status_key))).toEqual(new Set(demoStatuses().map((s) => s.key)))
  })

  it('cover every kind and every priority', () => {
    expect(new Set(tasks.map((t) => t.kind))).toEqual(new Set(['general', 'delivery', 'pickup']))
    expect(new Set(tasks.map((t) => t.priority))).toEqual(new Set(['normal', 'high', 'urgent']))
    expect(tasks.some((t) => t.kind === 'pickup' && t.product_name !== '' && t.product_sku !== '')).toBe(true)
    expect(tasks.some((t) => t.kind === 'delivery' && t.cargo_number !== '' && t.sent_to_cargo)).toBe(true)
  })

  it('are spread over time: late, soon, later today, tomorrow, later, and with no date at all', () => {
    const due = (t: (typeof tasks)[number]) => (t.due_at === null ? null : Date.parse(t.due_at) - NOW.getTime())
    expect(open.some((t) => (due(t) ?? 0) < -30 * MINUTE)).toBe(true) // late
    expect(open.some((t) => (due(t) ?? -1) > 0 && (due(t) ?? 0) <= HOUR)).toBe(true) // within the hour
    expect(open.some((t) => (due(t) ?? 0) > HOUR && (due(t) ?? 0) < 6 * HOUR)).toBe(true) // later today
    expect(open.some((t) => (due(t) ?? 0) > 12 * HOUR && (due(t) ?? 0) < 2 * DAY)).toBe(true) // tomorrow
    expect(open.some((t) => (due(t) ?? 0) >= 2 * DAY)).toBe(true) // further on
    expect(open.some((t) => t.due_at === null)).toBe(true)
  })

  describe('of the person of the demo', () => {
    const mine = open.filter((t) => t.assignee_id === DEMO_PROFILE.id)
    const ahead = (t: Task) => Date.parse(t.due_at ?? '') - NOW.getTime()
    const late = (t: Task) => t.due_at !== null && ahead(t) < 0
    const withinTheHour = (t: Task) => t.due_at !== null && ahead(t) > 0 && ahead(t) <= HOUR
    const laterToday = (t: Task) => ahead(t) > HOUR && ahead(t) < 6 * HOUR
    const tomorrow = (t: Task) => ahead(t) > 12 * HOUR && ahead(t) < 2 * DAY

    it('are late, due within the hour, due later today, due tomorrow, and have no date, so that every part of the Today screen has something', () => {
      expect(mine.some(late)).toBe(true)
      expect(mine.some(withinTheHour)).toBe(true)
      expect(mine.some(laterToday)).toBe(true)
      expect(mine.some(tomorrow)).toBe(true)
      expect(mine.some((t) => t.due_at === null)).toBe(true)
    })

    it('have a reminder on a late task, on one within the hour, on one later today and on one tomorrow', () => {
      const reminded = mine.filter((t) => t.remind_min !== null)
      expect(reminded.some(late)).toBe(true)
      expect(reminded.some(withinTheHour)).toBe(true)
      expect(reminded.some(laterToday)).toBe(true)
      expect(reminded.some(tomorrow)).toBe(true)
    })

    it('have a reminder that is on at the start, so that the strip has something to show', () => {
      expect(activeReminders(tasks, NOW, {}, DEMO_PROFILE.id).length).toBeGreaterThanOrEqual(1)
    })

    it('have reminders that come within the hour and later on, so that the demo can show one arriving', () => {
      const plan = planNotifications(tasks, NOW, {}, DEMO_PROFILE.id)
      expect(plan.some((n) => n.at.getTime() - NOW.getTime() <= HOUR)).toBe(true)
      expect(plan.length).toBeGreaterThanOrEqual(4)
    })
  })

  it('include tasks that are done: one today, one a few days ago and one from long ago', () => {
    const done = tasks.filter((t) => t.done_at !== null)
    const ago = (t: (typeof tasks)[number]) => NOW.getTime() - Date.parse(t.done_at!)
    expect(done.some((t) => ago(t) < 6 * HOUR)).toBe(true)
    expect(done.some((t) => ago(t) > 2 * DAY && ago(t) < 29 * DAY)).toBe(true)
    expect(done.some((t) => ago(t) > 31 * DAY)).toBe(true)
    for (const t of done) expect(t.done_by, t.id).not.toBeNull()
  })

  it('are made from the time they are given, so that the demo is never stale', () => {
    const later = new Date(NOW.getTime() + 40 * DAY)
    const offsets = (list: ReturnType<typeof createDemoTasks>, at: Date) =>
      list.map((t) => [t.id, t.due_at === null ? null : Date.parse(t.due_at) - at.getTime()] as const)
    const shifted = offsets(createDemoTasks(later), later)
    const original = offsets(tasks, NOW)
    // Dates fixed by the clock of the day (tomorrow at 10:00) may move by an hour at a clock change.
    for (const [index, [id, offset]] of original.entries()) {
      expect(shifted[index][0]).toBe(id)
      if (offset === null) expect(shifted[index][1]).toBeNull()
      else expect(Math.abs((shifted[index][1] ?? 0) - offset)).toBeLessThanOrEqual(HOUR)
    }
  })
})

describe('the demo backend', () => {
  it('loads the sample tasks that are open or were done in the last 30 days', async () => {
    const backend = createDemoBackend(() => NOW)
    const loaded = await backend.tasks.loadInitial(NOW)
    const all = createDemoTasks(NOW)
    expect(loaded.length).toBeLessThan(all.length) // the old done task is left out, to be found by a search
    expect(loaded.every((t) => t.done_at === null || NOW.getTime() - Date.parse(t.done_at) < 30 * DAY)).toBe(true)
    const old = all.find((t) => t.done_at !== null && NOW.getTime() - Date.parse(t.done_at) > 31 * DAY)!
    expect((await backend.tasks.search(old.title)).map((t) => t.id)).toContain(old.id)
  })

  it('has the demo user and some colleagues, and a Glassix link that works', async () => {
    const { profiles, settings, statuses } = await createDemoBackend(() => NOW).directory.load()
    expect(profiles.map((p) => p.id)).toContain(DEMO_PROFILE.id)
    expect(profiles.length).toBeGreaterThanOrEqual(4)
    expect(profiles.every((p) => p.is_active)).toBe(true)
    // Every person has the default reminder that a new task starts with, as a real profile does.
    expect(profiles.every((p) => p.default_remind_min === 15)).toBe(true)
    expect(statuses).toHaveLength(17)
    expect(glassixUrl(settings.glassix_url_template, 'demo-4801')).toMatch(/^https:\/\//)
    expect(settings.ship_methods).toContain('CARGO')
  })

  it('works on the directory that it is given, so that the person who signs in and the people of the team are one', async () => {
    const directory = createDemoDirectory()
    expect(directory.profiles.map((p) => p.id)).toEqual([DEMO_PROFILE.id, ...demoColleagues().map((p) => p.id)])
    const backend = createDemoBackend(() => NOW, directory)
    directory.profiles.find((p) => p.id === DEMO_PROFILE.id)!.display_name = 'שם אחר'
    const { profiles } = await backend.directory.load()
    expect(profiles.find((p) => p.id === DEMO_PROFILE.id)?.display_name).toBe('שם אחר')
    // And a change that the administrator tools make is made on that directory.
    await backend.admin.users.rename(DEMO_PROFILE.id, 'שם שלישי')
    expect(directory.profiles.find((p) => p.id === DEMO_PROFILE.id)?.display_name).toBe('שם שלישי')
  })

  it('makes a directory of its own when it is not given one', async () => {
    const first = await createDemoBackend(() => NOW).directory.load()
    const second = await createDemoBackend(() => NOW).directory.load()
    expect(first.profiles).toEqual(second.profiles)
  })

  it('has a "created" line of history for every sample task, and one for each that is done', async () => {
    const backend = createDemoBackend(() => NOW)
    for (const task of createDemoTasks(NOW)) {
      const history = await backend.tasks.loadHistory(task.id)
      expect(history.map((e) => e.type), task.id).toContain('created')
      expect(history.some((e) => e.type === 'done'), task.id).toBe(task.done_at !== null)
    }
  })

  it('writes history for what is changed in the demo, after the lines that were already there', async () => {
    const backend = createDemoBackend(() => NOW)
    const task = createDemoTasks(NOW)[0]
    await backend.tasks.upsert(task.id, { notes: 'changed in the demo' })
    const history = await backend.tasks.loadHistory(task.id)
    expect(history[0]).toMatchObject({ type: 'updated', changes: { notes: [task.notes, 'changed in the demo'] } })
    expect(new Set(history.map((e) => e.id)).size).toBe(history.length)
  })

  it('has a connection that is up, so that the app does not warn about a lost one', () => {
    const onState = vi.fn()
    createDemoBackend(() => NOW).tasks.subscribe(vi.fn(), onState)
    expect(onState.mock.calls).toEqual([[true]])
  })

  it('tells its subscribers about what is saved, as the live connection of a real server does', async () => {
    const backend = createDemoBackend(() => NOW)
    const heard: TaskChangeEvent[] = []
    backend.tasks.subscribe((event) => heard.push(event), vi.fn())
    const task = createDemoTasks(NOW)[0]
    await backend.tasks.upsert(task.id, { title: 'renamed' })
    expect(heard).toHaveLength(1)
    expect(heard[0].task).toMatchObject({ id: task.id, title: 'renamed' })
  })

  it('shows a picture that was added, from the memory of the browser', async () => {
    const createObjectURL = vi.fn(() => 'blob:demo-picture')
    const original = URL.createObjectURL
    URL.createObjectURL = createObjectURL
    try {
      const backend = createDemoBackend(() => NOW)
      const added = await backend.attachments.add('demo-late-delivery', {
        full: new Blob(['x']),
        thumb: new Blob(['x']),
        kind: 'image',
        width: 10,
        height: 10,
      })
      expect(await backend.attachments.signedUrl(added.storage_path)).toBe('blob:demo-picture')
      expect(createObjectURL).toHaveBeenCalledTimes(1)
    } finally {
      URL.createObjectURL = original
    }
  })

  describe('the picture of the product', () => {
    function withObjectUrls(): () => void {
      const original = URL.createObjectURL
      URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => `blob:${(blob as Blob).type}`)
      return () => {
        URL.createObjectURL = original
      }
    }

    it('is one picture, for the sample pickup, and it is the picture that the task has set as its product', async () => {
      const restore = withObjectUrls()
      try {
        const backend = createDemoBackend(() => NOW)
        const pickup = createDemoTasks(NOW).find((t) => t.id === 'demo-pickup')!
        expect(pickup.thumb_attachment_id).not.toBeNull()
        const pictures = await backend.attachments.list(pickup.id)
        expect(pictures).toHaveLength(1)
        expect(pictures[0]).toMatchObject({ id: pickup.thumb_attachment_id, task_id: pickup.id, kind: 'product' })
        expect(pictures[0]).toMatchObject({ width: 640, height: 480 })
        expect(await backend.attachments.signedUrl(pictures[0].storage_path)).toBe('blob:image/svg+xml')
        expect(await backend.attachments.signedUrl(pictures[0].thumb_path)).toBe('blob:image/svg+xml')
        for (const other of createDemoTasks(NOW).filter((t) => t.id !== pickup.id)) {
          expect(await backend.attachments.list(other.id), other.id).toEqual([])
          expect(other.thumb_attachment_id, other.id).toBeNull()
        }
      } finally {
        restore()
      }
    })

    it('is written on the history of the pickup, as the adding of a picture is', async () => {
      const backend = createDemoBackend(() => NOW)
      const history = await backend.tasks.loadHistory('demo-pickup')
      expect(history.map((event) => event.type)).toEqual(['attachment_added', 'created'])
      expect(history[0]).toMatchObject({ actor_id: DEMO_PROFILE.id, changes: { attachment: [null, { kind: 'product' }] } })
    })

    it('can be deleted like any other, and a picture that is added later gets an id of its own', async () => {
      const backend = createDemoBackend(() => NOW)
      const [seeded] = await backend.attachments.list('demo-pickup')
      const added = await backend.attachments.add('demo-pickup', { full: new Blob(['x']), thumb: new Blob(['x']), kind: 'image', width: 10, height: 10 })
      expect(added.id).not.toBe(seeded.id)
      await backend.attachments.remove(seeded)
      expect((await backend.attachments.list('demo-pickup')).map((picture) => picture.id)).toEqual([added.id])
    })
  })

  it('gives every person a waiting-changes storage of their own', async () => {
    const backend = createDemoBackend(() => NOW)
    const first = backend.outbox('one')
    await first.save([{ id: 'x', patch: {}, queuedAt: 1, attempts: 0 }])
    expect(await backend.outbox('two').load()).toEqual([])
  })
})
