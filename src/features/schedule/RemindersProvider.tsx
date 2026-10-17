import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useStore } from 'zustand'
import { deviceStorage } from '../../lib/deviceStorage'
import { useNow } from '../../lib/useNow'
import { useAuth } from '../auth/authContext'
import { useTasks } from '../tasks/tasksContext'
import { chooseNotifier, type Notifier, type Permission } from './notifier'
import { NotifierContext, RemindersContext, REMINDER_PROBLEM, type RemindersValue } from './remindersContext'
import { activeReminders, isReminderTask, planNotifications } from './reminders'
import { createSnoozeStore, sameDue } from './snooze'

/** A change of the tasks is planned this long after the last one, so that a burst of changes is planned once. */
const REPLAN_DEBOUNCE_MS = 250
/** The plan covers two days, so it is made again now and then, and each time the app comes to the front. */
const REPLAN_EVERY_MS = 15 * 60_000
/** How often "now" is looked at, which is how soon a reminder appears when its time comes. */
const CLOCK_TICK_MS = 15_000

/**
 * Keeps the reminders of the signed-in person: the strip of those that are on, the snoozes, and the
 * notifications of the next two days, which it plans again on every change of the data and hands to
 * the notifier of the platform. It is mounted with the tasks, so it goes away with a sign-out, and
 * leaves nothing pending behind.
 */
export function RemindersProvider({ notifier: given, children }: { notifier?: Notifier; children: ReactNode }) {
  const navigate = useNavigate()
  const meId = useAuth((state) => state.profile?.id ?? '')
  const byId = useTasks((state) => state.tasks)
  const loaded = useTasks((state) => state.status === 'ready')
  const provided = useContext(NotifierContext)
  const notifier = useMemo(() => given ?? provided ?? chooseNotifier(), [given, provided])
  const snoozeStore = useMemo(() => createSnoozeStore({ storage: deviceStorage(), userId: meId }), [meId])
  const snoozed = useStore(snoozeStore, (state) => state.snoozed)
  const now = useNow(CLOCK_TICK_MS)
  const tasks = useMemo(() => Object.values(byId), [byId])

  const [permission, setPermission] = useState<Permission | null>(null)
  const [exactAlarms, setExactAlarms] = useState<RemindersValue['exactAlarms']>('unsupported')
  const [problem, setProblem] = useState<string | null>(null)
  const [round, setRound] = useState(0)

  const readExactAlarms = useCallback(async () => {
    if (!notifier.exactAlarms) return 'unsupported' as const
    try {
      return await notifier.exactAlarms()
    } catch {
      return 'unsupported' as const
    }
  }, [notifier])

  /** Reads the permission and the exact alarms of the platform again: the person may have changed them in its settings. */
  const refreshPlatform = useCallback(async () => {
    try {
      setPermission(await notifier.permission())
    } catch {
      setPermission('unsupported')
    }
    setExactAlarms(await readExactAlarms())
  }, [notifier, readExactAlarms])

  useEffect(() => {
    let alive = true
    notifier.permission().then(
      (value) => alive && setPermission(value),
      () => alive && setPermission('unsupported'),
    )
    void readExactAlarms().then((value) => alive && setExactAlarms(value))
    return () => {
      alive = false
    }
  }, [notifier, readExactAlarms])

  // A notification that is tapped opens its task over the Today screen.
  useEffect(() => notifier.onOpen((taskId) => void navigate(`/today/${taskId}`)), [notifier, navigate])

  // The plan is made again now and then, and when the app comes back to the front.
  useEffect(() => {
    const again = () => setRound((n) => n + 1)
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      again()
      void refreshPlatform()
    }
    const timer = setInterval(again, REPLAN_EVERY_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refreshPlatform])

  // Everything that is pending is replaced by the plan for the tasks as they are now. Not before the
  // tasks have come: a plan made from nothing would cancel every notification that is pending, and a
  // first load that fails would leave the person with none.
  useEffect(() => {
    if (!meId || !loaded) return
    let alive = true
    const timer = setTimeout(() => {
      notifier.replaceAll(planNotifications(tasks, new Date(), snoozed, meId)).then(
        () => alive && setProblem(null),
        () => alive && setProblem(REMINDER_PROBLEM),
      )
    }, REPLAN_DEBOUNCE_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [notifier, tasks, snoozed, meId, loaded, permission, exactAlarms, round])

  // When the provider goes away (a sign-out), nothing stays pending.
  useEffect(
    () => () => {
      void notifier.clear()
    },
    [notifier],
  )

  // A snooze belongs to the task as it was when it was made. Once the task is done, deleted, given to
  // somebody else or moved to another time, the snooze is forgotten. (Not before the tasks are loaded:
  // until then a task is missing only because it has not come yet.)
  useEffect(() => {
    if (!loaded) return
    const store = snoozeStore.getState()
    for (const id of Object.keys(snoozed)) {
      const task = byId[id]
      if (!task || !isReminderTask(task, meId) || !sameDue(task.due_at, store.dueOf(id))) store.clear(id)
    }
  }, [loaded, byId, snoozed, meId, snoozeStore])

  useEffect(() => {
    snoozeStore.getState().prune()
  }, [now, snoozeStore])

  const active = useMemo(() => activeReminders(tasks, now, snoozed, meId), [tasks, now, snoozed, meId])

  const value = useMemo<RemindersValue>(
    () => ({
      active,
      snoozed,
      snooze(taskId) {
        snoozeStore.getState().snooze(taskId, byId[taskId]?.due_at ?? null)
      },
      permission,
      async requestPermission() {
        try {
          setPermission(await notifier.request())
        } catch {
          // The permission stays as it was.
        }
        setExactAlarms(await readExactAlarms())
      },
      exactAlarms,
      openExactAlarmSettings() {
        void (async () => {
          try {
            await notifier.openExactAlarmSettings?.()
          } catch {
            // The page of the settings could not be opened.
          }
          // The person may have allowed them there: the state is read again, and the plan is made again for it.
          await refreshPlatform()
        })()
      },
      problem,
    }),
    [active, snoozed, snoozeStore, byId, permission, notifier, readExactAlarms, refreshPlatform, exactAlarms, problem],
  )

  return <RemindersContext value={value}>{children}</RemindersContext>
}
