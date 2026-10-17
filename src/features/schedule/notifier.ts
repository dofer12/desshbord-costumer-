import { Capacitor } from '@capacitor/core'
import { LocalNotifications, type LocalNotificationsPlugin } from '@capacitor/local-notifications'
import { createNativeNotifier } from './nativeNotifier'
import type { PlannedNotification } from './reminders'

// The part of the platform that shows a notification at a planned time. The rest of the app plans
// (reminders.ts) and asks this interface to carry the plan out; what is behind it is the browser's
// Notification API with timers (here), Capacitor's local notifications on Android (nativeNotifier.ts),
// or a recorder for tests and the demo.

export type Permission = 'granted' | 'denied' | 'prompt' | 'unsupported'

export interface Notifier {
  permission(): Promise<Permission>
  /** Asks the person, where the platform asks. Resolves with the answer. */
  request(): Promise<Permission>
  /** Makes this plan the only one that is pending: everything planned before is cancelled. */
  replaceAll(plan: PlannedNotification[]): Promise<void>
  /** Cancels every pending notification. */
  clear(): Promise<void>
  /** Calls the handler with the id of the task when a notification is tapped. Returns the way to stop. */
  onOpen(handler: (taskId: string) => void): () => void
  /** Android only: whether exact alarms are allowed. Without them a notification comes approximately. */
  exactAlarms?(): Promise<'granted' | 'denied'>
  /** Android only: opens the page of the settings where exact alarms are allowed. */
  openExactAlarmSettings?(): Promise<void>
}

/** The part of the browser's Notification that is used, so that a test can put another in its place. */
export interface NotificationCtor {
  new (title: string, options?: NotificationOptions): { onclick: ((event: unknown) => unknown) | null; close(): void }
  readonly permission: NotificationPermission
  requestPermission(): Promise<NotificationPermission>
}

/** The longest delay a timer can hold: a longer one is understood as no delay at all. */
const MAX_TIMER_MS = 2_147_483_647

const fromBrowser = (permission: NotificationPermission): Permission => (permission === 'default' ? 'prompt' : permission)

/**
 * Shows notifications with the Notification API while the page (or the window of the Windows app) is
 * open: each planned notification is a timer. `notification: null` is a platform that has none, as an
 * old WebView; leaving it out takes the browser's own, if there is one.
 */
export function createWebNotifier(
  deps: { notification?: NotificationCtor | null; focusWindow?: () => void } = {},
): Notifier {
  const Ctor: NotificationCtor | null =
    deps.notification === undefined ? (typeof Notification === 'undefined' ? null : (Notification as unknown as NotificationCtor)) : deps.notification
  const focusWindow =
    deps.focusWindow ??
    (() => {
      // The Windows app keeps its window hidden in the tray, and only the app itself can show it again.
      try {
        globalThis.window?.mokedDesktop?.showWindow()
      } catch {
        // A window that cannot be asked for is not worth a failure.
      }
      try {
        globalThis.window?.focus()
      } catch {
        // A window that cannot be focused is not worth a failure.
      }
    })
  const handlers = new Set<(taskId: string) => void>()
  let timers: Array<ReturnType<typeof setTimeout>> = []

  function cancel() {
    for (const timer of timers) clearTimeout(timer)
    timers = []
  }

  function show(item: PlannedNotification) {
    // The permission is looked at when the time comes: it may have been taken away since the plan was made.
    if (!Ctor || Ctor.permission !== 'granted') return
    const notification = new Ctor(item.title, { body: item.body, tag: String(item.id), lang: 'he', dir: 'rtl' })
    notification.onclick = () => {
      focusWindow()
      for (const handler of [...handlers]) {
        try {
          handler(item.taskId)
        } catch {
          // One handler that fails must not keep the others from opening the task.
        }
      }
      notification.close()
    }
  }

  return {
    async permission() {
      return Ctor ? fromBrowser(Ctor.permission) : 'unsupported'
    },
    async request() {
      if (!Ctor) return 'unsupported'
      try {
        await Ctor.requestPermission()
      } catch {
        // The question itself failed: report the permission there is.
      }
      return fromBrowser(Ctor.permission)
    },
    async replaceAll(plan) {
      cancel()
      if (!Ctor) return
      for (const item of plan) {
        const delay = item.at.getTime() - Date.now()
        // A time that has passed is stale, and one too far ahead for a timer would fire at once.
        if (delay <= 0 || delay > MAX_TIMER_MS) continue
        timers.push(setTimeout(() => show(item), delay))
      }
    },
    async clear() {
      cancel()
    },
    onOpen(handler) {
      handlers.add(handler)
      return () => void handlers.delete(handler)
    },
  }
}

/** A notifier for tests and the demo: it keeps what it is asked and shows nothing. */
export interface MemoryNotifier extends Notifier {
  /** Every plan it was given, in order. */
  plans: PlannedNotification[][]
  /** How many times it was told to cancel everything. */
  cleared: number
  /** How many times the settings of the exact alarms were asked for. */
  exactAlarmSettingsOpened: number
  /** Pretends that a notification of the task was tapped. */
  opened(taskId: string): void
  /** The next call of `replaceAll` fails with this error. */
  failNext(error: unknown): void
  setPermission(permission: Permission): void
  /** The platform has exact alarms from now on, in this state (the person allowed them, or took them away). */
  setExactAlarms(state: 'granted' | 'denied'): void
}

export function createMemoryNotifier(
  initial: Permission = 'prompt',
  options: { exactAlarms?: 'granted' | 'denied' } = {},
): MemoryNotifier {
  let permission = initial
  let exact = options.exactAlarms
  const handlers = new Set<(taskId: string) => void>()
  const failures: unknown[] = []
  const notifier: MemoryNotifier = {
    plans: [],
    cleared: 0,
    exactAlarmSettingsOpened: 0,
    async permission() {
      return permission
    },
    async request() {
      if (permission === 'prompt') permission = 'granted'
      return permission
    },
    async replaceAll(plan) {
      if (failures.length > 0) throw failures.shift()
      notifier.plans.push([...plan])
    },
    async clear() {
      notifier.cleared += 1
    },
    onOpen(handler) {
      handlers.add(handler)
      return () => void handlers.delete(handler)
    },
    opened(taskId) {
      for (const handler of [...handlers]) handler(taskId)
    },
    failNext(error) {
      failures.push(error)
    },
    setPermission(next) {
      permission = next
    },
    setExactAlarms(next) {
      exact = next
      modelExactAlarms()
    },
  }
  // Only a platform that has exact alarms answers about them: the others leave both methods out.
  function modelExactAlarms() {
    notifier.exactAlarms ??= async () => exact ?? 'granted'
    notifier.openExactAlarmSettings ??= async () => {
      notifier.exactAlarmSettingsOpened += 1
    }
  }
  if (exact) modelExactAlarms()
  return notifier
}

/**
 * The notifier of the platform the app runs on: Capacitor's local notifications in the Android app,
 * and the Notification API with timers anywhere else (a browser, and the window of the Windows app).
 * The arguments are for tests.
 */
export function chooseNotifier(deps: { native?: boolean; plugin?: LocalNotificationsPlugin } = {}): Notifier {
  const native = deps.native ?? Capacitor.isNativePlatform()
  return native ? createNativeNotifier(deps.plugin ?? LocalNotifications) : createWebNotifier()
}
