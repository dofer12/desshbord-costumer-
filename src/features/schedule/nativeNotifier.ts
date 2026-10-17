import type { LocalNotificationsPlugin, PermissionStatus } from '@capacitor/local-notifications'
import type { Notifier, Permission } from './notifier'

// The notifier of Android: Capacitor's local notifications behind the interface of the app. The
// notifications are planned for the next two days and replaced as a whole on every change, so what is
// pending on the phone is always the plan of now. They are scheduled with `allowWhileIdle`, so that
// they come when the phone is dozing, and exactly when the person has allowed exact alarms.

const CHANNEL_ID = 'reminders'
const CHANNEL_NAME = 'תזכורות'
const CHANNEL_DESCRIPTION = 'תזכורות לפני המועד של משימה'
const SMALL_ICON = 'ic_stat_moked'
/** Android's importance "high": the notification makes a sound and shows over what is on the screen. */
const IMPORTANCE_HIGH = 4
/** How long a call of the phone may take. Nothing that is waited for with this limit waits for a person. */
const DEFAULT_TIMEOUT_MS = 20_000

class PhoneTimeout extends Error {
  constructor() {
    super('The phone did not answer in time.')
  }
}

function fromPlugin(display: PermissionStatus['display']): Permission {
  if (display === 'granted') return 'granted'
  if (display === 'denied') return 'denied'
  return 'prompt'
}

/** The id of the task that a notification was made for, or null for a notification that has none. */
function taskIdOf(extra: unknown): string | null {
  const taskId = (extra as { taskId?: unknown } | null | undefined)?.taskId
  return typeof taskId === 'string' && taskId !== '' ? taskId : null
}

export function createNativeNotifier(plugin: LocalNotificationsPlugin, options: { timeoutMs?: number } = {}): Notifier {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let channel: Promise<void> | null = null
  let queue: Promise<unknown> = Promise.resolve()

  /** One thing at a time: a plan is made after the one before it is done, so the last plan asked for is the one that stays. */
  function inTurn<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(work)
    queue = run.catch(() => undefined)
    return run
  }

  /** A call that is never answered (a page that was lost, a service that hung) must not hold every plan behind it. */
  function bounded<T>(call: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new PhoneTimeout()), timeoutMs)
    })
    return Promise.race([call, timeout]).finally(() => clearTimeout(timer))
  }

  function ensureChannel(): Promise<void> {
    channel ??= bounded(
      plugin.createChannel({ id: CHANNEL_ID, name: CHANNEL_NAME, description: CHANNEL_DESCRIPTION, importance: IMPORTANCE_HIGH, vibration: true }),
    ).catch((error: unknown) => {
      // Made again the next time, not given up for good.
      channel = null
      throw error
    })
    return channel
  }

  async function cancelPending(): Promise<void> {
    const { notifications } = await bounded(plugin.getPending())
    if (notifications.length > 0) await bounded(plugin.cancel({ notifications: notifications.map(({ id }) => ({ id })) }))
  }

  /** Whether exact alarms are allowed now. It is looked at for every plan: the person may allow them at any time. */
  async function exactNow(): Promise<boolean> {
    try {
      return (await bounded(plugin.checkExactNotificationSetting())).exact_alarm === 'granted'
    } catch (error) {
      if (error instanceof PhoneTimeout) throw error
      // A phone that cannot tell (before Android 12) has no such limit.
      return true
    }
  }

  return {
    async permission() {
      try {
        return fromPlugin((await plugin.checkPermissions()).display)
      } catch {
        return 'unsupported'
      }
    },

    async request() {
      try {
        return fromPlugin((await plugin.requestPermissions()).display)
      } catch {
        return 'unsupported'
      }
    },

    replaceAll: (plan) =>
      inTurn(async () => {
        await ensureChannel()
        await cancelPending()
        if (plan.length === 0) return
        // The plugin asks for the permission of Android 13, and opens the page of the exact alarms, by itself in
        // the middle of schedule(): over the app, and again at every plan until the person gives in. Both
        // questions belong to the banner of the Today screen, so a plan is handed over only when notifications
        // are allowed, and as inexact when exact alarms are not.
        if (fromPlugin((await bounded(plugin.checkPermissions())).display) !== 'granted') return
        const exact = await exactNow()
        await bounded(
          plugin.schedule({
            notifications: plan.map((item) => ({
              id: item.id,
              title: item.title,
              body: item.body,
              schedule: { at: item.at, allowWhileIdle: true },
              isExactNotification: exact,
              channelId: CHANNEL_ID,
              smallIcon: SMALL_ICON,
              extra: { taskId: item.taskId },
            })),
          }),
        )
      }),

    clear: () => inTurn(cancelPending),

    onOpen(handler) {
      const listening = plugin.addListener('localNotificationActionPerformed', (action) => {
        const taskId = taskIdOf(action.notification.extra)
        if (taskId === null) return
        try {
          handler(taskId)
        } catch {
          // A handler that fails is not the plugin's business.
        }
      })
      // A plugin that cannot listen is a platform without notifications: nothing to stop, nothing to report.
      listening.catch(() => undefined)
      let stopped = false
      return () => {
        if (stopped) return
        stopped = true
        void listening.then((handle) => handle.remove()).catch(() => undefined)
      }
    },

    async exactAlarms() {
      return (await exactNow()) ? 'granted' : 'denied'
    },

    async openExactAlarmSettings() {
      await plugin.changeExactNotificationSetting()
    },
  }
}
