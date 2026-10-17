import { act, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import { createAuthStore } from '../auth/authStore'
import { createFakeBackend, type FakeBackend } from '../../test/fakeBackend'
import { createFakeGateway, DANA, OWNER } from '../../test/fakeGateway'
import { BackendContext } from '../tasks/backend'
import { newTask, type Task } from '../tasks/model'
import { useTasks } from '../tasks/tasksContext'
import { TasksProvider } from '../tasks/TasksProvider'
import { createMemoryNotifier, createWebNotifier, type MemoryNotifier } from './notifier'
import { NotifierContext, REMINDER_PROBLEM, useReminders } from './remindersContext'
import { RemindersProvider } from './RemindersProvider'
import { snoozeKey } from './snooze'

// The moment of these tests is 12:00 in Jerusalem on 2026-10-16 (09:00 UTC). The provider plans the
// notifications of the signed-in person from the tasks store, and keeps the strip of reminders.

const NOW = new Date('2026-10-16T09:00:00Z')
const MIN = 60_000
const at = (minutes: number) => new Date(NOW.getTime() + minutes * MIN).toISOString()

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...newTask(OWNER.id, id),
    title: `משימה ${id}`,
    no_glassix: true,
    assignee_id: DANA.id,
    due_at: at(60),
    remind_min: 15,
    created_at: '2026-10-01T08:00:00.000Z',
    updated_at: '2026-10-01T08:00:00.000Z',
    ...over,
  }
}

/** What the screens would see of the provider, written out as text and buttons. */
function Probe() {
  const r = useReminders()
  return (
    <div>
      <p data-testid="active">{r.active.map((t) => t.id).join(',')}</p>
      <p data-testid="snoozed">{Object.keys(r.snoozed).join(',')}</p>
      <p data-testid="permission">{r.permission ?? 'checking'}</p>
      <p data-testid="exact">{r.exactAlarms}</p>
      <p data-testid="problem">{r.problem ?? ''}</p>
      <button type="button" onClick={() => r.snooze('t1')}>
        snooze t1
      </button>
      <button type="button" onClick={() => void r.requestPermission()}>
        ask
      </button>
      <button type="button" onClick={() => r.openExactAlarmSettings()}>
        settings
      </button>
    </div>
  )
}

const Where = () => <p data-testid="where">{useLocation().pathname}</p>

/** The actions of the tasks store, taken out for the test to use. */
interface Actions {
  load: () => Promise<void>
  update: (id: string, patch: Partial<Task>) => void
  markDone: (id: string, done: boolean) => void
  softDelete: (id: string, deleted: boolean) => void
}
const taken: { actions: Actions | null } = { actions: null }
const controls = () => taken.actions as Actions
function Controls() {
  const load = useTasks((s) => s.load)
  const update = useTasks((s) => s.update)
  const markDone = useTasks((s) => s.markDone)
  const softDelete = useTasks((s) => s.softDelete)
  useEffect(() => {
    taken.actions = { load, update, markDone, softDelete }
  })
  return null
}

async function signedIn() {
  const gateway = createFakeGateway()
  gateway.getStoredUserId.mockResolvedValue(DANA.id)
  gateway.fetchProfile.mockResolvedValue(DANA)
  const auth = createAuthStore(gateway.gateway)
  await auth.getState().init()
  return auth
}

interface Setup {
  tasks?: Task[]
  notifier?: MemoryNotifier
}

async function mount({ tasks = [], notifier = createMemoryNotifier('granted') }: Setup = {}) {
  const auth = await signedIn()
  const fake: FakeBackend = createFakeBackend({ tasks })
  const view = render(
    <AuthProvider store={auth}>
      <BackendContext value={fake.backend}>
        <MemoryRouter>
          <TasksProvider>
            <RemindersProvider notifier={notifier}>
              <Controls />
              <Probe />
              <Where />
            </RemindersProvider>
          </TasksProvider>
        </MemoryRouter>
      </BackendContext>
    </AuthProvider>,
  )
  await settle(0)
  return { notifier, fake, view }
}

