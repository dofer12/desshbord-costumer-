import { Capacitor } from '@capacitor/core'
import type { LocalNotificationsPlugin } from '@capacitor/local-notifications'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chooseNotifier, createMemoryNotifier, createWebNotifier, type NotificationCtor } from './notifier'
import type { PlannedNotification } from './reminders'

// The web notifier schedules with timers while the page is open and shows the notification itself.
// A pretend Notification class stands in for the browser.

class FakeNotification {
  static permission: NotificationPermission = 'default'
  static asked = 0
  static answer: NotificationPermission = 'granted'
  static shown: FakeNotification[] = []
  static requestPermission = async () => {
    FakeNotification.asked += 1
    FakeNotification.permission = FakeNotification.answer
    return FakeNotification.answer
  }
  onclick: (() => void) | null = null
  close = vi.fn()
  title: string
  options: NotificationOptions
  constructor(title: string, options: NotificationOptions = {}) {
    this.title = title
    this.options = options
    FakeNotification.shown.push(this)
  }
}
const Ctor = FakeNotification as unknown as NotificationCtor

const NOW = new Date('2026-10-16T09:00:00Z')
const MIN = 60_000

const plan = (id: number, minutesAhead: number, over: Partial<PlannedNotification> = {}): PlannedNotification => ({
  id,
  taskId: `task-${id}`,
  at: new Date(NOW.getTime() + minutesAhead * MIN),
  title: `תזכורת: משימה ${id}`,
  body: 'היום · 15:00',
  ...over,
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  FakeNotification.permission = 'granted'
  FakeNotification.answer = 'granted'
  FakeNotification.asked = 0
  FakeNotification.shown = []
})
afterEach(() => {
  vi.useRealTimers()
})

const advance = (minutes: number) => vi.advanceTimersByTimeAsync(minutes * MIN)

describe('createWebNotifier without the Notification API', () => {
  it('says so, asks for nothing, and plans nothing, without a failure', async () => {
    const notifier = createWebNotifier({ notification: null })
    expect(await notifier.permission()).toBe('unsupported')
    expect(await notifier.request()).toBe('unsupported')
    await expect(notifier.replaceAll([plan(1, 10)])).resolves.toBeUndefined()
    await expect(notifier.clear()).resolves.toBeUndefined()
    await advance(30)
    expect(FakeNotification.shown).toEqual([])
  })

  it('looks for the browser\'s own Notification when none is given, and finds none where there is none', async () => {
    // jsdom has no Notification, as an old WebView has none.
    expect(typeof Notification).toBe('undefined')
    expect(await createWebNotifier().permission()).toBe('unsupported')
  })

  it('has no exact alarms to speak of', () => {
    expect(createWebNotifier({ notification: null }).exactAlarms).toBeUndefined()
  })
})

describe('createWebNotifier: permission', () => {
  it.each([
    ['granted', 'granted'],
    ['denied', 'denied'],
    ['default', 'prompt'],
  ] as const)('reads "%s" as %s', async (browser, ours) => {
    FakeNotification.permission = browser
    expect(await createWebNotifier({ notification: Ctor }).permission()).toBe(ours)
  })

  it('asks the person and says what they answered', async () => {
    FakeNotification.permission = 'default'
    FakeNotification.answer = 'denied'
    const notifier = createWebNotifier({ notification: Ctor })
    expect(await notifier.request()).toBe('denied')
    expect(FakeNotification.asked).toBe(1)
    expect(await notifier.permission()).toBe('denied')
  })

  it('reports the permission it has when the question itself fails', async () => {
    FakeNotification.permission = 'default'
    const broken = Object.assign(class extends FakeNotification {}, {
      permission: 'default' as NotificationPermission,
      requestPermission: async () => {
        throw new Error('blocked')
      },
    }) as unknown as NotificationCtor
    expect(await createWebNotifier({ notification: broken }).request()).toBe('prompt')
  })
})

