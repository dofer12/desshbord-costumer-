import type { LocalNotificationsPlugin } from '@capacitor/local-notifications'
import { describe, expect, it, vi } from 'vitest'
import { createNativeNotifier } from './nativeNotifier'
import type { PlannedNotification } from './reminders'

// The notifier of Android: Capacitor's local notifications behind the interface of the app. A pretend
// plugin stands in for the phone: it keeps what is pending, and what was asked of it, in order.

type Listener = (action: { actionId: string; notification: { id: number; extra?: unknown } }) => void

interface Pretend {
  plugin: LocalNotificationsPlugin
  pending: Array<{ id: number }>
  calls: string[]
  listeners: Set<Listener>
  removed: number
  state: { display: string; exact: string | Error }
  scheduled: unknown[]
  /** What the real plugin would have put on the screen in the middle of a call. */
  prompts: { settings: number; permission: number }
}

function pretend(over: { scheduleFails?: Error; channelFails?: Error } = {}): Pretend {
  const pending: Array<{ id: number }> = []
  const listeners = new Set<Listener>()
  const calls: string[] = []
  const scheduled: unknown[] = []
  const prompts: Pretend['prompts'] = { settings: 0, permission: 0 }
  const state: Pretend['state'] = { display: 'granted', exact: 'granted' }
  // A phone before Android 12 has no setting of exact alarms, and has none to ask for.
  const exactAllowed = () => state.exact instanceof Error || state.exact === 'granted'
  let removed = 0
  let channelFails = over.channelFails
  const fake = {
    checkPermissions: vi.fn(async () => ({ display: state.display })),
    requestPermissions: vi.fn(async () => {
      if (state.display === 'prompt' || state.display === 'prompt-with-rationale') state.display = 'granted'
      return { display: state.display }
    }),
    checkExactNotificationSetting: vi.fn(async () => {
      if (state.exact instanceof Error) throw state.exact
      return { exact_alarm: state.exact }
    }),
    changeExactNotificationSetting: vi.fn(async () => {
      calls.push('changeExact')
      return { exact_alarm: 'granted' }
    }),
    createChannel: vi.fn(async () => {
      calls.push('createChannel')
      if (channelFails) {
        const error = channelFails
        channelFails = undefined
        throw error
      }
    }),
    getPending: vi.fn(async () => {
      calls.push('getPending')
      return { notifications: pending.map((n) => ({ ...n })) }
    }),
    cancel: vi.fn(async ({ notifications }: { notifications: Array<{ id: number }> }) => {
      calls.push('cancel')
      for (const { id } of notifications) {
        const at = pending.findIndex((n) => n.id === id)
        if (at >= 0) pending.splice(at, 1)
      }
    }),
    schedule: vi.fn(async ({ notifications }: { notifications: Array<{ id: number; isExactNotification?: boolean }> }) => {
      calls.push('schedule')
      // What the plugin of Capacitor really does (8.3.1, LocalNotificationsPlugin.kt): on Android 13 a
      // call made before the permission was given asks for it in the middle of the call, and a call that
      // holds a notification that wants an exact alarm (the default) opens the page of the settings when
      // exact alarms are not allowed. Each of them waits for the person, over the app.
      if (state.display !== 'granted') prompts.permission += 1
      if (notifications.some((n) => n.isExactNotification !== false) && !exactAllowed()) prompts.settings += 1
      if (over.scheduleFails) throw over.scheduleFails
      scheduled.push(...notifications)
      for (const { id } of notifications) pending.push({ id })
      return { notifications: notifications.map(({ id }) => ({ id })) }
    }),
    addListener: vi.fn(async (_name: string, listener: Listener) => {
      listeners.add(listener)
      return {
        remove: async () => {
          removed += 1
          listeners.delete(listener)
        },
      }
    }),
  }
  return {
    plugin: fake as unknown as LocalNotificationsPlugin,
    pending,
    calls,
    listeners,
    get removed() {
      return removed
    },
    state,
    scheduled,
    prompts,
  }
}