/** Lets the promises settle and the clock run for a while. */
const settle = (ms = 300) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))
const text = (id: string) => screen.getByTestId(id).textContent
const lastPlan = (notifier: MemoryNotifier) => notifier.plans.at(-1) ?? []

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('RemindersProvider: planning', () => {
  it('plans the notifications of the signed-in person, and of nobody else', async () => {
    const { notifier } = await mount({
      tasks: [task('t1'), task('t2', { assignee_id: OWNER.id }), task('t3', { assignee_id: null }), task('t4', { due_at: null }), task('t5', { remind_min: null })],
    })
    await settle()
    expect(lastPlan(notifier).map((p) => p.taskId)).toEqual(['t1'])
    expect(lastPlan(notifier)[0]).toMatchObject({ title: 'תזכורת: משימה t1', body: 'היום · 13:00' })
    expect(lastPlan(notifier)[0].at.toISOString()).toBe(at(45))
  })

  it('plans once for a burst of changes, not once for each', async () => {
    const { notifier } = await mount({ tasks: [task('t1')] })
    await settle()
    const before = notifier.plans.length
    for (let i = 1; i <= 5; i++) act(() => controls().update('t1', { remind_min: 15 + i }))
    await settle(100)
    expect(notifier.plans.length).toBe(before)
    await settle()
    expect(notifier.plans.length).toBe(before + 1)
    expect(lastPlan(notifier)[0].at.toISOString()).toBe(at(60 - 20))
  })

  it('follows the task: a new time moves the notification, and done, deleted, reassigned or no reminder take it out', async () => {
    const { notifier } = await mount({ tasks: [task('t1'), task('t2'), task('t3'), task('t4'), task('t5')] })
    await settle()
    expect(lastPlan(notifier)).toHaveLength(5)

    act(() => controls().update('t1', { due_at: at(120) }))
    act(() => controls().markDone('t2', true))
    act(() => controls().softDelete('t3', true))
    act(() => controls().update('t4', { assignee_id: OWNER.id }))
    act(() => controls().update('t5', { remind_min: null }))
    await settle()

    expect(lastPlan(notifier).map((p) => p.taskId)).toEqual(['t1'])
    expect(lastPlan(notifier)[0].at.toISOString()).toBe(at(105))
  })

  it('plans again every fifteen minutes and when the app comes back to the front', async () => {
    const { notifier } = await mount({ tasks: [task('t1')] })
    await settle()
    const before = notifier.plans.length
    // React applies what a timer set when the step is over, so the plan that it asks for needs a step of its own.
    await settle(15 * MIN)
    await settle()
    expect(notifier.plans.length).toBeGreaterThan(before)

    const afterTimer = notifier.plans.length
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    await settle()
    expect(notifier.plans.length).toBe(afterTimer + 1)
  })

  it('cancels everything when it goes away, as when somebody signs out', async () => {
    const { notifier, view } = await mount({ tasks: [task('t1')] })
    await settle()
    expect(notifier.cleared).toBe(0)
    view.unmount()
    await settle()
    expect(notifier.cleared).toBe(1)
  })

  it('plans again once the person has allowed notifications', async () => {
    const notifier = createMemoryNotifier('prompt')
    await mount({ tasks: [task('t1')], notifier })
    await settle()
    expect(text('permission')).toBe('prompt')
    const before = notifier.plans.length

    fireEvent.click(screen.getByText('ask'))
    await settle()
    await settle()

    expect(text('permission')).toBe('granted')
    expect(notifier.plans.length).toBe(before + 1)
  })

  it('tells what is wrong when the notifications cannot be planned, and tries again with the next change', async () => {
    const { notifier } = await mount({ tasks: [task('t1')] })
    await settle()
    expect(text('problem')).toBe('')

    notifier.failNext(new Error('the platform said no'))
    act(() => controls().update('t1', { remind_min: 30 }))
    await settle()
    expect(text('problem')).toBe(REMINDER_PROBLEM)

    act(() => controls().update('t1', { remind_min: 20 }))
    await settle()
    expect(text('problem')).toBe('')
    expect(lastPlan(notifier)).toHaveLength(1)
  })
})