describe('createWebNotifier: showing at the planned time', () => {
  it('shows each notification when its time comes, with the title, the text, the number and Hebrew right to left', async () => {
    const notifier = createWebNotifier({ notification: Ctor })
    await notifier.replaceAll([plan(1, 10), plan(2, 20), plan(3, 30)])

    expect(FakeNotification.shown).toHaveLength(0)
    await advance(10)
    expect(FakeNotification.shown).toHaveLength(1)
    expect(FakeNotification.shown[0].title).toBe('תזכורת: משימה 1')
    expect(FakeNotification.shown[0].options).toMatchObject({ body: 'היום · 15:00', tag: '1', lang: 'he', dir: 'rtl' })
    await advance(10)
    expect(FakeNotification.shown).toHaveLength(2)
    await advance(10)
    expect(FakeNotification.shown.map((n) => n.title)).toEqual(['תזכורת: משימה 1', 'תזכורת: משימה 2', 'תזכורת: משימה 3'])
  })

  it('does not show one when the permission has been taken away by the time it comes', async () => {
    const notifier = createWebNotifier({ notification: Ctor })
    await notifier.replaceAll([plan(1, 10)])
    FakeNotification.permission = 'denied'
    await advance(10)
    expect(FakeNotification.shown).toEqual([])
  })

  it('shows nothing while the person has not been asked, or has not answered', async () => {
    FakeNotification.permission = 'default'
    const notifier = createWebNotifier({ notification: Ctor })
    await notifier.replaceAll([plan(1, 10)])
    await advance(10)
    expect(FakeNotification.shown).toEqual([])
  })

  it('forgets the old plan when a new one comes: no duplicate, and no old time', async () => {
    const notifier = createWebNotifier({ notification: Ctor })
    await notifier.replaceAll([plan(1, 10)])
    await notifier.replaceAll([plan(2, 20)])
    await advance(10)
    expect(FakeNotification.shown).toEqual([])
    await advance(10)
    expect(FakeNotification.shown.map((n) => n.title)).toEqual(['תזכורת: משימה 2'])
  })

  it('shows a notification once even when the same plan is made again', async () => {
    const notifier = createWebNotifier({ notification: Ctor })
    for (let i = 0; i < 5; i++) await notifier.replaceAll([plan(1, 10)])
    await advance(15)
    expect(FakeNotification.shown).toHaveLength(1)
  })

  it('cancels everything on clear', async () => {
    const notifier = createWebNotifier({ notification: Ctor })
    await notifier.replaceAll([plan(1, 10), plan(2, 20)])
    await notifier.clear()
    await advance(60)
    expect(FakeNotification.shown).toEqual([])
  })

  it('does not show what is already past, and does not set a timer that is too long for the clock to hold', async () => {
    const notifier = createWebNotifier({ notification: Ctor })
    // A time that has passed is stale (the plan is replaced often); a time a month away is beyond what a timer holds,
    // and would otherwise fire at once.
    await notifier.replaceAll([plan(1, -5), plan(2, 30 * 24 * 60)])
    await advance(120)
    expect(FakeNotification.shown).toEqual([])
  })
})

describe('createWebNotifier: a click', () => {
  it('focuses the window, opens the task and closes the notification', async () => {
    const focusWindow = vi.fn()
    const notifier = createWebNotifier({ notification: Ctor, focusWindow })
    const opened = vi.fn()
    notifier.onOpen(opened)
    await notifier.replaceAll([plan(7, 5)])
    await advance(5)

    FakeNotification.shown[0].onclick?.()

    expect(focusWindow).toHaveBeenCalledTimes(1)
    expect(opened).toHaveBeenCalledWith('task-7')
    expect(FakeNotification.shown[0].close).toHaveBeenCalled()
  })

  it('does not call a handler that has been removed, and goes on to the others when one throws', async () => {
    const notifier = createWebNotifier({ notification: Ctor, focusWindow: () => undefined })
    const removed = vi.fn()
    const broken = vi.fn(() => {
      throw new Error('handler failed')
    })
    const fine = vi.fn()
    notifier.onOpen(removed)()
    notifier.onOpen(broken)
    notifier.onOpen(fine)
    await notifier.replaceAll([plan(1, 5)])
    await advance(5)

    FakeNotification.shown[0].onclick?.()

    expect(removed).not.toHaveBeenCalled()
    expect(broken).toHaveBeenCalled()
    expect(fine).toHaveBeenCalledWith('task-1')
  })
})