const at = new Date('2026-10-16T09:30:00Z')
const plan = (id: number, over: Partial<PlannedNotification> = {}): PlannedNotification => ({
  id,
  taskId: `task-${id}`,
  at: new Date(at.getTime() + id * 60_000),
  title: `תזכורת: משימה ${id}`,
  body: 'היום · 15:00',
  ...over,
})

describe('createNativeNotifier: the permission', () => {
  it.each([
    ['granted', 'granted'],
    ['denied', 'denied'],
    ['prompt', 'prompt'],
    ['prompt-with-rationale', 'prompt'],
  ] as const)('reads "%s" as %s', async (display, ours) => {
    const phone = pretend()
    phone.state.display = display
    expect(await createNativeNotifier(phone.plugin).permission()).toBe(ours)
  })

  it('asks the person and says what they answered', async () => {
    const phone = pretend()
    phone.state.display = 'prompt'
    const notifier = createNativeNotifier(phone.plugin)
    expect(await notifier.request()).toBe('granted')
    expect(await notifier.permission()).toBe('granted')
  })

  it('says what a person who refused answered', async () => {
    const phone = pretend()
    phone.state.display = 'denied'
    expect(await createNativeNotifier(phone.plugin).request()).toBe('denied')
  })

  it('says that notifications are not supported when the plugin cannot say', async () => {
    const phone = pretend()
    ;(phone.plugin.checkPermissions as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not implemented'))
    ;(phone.plugin.requestPermissions as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not implemented'))
    const notifier = createNativeNotifier(phone.plugin)
    expect(await notifier.permission()).toBe('unsupported')
    expect(await notifier.request()).toBe('unsupported')
  })
})

describe('createNativeNotifier: replaceAll', () => {
  it('makes the channel once, with its name and a high importance, however many plans there are', async () => {
    const phone = pretend()
    const notifier = createNativeNotifier(phone.plugin)
    await notifier.replaceAll([plan(1)])
    await notifier.replaceAll([plan(2)])
    await notifier.replaceAll([])
    expect(phone.plugin.createChannel).toHaveBeenCalledTimes(1)
    expect(phone.plugin.createChannel).toHaveBeenCalledWith(expect.objectContaining({ id: 'reminders', name: 'תזכורות', importance: 4 }))
  })

  it('cancels what was pending, and then schedules the plan, in that order', async () => {
    const phone = pretend()
    phone.pending.push({ id: 90 }, { id: 91 })
    await createNativeNotifier(phone.plugin).replaceAll([plan(1), plan(2)])
    expect(phone.calls).toEqual(['createChannel', 'getPending', 'cancel', 'schedule'])
    expect(phone.plugin.cancel).toHaveBeenCalledWith({ notifications: [{ id: 90 }, { id: 91 }] })
    expect(phone.pending.map((n) => n.id)).toEqual([1, 2])
  })

  it('schedules each notification at its time, allowed while the phone is idle, on the channel, with the small icon and the task', async () => {
    const phone = pretend()
    await createNativeNotifier(phone.plugin).replaceAll([plan(7)])
    expect(phone.scheduled).toEqual([
      {
        id: 7,
        title: 'תזכורת: משימה 7',
        body: 'היום · 15:00',
        schedule: { at: plan(7).at, allowWhileIdle: true },
        isExactNotification: true,
        channelId: 'reminders',
        smallIcon: 'ic_stat_moked',
        extra: { taskId: 'task-7' },
      },
    ])
  })

  describe('what the plugin would otherwise put on the screen by itself', () => {
    it('schedules as inexact, and opens no settings page, while exact alarms are not allowed (the state of a new install on Android 14)', async () => {
      const phone = pretend()
      phone.state.exact = 'denied'
      await createNativeNotifier(phone.plugin).replaceAll([plan(1), plan(2)])
      expect(phone.prompts.settings).toBe(0)
      expect(phone.scheduled).toHaveLength(2)
      expect(phone.scheduled).toEqual([expect.objectContaining({ id: 1, isExactNotification: false }), expect.objectContaining({ id: 2, isExactNotification: false })])
    })

    it('schedules as exact when exact alarms are allowed, and looks at that again for every plan', async () => {
      const phone = pretend()
      phone.state.exact = 'denied'
      const notifier = createNativeNotifier(phone.plugin)
      await notifier.replaceAll([plan(1)])
      phone.state.exact = 'granted' // the person allowed them in the settings
      await notifier.replaceAll([plan(1)])
      expect(phone.scheduled).toEqual([expect.objectContaining({ isExactNotification: false }), expect.objectContaining({ isExactNotification: true })])
      expect(phone.prompts.settings).toBe(0)
    })

    it('takes a phone that cannot tell about exact alarms (before Android 12) as one that has them', async () => {
      const phone = pretend()
      phone.state.exact = new Error('not implemented')
      await createNativeNotifier(phone.plugin).replaceAll([plan(1)])
      expect(phone.scheduled).toEqual([expect.objectContaining({ isExactNotification: true })])
      expect(phone.prompts.settings).toBe(0)
    })

    it.each(['denied', 'prompt', 'prompt-with-rationale'])('hands no plan over while notifications are "%s", so that the plugin asks for nothing, and still cancels what was pending', async (display) => {
      const phone = pretend()
      phone.state.display = display
      phone.pending.push({ id: 90 })
      await createNativeNotifier(phone.plugin).replaceAll([plan(1)])
      expect(phone.plugin.schedule).not.toHaveBeenCalled()
      expect(phone.prompts).toEqual({ settings: 0, permission: 0 })
      expect(phone.pending).toEqual([])
    })

    it('does not hold the next plan up for ever when a call of the phone is never answered', async () => {
      vi.useFakeTimers()
      try {
        const phone = pretend()
        const notifier = createNativeNotifier(phone.plugin, { timeoutMs: 5_000 })
        ;(phone.plugin.schedule as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise(() => undefined))
        const first = notifier.replaceAll([plan(1)])
        const second = notifier.replaceAll([plan(2)])
        const firstFailed = expect(first).rejects.toThrow()
        await vi.advanceTimersByTimeAsync(5_000)
        await firstFailed
        await vi.advanceTimersByTimeAsync(0)
        await second
        expect(phone.pending.map((n) => n.id)).toEqual([2])
      } finally {
        vi.useRealTimers()
      }
    })

    it.each([
      ['makes the channel', 'createChannel'],
      ['asks what is pending', 'getPending'],
      ['cancels what is pending', 'cancel'],
      ['asks whether notifications are allowed', 'checkPermissions'],
      ['asks whether exact alarms are allowed', 'checkExactNotificationSetting'],
      ['schedules', 'schedule'],
    ] as const)('gives up on the call that %s when the phone never answers it, and does the next plan', async (_what, method) => {
      vi.useFakeTimers()
      try {
        const phone = pretend()
        phone.pending.push({ id: 90 }) // so that there is something to cancel
        const notifier = createNativeNotifier(phone.plugin, { timeoutMs: 5_000 })
        ;(phone.plugin[method] as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise(() => undefined))
        const first = expect(notifier.replaceAll([plan(1)])).rejects.toThrow()
        await vi.advanceTimersByTimeAsync(5_000)
        await first
        // A question about exact alarms that is not answered is not a yes: scheduling as exact may open the settings.
        expect(phone.prompts).toEqual({ settings: 0, permission: 0 })
        await notifier.replaceAll([plan(2)])
        expect(phone.pending.map((n) => n.id)).toEqual([2])
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not time out a call that answers in time, and leaves no timer running behind it', async () => {
      vi.useFakeTimers()
      try {
        const phone = pretend()
        const notifier = createNativeNotifier(phone.plugin, { timeoutMs: 5_000 })
        ;(phone.plugin.getPending as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
          await new Promise((resolve) => setTimeout(resolve, 4_000))
          return { notifications: [] }
        })
        const planning = notifier.replaceAll([plan(1)])
        await vi.advanceTimersByTimeAsync(4_000)
        await planning
        expect(phone.pending.map((n) => n.id)).toEqual([1])
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('only cancels when the plan is empty, and does not ask to cancel when nothing is pending', async () => {
    const phone = pretend()
    phone.pending.push({ id: 5 })
    const notifier = createNativeNotifier(phone.plugin)
    await notifier.replaceAll([])
    expect(phone.plugin.schedule).not.toHaveBeenCalled()
    expect(phone.pending).toEqual([])
    await notifier.replaceAll([])
    expect(phone.plugin.cancel).toHaveBeenCalledTimes(1)
  })

  it('replaces a notification that is pending under the same number, and does not duplicate it', async () => {
    const phone = pretend()
    const notifier = createNativeNotifier(phone.plugin)
    await notifier.replaceAll([plan(5), plan(6)])
    await notifier.replaceAll([plan(5, { title: 'תזכורת: חדשה' })])
    expect(phone.pending.map((n) => n.id)).toEqual([5])
    expect(phone.plugin.cancel).toHaveBeenLastCalledWith({ notifications: [{ id: 5 }, { id: 6 }] })
  })

  it('rejects when the phone refuses to schedule, so that the provider can say so', async () => {
    const phone = pretend({ scheduleFails: new Error('exact alarms are not allowed') })
    await expect(createNativeNotifier(phone.plugin).replaceAll([plan(1)])).rejects.toThrow('exact alarms are not allowed')
  })

  it('rejects when the channel cannot be made, and makes it again the next time', async () => {
    const phone = pretend({ channelFails: new Error('no channel') })
    const notifier = createNativeNotifier(phone.plugin)
    await expect(notifier.replaceAll([plan(1)])).rejects.toThrow('no channel')
    await notifier.replaceAll([plan(1)])
    expect(phone.plugin.createChannel).toHaveBeenCalledTimes(2)
    expect(phone.pending.map((n) => n.id)).toEqual([1])
  })

  it('does one plan after another when they are asked for together, and the last one stays', async () => {
    const phone = pretend()
    const notifier = createNativeNotifier(phone.plugin)
    await Promise.all([notifier.replaceAll([plan(1), plan(2)]), notifier.replaceAll([plan(3)]), notifier.replaceAll([plan(4), plan(5)])])
    expect(phone.pending.map((n) => n.id)).toEqual([4, 5])
  })

  it('goes on with the next plan after one that failed', async () => {
    const phone = pretend()
    const notifier = createNativeNotifier(phone.plugin)
    ;(phone.plugin.schedule as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('once'))
    const first = notifier.replaceAll([plan(1)])
    const second = notifier.replaceAll([plan(2)])
    await expect(first).rejects.toThrow('once')
    await second
    expect(phone.pending.map((n) => n.id)).toEqual([2])
  })
})

describe('createNativeNotifier: clear', () => {
  it('cancels everything that is pending, and nothing when nothing is', async () => {
    const phone = pretend()
    const notifier = createNativeNotifier(phone.plugin)
    await notifier.clear()
    expect(phone.plugin.cancel).not.toHaveBeenCalled()
    phone.pending.push({ id: 1 }, { id: 2 })
    await notifier.clear()
    expect(phone.pending).toEqual([])
  })

  it('waits for a plan that is being made', async () => {
    const phone = pretend()
    const notifier = createNativeNotifier(phone.plugin)
    const planning = notifier.replaceAll([plan(1)])
    await notifier.clear()
    await planning
    expect(phone.pending).toEqual([])
  })
})

describe('createNativeNotifier: a tap on a notification', () => {
  const tap = (phone: Pretend, extra: unknown) => {
    for (const listener of [...phone.listeners]) listener({ actionId: 'tap', notification: { id: 1, extra } })
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('calls the handler with the id of the task', async () => {
    const phone = pretend()
    const handler = vi.fn()
    createNativeNotifier(phone.plugin).onOpen(handler)
    await settle()
    tap(phone, { taskId: 'task-9' })
    expect(handler).toHaveBeenCalledWith('task-9')
    expect(phone.plugin.addListener).toHaveBeenCalledWith('localNotificationActionPerformed', expect.any(Function))
  })

  it('listens once for each handler, and calls each', async () => {
    const phone = pretend()
    const notifier = createNativeNotifier(phone.plugin)
    const [a, b] = [vi.fn(), vi.fn()]
    notifier.onOpen(a)
    notifier.onOpen(b)
    await settle()
    expect(phone.plugin.addListener).toHaveBeenCalledTimes(2)
    tap(phone, { taskId: 't' })
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 1])
  })

  it.each([
    ['nothing', undefined],
    ['no task', {}],
    ['a task that is not text', { taskId: 5 }],
    ['an empty task', { taskId: '' }],
    ['something that is not an object', 'task-1'],
  ])('ignores a notification with %s in it', async (_name, extra) => {
    const phone = pretend()
    const handler = vi.fn()
    createNativeNotifier(phone.plugin).onOpen(handler)
    await settle()
    tap(phone, extra)
    expect(handler).not.toHaveBeenCalled()
  })

  it('stops listening when the way to stop is used, also when it is used before the plugin has answered', async () => {
    const phone = pretend()
    const notifier = createNativeNotifier(phone.plugin)
    const handler = vi.fn()
    notifier.onOpen(handler)()
    await settle()
    expect(phone.listeners.size).toBe(0)
    expect(phone.removed).toBe(1)

    const second = vi.fn()
    const stop = notifier.onOpen(second)
    await settle()
    stop()
    await settle()
    tap(phone, { taskId: 'x' })
    expect(second).not.toHaveBeenCalled()
    expect(phone.removed).toBe(2)
  })

  it('stops once, however many times the way to stop is used', async () => {
    const phone = pretend()
    const stop = createNativeNotifier(phone.plugin).onOpen(vi.fn())
    await settle()
    stop()
    stop()
    await settle()
    expect(phone.removed).toBe(1)
  })

  it('has nothing to report, and nothing to stop, when the plugin cannot listen', async () => {
    const phone = pretend()
    ;(phone.plugin.addListener as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not implemented'))
    const stop = createNativeNotifier(phone.plugin).onOpen(vi.fn())
    await settle()
    expect(() => stop()).not.toThrow()
    await settle()
    expect(phone.removed).toBe(0)
  })

  it('leaves no failure unhandled when the plugin cannot listen and nobody stops listening', async () => {
    // A plain function and not a spy: a spy watches the promises that it returns, and that counts as handling them.
    const plugin = { ...pretend().plugin, addListener: () => Promise.reject(new Error('not implemented')) } as unknown as LocalNotificationsPlugin
    const failures: unknown[] = []
    const onUnhandled = (reason: unknown) => void failures.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      createNativeNotifier(plugin).onOpen(vi.fn())
      await settle()
      await settle()
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    expect(failures).toEqual([])
  })

  it('goes on with the other handlers when one of them throws', async () => {
    const phone = pretend()
    const notifier = createNativeNotifier(phone.plugin)
    const broken = vi.fn(() => {
      throw new Error('handler failed')
    })
    const fine = vi.fn()
    notifier.onOpen(broken)
    notifier.onOpen(fine)
    await settle()
    expect(() => tap(phone, { taskId: 'x' })).not.toThrow()
    expect(fine).toHaveBeenCalledWith('x')
  })
})

describe('createNativeNotifier: exact alarms', () => {
  it('says whether they are allowed', async () => {
    const phone = pretend()
    const notifier = createNativeNotifier(phone.plugin)
    phone.state.exact = 'granted'
    expect(await notifier.exactAlarms?.()).toBe('granted')
    phone.state.exact = 'denied'
    expect(await notifier.exactAlarms?.()).toBe('denied')
  })

  it('counts anything that is not a yes as a no, because the reminder may then come late', async () => {
    const phone = pretend()
    phone.state.exact = 'prompt'
    expect(await createNativeNotifier(phone.plugin).exactAlarms?.()).toBe('denied')
  })

  it('says yes where the phone has no such setting', async () => {
    const phone = pretend()
    phone.state.exact = new Error('not implemented')
    expect(await createNativeNotifier(phone.plugin).exactAlarms?.()).toBe('granted')
  })

  it('opens the settings where they are allowed', async () => {
    const phone = pretend()
    await createNativeNotifier(phone.plugin).openExactAlarmSettings?.()
    expect(phone.plugin.changeExactNotificationSetting).toHaveBeenCalledTimes(1)
  })
})