describe('RemindersProvider: the strip of reminders and the snooze', () => {
  // Due in five minutes with a reminder fifteen minutes before: its reminder time passed ten minutes ago.
  const ringing = () => task('t1', { due_at: at(5), remind_min: 15 })

  it('lists the reminders that are on, and not the ones that are not yet', async () => {
    await mount({ tasks: [ringing(), task('t2', { due_at: at(120) }), task('t3', { assignee_id: OWNER.id, due_at: at(5) })] })
    await settle()
    expect(text('active')).toBe('t1')
  })

  it('shows a reminder when its time comes while the app is open', async () => {
    await mount({ tasks: [task('t1', { due_at: at(30), remind_min: 15 })] })
    await settle()
    expect(text('active')).toBe('')
    await settle(16 * MIN)
    expect(text('active')).toBe('t1')
  })

  it('hides a snoozed reminder, plans a notification for the end of the snooze, and brings it back then', async () => {
    const { notifier } = await mount({ tasks: [ringing()] })
    await settle()
    expect(text('active')).toBe('t1')

    const snoozedAt = Date.now()
    fireEvent.click(screen.getByText('snooze t1'))
    await settle()

    expect(text('active')).toBe('')
    expect(text('snoozed')).toBe('t1')
    expect(lastPlan(notifier).map((p) => p.taskId)).toEqual(['t1'])
    expect(lastPlan(notifier)[0].at.toISOString()).toBe(new Date(snoozedAt + 10 * MIN).toISOString())

    await settle(10 * MIN + 30_000)
    expect(text('active')).toBe('t1')
    expect(text('snoozed')).toBe('')
  })

  it('keeps the snooze when the app is opened again', async () => {
    const first = await mount({ tasks: [ringing()] })
    await settle()
    fireEvent.click(screen.getByText('snooze t1'))
    await settle()
    first.view.unmount()

    await mount({ tasks: [ringing()] })
    await settle()
    expect(text('active')).toBe('')
    expect(text('snoozed')).toBe('t1')
  })

  it('forgets the snooze when the task gets a new due time', async () => {
    await mount({ tasks: [ringing()] })
    await settle()
    fireEvent.click(screen.getByText('snooze t1'))
    await settle()
    expect(text('snoozed')).toBe('t1')

    act(() => controls().update('t1', { due_at: at(40) }))
    await settle()

    expect(text('snoozed')).toBe('')
    expect(JSON.parse(localStorage.getItem(snoozeKey(DANA.id)) ?? '{}')).toEqual({})
    // The reminder time of the new due time is in the future, and when it comes the reminder shows, not hidden by the old snooze.
    await settle(26 * MIN)
    expect(text('active')).toBe('t1')
  })

  it('keeps the snooze when the server spells the due time of the task differently, as the same moment', async () => {
    await mount({ tasks: [ringing()] })
    await settle()
    fireEvent.click(screen.getByText('snooze t1'))
    await settle()
    expect(text('snoozed')).toBe('t1')

    // The app writes a time as "…:00.000Z", the server and the live connection as "…:00+00:00".
    act(() => controls().update('t1', { due_at: at(5).replace('.000Z', '+00:00') }))
    await settle()

    expect(text('snoozed')).toBe('t1')
    expect(text('active')).toBe('')
  })

  it.each([
    ['done', (id: string) => controls().markDone(id, true)],
    ['deleted', (id: string) => controls().softDelete(id, true)],
    ['given to somebody else', (id: string) => controls().update(id, { assignee_id: OWNER.id })],
  ])('forgets the snooze when the task is %s', async (_what, change) => {
    await mount({ tasks: [ringing()] })
    await settle()
    fireEvent.click(screen.getByText('snooze t1'))
    await settle()
    expect(text('snoozed')).toBe('t1')

    act(() => change('t1'))
    await settle()

    expect(text('snoozed')).toBe('')
  })

  it('does not forget a snooze before the tasks have been loaded', async () => {
    // The snooze of an earlier run is in the storage; the task is not in the store until the load is over.
    localStorage.setItem(snoozeKey(DANA.id), JSON.stringify({ t1: { until: NOW.getTime() + 5 * MIN, due: at(5) } }))
    const auth = await signedIn()
    const fake = createFakeBackend({ tasks: [ringing()] })
    // The first answer of the server is slow.
    const load = fake.tasks.gateway.loadInitial
    fake.tasks.gateway.loadInitial = async (when) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      return load(when)
    }
    render(
      <AuthProvider store={auth}>
        <BackendContext value={fake.backend}>
          <MemoryRouter>
            <TasksProvider>
              <RemindersProvider notifier={createMemoryNotifier('granted')}>
                <Probe />
              </RemindersProvider>
            </TasksProvider>
          </MemoryRouter>
        </BackendContext>
      </AuthProvider>,
    )
    await settle(500)
    expect(text('snoozed')).toBe('t1')
    await settle(3_000)
    expect(text('snoozed')).toBe('t1')
    expect(text('active')).toBe('')
  })
})