describe('createWebNotifier: a click, with the window of the page as it is found', () => {
  afterEach(() => {
    delete window.mokedDesktop
    vi.restoreAllMocks()
  })

  async function clickOne() {
    const notifier = createWebNotifier({ notification: Ctor })
    const opened = vi.fn()
    notifier.onOpen(opened)
    await notifier.replaceAll([plan(7, 5)])
    await advance(5)
    FakeNotification.shown[0].onclick?.()
    return opened
  }

  it('asks the Windows app to show its window, which may be hidden in the tray, and focuses the page too', async () => {
    const showWindow = vi.fn()
    window.mokedDesktop = { showWindow }
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => undefined)

    const opened = await clickOne()

    expect(showWindow).toHaveBeenCalledTimes(1)
    expect(focus).toHaveBeenCalledTimes(1)
    expect(opened).toHaveBeenCalledWith('task-7')
  })

  it('opens the task, and still focuses the page, when the app cannot show its window', async () => {
    window.mokedDesktop = {
      showWindow: () => {
        throw new Error('the channel is closed')
      },
    }
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => undefined)

    const opened = await clickOne()

    expect(focus).toHaveBeenCalledTimes(1)
    expect(opened).toHaveBeenCalledWith('task-7')
  })

  it('opens the task, and still asks the app for its window, when the page cannot be focused', async () => {
    const showWindow = vi.fn()
    window.mokedDesktop = { showWindow }
    vi.spyOn(window, 'focus').mockImplementation(() => {
      throw new Error('not focusable')
    })

    const opened = await clickOne()

    expect(showWindow).toHaveBeenCalledTimes(1)
    expect(opened).toHaveBeenCalledWith('task-7')
  })

  it('works as it did in a browser, where no app stands behind the page', async () => {
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => undefined)

    const opened = await clickOne()

    expect(focus).toHaveBeenCalledTimes(1)
    expect(opened).toHaveBeenCalledWith('task-7')
  })
})

describe('createMemoryNotifier', () => {
  it('keeps every plan it was given, counts the clears and answers the permission it was told to', async () => {
    const notifier = createMemoryNotifier('prompt')
    expect(await notifier.permission()).toBe('prompt')
    expect(await notifier.request()).toBe('granted')
    expect(await notifier.permission()).toBe('granted')

    await notifier.replaceAll([plan(1, 5)])
    await notifier.replaceAll([])
    await notifier.clear()
    expect(notifier.plans.map((p) => p.length)).toEqual([1, 0])
    expect(notifier.cleared).toBe(1)
  })

  it('calls the handlers when told that a notification was opened, and can be made to fail once', async () => {
    const notifier = createMemoryNotifier('granted')
    const opened = vi.fn()
    const off = notifier.onOpen(opened)
    notifier.opened('task-1')
    off()
    notifier.opened('task-2')
    expect(opened.mock.calls).toEqual([['task-1']])

    notifier.failNext(new Error('no'))
    await expect(notifier.replaceAll([])).rejects.toThrow('no')
    await expect(notifier.replaceAll([])).resolves.toBeUndefined()
  })

  it('stands in for the exact alarms when it is told to', async () => {
    const notifier = createMemoryNotifier('granted', { exactAlarms: 'denied' })
    expect(await notifier.exactAlarms?.()).toBe('denied')
    await notifier.openExactAlarmSettings?.()
    expect(notifier.exactAlarmSettingsOpened).toBe(1)
  })
})

describe('chooseNotifier', () => {
  const phone = { checkPermissions: async () => ({ display: 'granted' }) } as unknown as LocalNotificationsPlugin

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is the notifier of the browser where the app runs in a browser', async () => {
    // jsdom has no Notification, so the notifier of the browser says that there is none.
    expect(await chooseNotifier({ native: false, plugin: phone }).permission()).toBe('unsupported')
  })

  it('is the notifier of the phone where the app runs as the Android app', async () => {
    expect(await chooseNotifier({ native: true, plugin: phone }).permission()).toBe('granted')
  })

  it('asks Capacitor where it runs when it is not told, and is a notifier of the browser in a test', () => {
    // Only the notifier of the phone has exact alarms to speak of.
    expect(chooseNotifier().exactAlarms).toBeUndefined()
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)
    expect(chooseNotifier({ plugin: phone }).exactAlarms).toBeTypeOf('function')
  })
})

describe('createMemoryNotifier: exact alarms that change', () => {
  it('answers with what it was last told, and can be told that the person allowed them', async () => {
    const notifier = createMemoryNotifier('granted', { exactAlarms: 'denied' })
    expect(await notifier.exactAlarms?.()).toBe('denied')
    notifier.setExactAlarms('granted')
    expect(await notifier.exactAlarms?.()).toBe('granted')
  })

  it('starts to model exact alarms when it is told about them, though it was made without', async () => {
    const notifier = createMemoryNotifier('granted')
    expect(notifier.exactAlarms).toBeUndefined()
    notifier.setExactAlarms('denied')
    expect(await notifier.exactAlarms?.()).toBe('denied')
    await notifier.openExactAlarmSettings?.()
    expect(notifier.exactAlarmSettingsOpened).toBe(1)
  })
})
