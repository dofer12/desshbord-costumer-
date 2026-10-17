import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import { useNow } from '../../lib/useNow'
import { useAuth } from '../auth/authContext'
import { ReminderStrip } from '../schedule/ReminderStrip'
import { RemindersProvider } from '../schedule/RemindersProvider'
import { todayBadge } from '../schedule/today'
import { MY_OPEN_TASKS, filterTasks } from '../tasks/selectors'
import { useTasks } from '../tasks/tasksContext'

const ROLE_LABEL = { admin: 'מנהל', employee: 'עובד' } as const

/** How often a signed-in user is checked to still be an active member. */
const MEMBERSHIP_CHECK_MS = 5 * 60_000

/**
 * Looks at the profile of the signed-in user when the app comes back to the front and every five
 * minutes. A user who was deactivated while the app was open is sent back to the login screen, with
 * the reason, instead of looking at a list that has silently gone empty.
 */
function useMembershipCheck() {
  const recheck = useAuth((state) => state.recheck)
  useEffect(() => {
    const check = () => void recheck()
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(check, MEMBERSHIP_CHECK_MS)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [recheck])
}

const countText = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`)

/** The number on a tab. A long list shows 99+, and the words that go with it say the exact number. */
const badgeText = (count: number) => (count > 99 ? '99+' : String(count))

interface TabProps {
  to: string
  label: string
  /** The number on the tab. Nothing is shown for nought. */
  count?: number
  /** The number is red: something is late. */
  late?: boolean
  /** The number in words, for a screen reader. It is a description of the tab, so the name of the tab stays what it says. */
  words?: string
}

function Tab({ to, label, count = 0, late = false, words }: TabProps) {
  const note = useId()
  const shown = count > 0
  return (
    <NavLink to={to} className="app-tab" aria-describedby={shown ? note : undefined}>
      {label}
      {shown && (
        <>
          <span className={late ? 'tab-badge tab-badge-late' : 'tab-badge'} aria-hidden="true">
            {badgeText(count)}
          </span>
          <span id={note} hidden>
            {words}
          </span>
        </>
      )}
    </NavLink>
  )
}

/**
 * Today, the tasks and the calendar. Today shows how many of my tasks are due by the end of the day,
 * the late ones too, and turns red when one is late; the tasks show how many of my tasks are open.
 * The clock brings the numbers up to date as the minutes and the midnight pass.
 */
function Tabs() {
  const tasks = useTasks((state) => state.tasks)
  const me = useAuth((state) => state.profile?.id ?? '')
  const now = useNow()
  const list = useMemo(() => Object.values(tasks), [tasks])
  const today = useMemo(() => todayBadge(list, now, me), [list, now, me])
  const open = useMemo(() => filterTasks(list, MY_OPEN_TASKS, me).length, [list, me])
  return (
    <nav className="app-tabs" aria-label="ניווט ראשי">
      <Tab
        to="/today"
        label="היום"
        count={today.count}
        late={today.late}
        words={countText(today.count, 'משימה אחת להיום', 'משימות להיום') + (today.late ? ', יש באיחור' : '')}
      />
      <Tab to="/tasks" label="משימות" count={open} words={countText(open, 'משימה פתוחה אחת', 'משימות פתוחות')} />
      <Tab to="/calendar" label="יומן" />
    </nav>
  )
}

/** "N שינויים ממתינים", and the changes that the server refused. */
function SyncStatus() {
  const pending = useTasks((state) => state.pending)
  const failed = useTasks((state) => state.failed.length)
  const retryFailed = useTasks((state) => state.retryFailed)
  return (
    <>
      {pending > 0 && (
        <p className="sync" role="status">
          {countText(pending, 'שינוי אחד ממתין', 'שינויים ממתינים')}
        </p>
      )}
      {failed > 0 && (
        <p className="sync sync-failed" role="alert">
          {countText(failed, 'שינוי אחד לא נשמר', 'שינויים לא נשמרו')}
          <button type="button" className="btn" onClick={() => retryFailed()}>
            נסו שוב
          </button>
        </p>
      )}
    </>
  )
}

/**
 * Shown while the live connection is down. The styles keep it out of sight for the first seconds,
 * so that the moment before the connection comes up when the app opens does not flash a warning.
 */
function ConnectionBanner() {
  const live = useTasks((state) => state.live)
  if (live) return null
  return (
    <p className="banner" role="status">
      אין חיבור חי: שינויים של אחרים יופיעו כשהחיבור יחזור. מה שנשמר כאן ממשיך להישלח.
    </p>
  )
}

function UserMenu({ serverHost }: { serverHost: string }) {
  const profile = useAuth((state) => state.profile)
  const signOut = useAuth((state) => state.signOut)
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  if (!profile) return null
  return (
    <div
      className="user-menu"
      ref={container}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false)
      }}
    >
      <button
        type="button"
        className="btn"
        aria-expanded={open}
        aria-controls="user-menu-panel"
        onClick={() => setOpen((was) => !was)}
      >
        {profile.display_name}
      </button>
      {open && (
        <div id="user-menu-panel" className="user-menu-panel" role="region" aria-label="פרטי משתמש">
          <p>{profile.display_name}</p>
          <p className="sub">תפקיד: {ROLE_LABEL[profile.role]}</p>
          <p className="sub">
            גרסה <span className="num">{__APP_VERSION__}</span> · שרת: <span className="num">{serverHost}</span>
          </p>
          <button type="button" className="btn" onClick={() => void signOut()}>
            התנתקות
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * The frame of the app once somebody is signed in: the tabs, the state of the sync, the user menu, and
 * the reminders of the person, which are kept for as long as the frame is there and shown above every page.
 */
export function AppShell({ serverHost }: { serverHost: string }) {
  useMembershipCheck()
  return (
    <RemindersProvider>
      <div className="app">
        <header className="app-bar">
          <h1 className="display app-title">יומן משימות מוקד</h1>
          <Tabs />
          <div className="app-bar-end">
            <SyncStatus />
            <UserMenu serverHost={serverHost} />
          </div>
        </header>
        <ConnectionBanner />
        <ReminderStrip />
        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </RemindersProvider>
  )
}