describe('RemindersProvider: the notifier', () => {
  it('opens the task when a notification is tapped', async () => {
    const { notifier } = await mount({ tasks: [task('t1')] })
    await settle()
    act(() => notifier.opened('t1'))
    expect(text('where')).toBe('/today/t1')
  })

  it('tells the state of the permission and of the exact alarms, and that there are none where the notifier knows nothing of them', async () => {
    const memory = createMemoryNotifier('denied', { exactAlarms: 'denied' })
    await mount({ notifier: memory })
    await settle()
    expect(text('permission')).toBe('denied')
    expect(text('exact')).toBe('denied')
  })

  it('says that it cannot tell when the platform fails to answer the question about the permission or the exact alarms', async () => {
    const broken: MemoryNotifier = Object.assign(createMemoryNotifier('granted', { exactAlarms: 'granted' }), {
      permission: async (): Promise<never> => {
        throw new Error('the platform failed')
      },
      exactAlarms: async (): Promise<never> => {
        throw new Error('the platform failed')
      },
    })
    await mount({ notifier: broken })
    await settle()
    expect(text('permission')).toBe('unsupported')
    expect(text('exact')).toBe('unsupported')
  })

  it('keeps the permission as it was when asking fails, and the app goes on', async () => {
    const notifier = createMemoryNotifier('prompt')
    notifier.request = async () => {
      throw new Error('the platform failed')
    }
    await mount({ notifier })
    await settle()
    fireEvent.click(screen.getByText('ask'))
    await settle()
    expect(text('permission')).toBe('prompt')
  })

  it('opens the settings of the exact alarms, and is not troubled when that fails', async () => {
    const notifier = createMemoryNotifier('granted', { exactAlarms: 'denied' })
    await mount({ notifier })
    await settle()
    fireEvent.click(screen.getByText('settings'))
    expect(notifier.exactAlarmSettingsOpened).toBe(1)

    notifier.openExactAlarmSettings = async () => {
      throw new Error('no settings page')
    }
    fireEvent.click(screen.getByText('settings'))
    await settle()
    expect(text('exact')).toBe('denied')
  })

  it('works with the notifier of the browser where there is no Notification API, and says so', async () => {
    const web = createWebNotifier({ notification: null })
    await mount({ tasks: [task('t1')], notifier: web as unknown as MemoryNotifier })
    await settle()
    expect(text('permission')).toBe('unsupported')
    expect(text('exact')).toBe('unsupported')
    expect(text('problem')).toBe('')
  })
})

describe('RemindersProvider: the notifier it uses', () => {
  /** Mounts the provider with the notifier of the page (the demo's) and, perhaps, one of its own. */
  async function mountWithPage(page: MemoryNotifier, own?: MemoryNotifier) {
    const auth = await signedIn()
    const fake: FakeBackend = createFakeBackend({ tasks: [task('t1')] })
    render(
      <AuthProvider store={auth}>
        <BackendContext value={fake.backend}>
          <NotifierContext value={page}>
            <MemoryRouter>
              <TasksProvider>
                <RemindersProvider notifier={own}>
                  <Probe />
                </RemindersProvider>
              </TasksProvider>
            </MemoryRouter>
          </NotifierContext>
        </BackendContext>
      </AuthProvider>,
    )
    await settle()
  }

  it('uses the notifier that the page provides when it is not given one', async () => {
    const page = createMemoryNotifier('granted')
    await mountWithPage(page)
    expect(lastPlan(page).map((p) => p.taskId)).toEqual(['t1'])
    expect(text('permission')).toBe('granted')
  })

  it('prefers the notifier it is given to the one that the page provides', async () => {
    const page = createMemoryNotifier('granted')
    const own = createMemoryNotifier('denied')
    await mountWithPage(page, own)
    expect(lastPlan(own).map((p) => p.taskId)).toEqual(['t1'])
    expect(page.plans).toEqual([])
    expect(text('permission')).toBe('denied')
  })
})

describe('RemindersProvider: before the tasks are there', () => {
  /** The provider over a server whose first answer is slow, or fails. */
  async function mountLoading(options: { delayMs?: number; failFirst?: boolean }) {
    const auth = await signedIn()
    const fake: FakeBackend = createFakeBackend({ tasks: [task('t1')] })
    const load = fake.tasks.gateway.loadInitial
    let attempts = 0
    fake.tasks.gateway.loadInitial = async (when) => {
      attempts += 1
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs))
      if (options.failFirst && attempts === 1) throw Object.assign(new Error('offline'), { status: 0 })
      return load(when)
    }
    const notifier = createMemoryNotifier('granted')
    render(
      <AuthProvider store={auth}>
        <BackendContext value={fake.backend}>
          <MemoryRouter>
            <TasksProvider>
              <RemindersProvider notifier={notifier}>
                <Controls />
                <Probe />
              </RemindersProvider>
            </TasksProvider>
          </MemoryRouter>
        </BackendContext>
      </AuthProvider>,
    )
    return { notifier }
  }

  it('plans nothing, and so cancels nothing, while the tasks are still on their way, and then plans them', async () => {
    const { notifier } = await mountLoading({ delayMs: 2_000 })
    await settle(500)
    expect(notifier.plans).toEqual([])
    await settle(3_000)
    expect(notifier.plans.length).toBeGreaterThan(0)
    expect(notifier.plans.every((plan) => plan.length > 0)).toBe(true)
    expect(lastPlan(notifier).map((p) => p.taskId)).toEqual(['t1'])
  })

  it('leaves what is pending alone when the first load fails, and plans when a later one works', async () => {
    const { notifier } = await mountLoading({ failFirst: true })
    await settle(1_000)
    expect(notifier.plans).toEqual([])
    expect(notifier.cleared).toBe(0)

    await act(async () => void (await controls().load()))
    await settle()
    expect(lastPlan(notifier).map((p) => p.taskId)).toEqual(['t1'])
  })
})

describe('RemindersProvider: the state of the phone', () => {
  it('reads the permission and the exact alarms again when the app comes back to the front', async () => {
    const notifier = createMemoryNotifier('denied', { exactAlarms: 'denied' })
    await mount({ notifier })
    await settle()
    expect(text('permission')).toBe('denied')
    expect(text('exact')).toBe('denied')

    // The person allowed both in the settings of the phone, and came back.
    notifier.setPermission('granted')
    notifier.setExactAlarms('granted')
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    await settle()

    expect(text('permission')).toBe('granted')
    expect(text('exact')).toBe('granted')
  })

  it('plans again, so that what is pending becomes exact, when exact alarms were allowed in the page of the settings', async () => {
    const notifier = createMemoryNotifier('granted', { exactAlarms: 'denied' })
    notifier.openExactAlarmSettings = async () => {
      notifier.setExactAlarms('granted')
    }
    await mount({ tasks: [task('t1')], notifier })
    await settle()
    const plans = notifier.plans.length
    expect(text('exact')).toBe('denied')

    fireEvent.click(screen.getByText('settings'))
    await settle() // the state is read again
    await settle() // and the plan that follows it waits for the quarter of a second that changes are given

    expect(text('exact')).toBe('granted')
    expect(notifier.plans.length).toBeGreaterThan(plans)
  })

  it('shows the state as it is after the page of the settings was closed without a change', async () => {
    const notifier = createMemoryNotifier('granted', { exactAlarms: 'denied' })
    await mount({ notifier })
    await settle()
    fireEvent.click(screen.getByText('settings'))
    await settle()
    expect(text('exact')).toBe('denied')
    expect(notifier.exactAlarmSettingsOpened).toBe(1)
  })
})
