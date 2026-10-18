import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { useNow } from '../../lib/useNow'
import { BackupBanner } from '../admin/BackupBanner'
import { useAuth } from '../auth/authContext'
import { ROLE_LABEL } from '../auth/roles'
import { useMembershipCheck } from '../auth/useMembershipCheck'
import { ReminderStrip } from '../schedule/ReminderStrip'
import { RemindersProvider } from '../schedule/RemindersProvider'
import { todayBadge } from '../schedule/today'
import { taskTitle } from '../tasks/display'
import { MY_OPEN_TASKS, filterTasks } from '../tasks/selectors'
import { useTasks } from '../tasks/tasksContext'

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
  const isAdmin = useAuth((state) => state.profile?.role === 'admin')
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
      {isAdmin && <Tab to="/admin" label="ניהול" />}
    </nav>
  )
}

/** "N שינויים ממתינים". */
function SyncStatus() {
  const pending = useTasks((state) => state.pending)
  if (pending === 0) return null
  return (
    <p className="sync" role="status">
      {countText(pending, 'שינוי אחד ממתין', 'שינויים ממתינים')}
    </p>
  )
}

/**
 * The changes that the server refused: which task, why, and what can be done about it. They stay on the
 * screen and are not sent again by themselves, so the person is told, and can open the task to mend
 * what the server did not like, try again, or give the change up (after asking, since what was typed is lost).
 */
function RefusedChanges() {
  const failed = useTasks((state) => state.failed)
  const tasks = useTasks((state) => state.tasks)
  const retryFailed = useTasks((state) => state.retryFailed)
  const discardFailed = useTasks((state) => state.discardFailed)
  /** The task whose change is being asked about. */
  const [asking, setAsking] = useState<string | null>(null)
  const safeAnswer = useRef<HTMLButtonElement>(null)
  const wasAsking = useRef<string | null>(null)

  // A question puts the focus on the safe answer, and the answer no gives it back to the button that asked.
  useEffect(() => {
    if (asking !== null) safeAnswer.current?.focus()
    else if (wasAsking.current !== null) document.getElementById(`refused-give-up-${wasAsking.current}`)?.focus()
    wasAsking.current = asking
  }, [asking])

  if (failed.length === 0) return null
  return (
    <section className="refused" role="alert">
      <p className="refused-head">
        <strong>{countText(failed.length, 'שינוי אחד לא נשמר', 'שינויים לא נשמרו')}</strong>
        <button type="button" className="btn" onClick={() => retryFailed()}>
          נסו שוב
        </button>
      </p>
      <ul className="refused-list">
        {failed.map(({ id, message }) => {
          const task = tasks[id]
          const title = task ? taskTitle(task) : 'משימה'
          return (
            <li key={id}>
              <span className="refused-title">{title}</span>
              <span className="refused-why">{message}</span>
              {asking === id ? (
                <>
                  <span>לבטל את השינוי? מה שהוקלד יאבד.</span>
                  <button
                    type="button"
                    className="btn danger"
                    onClick={() => {
                      discardFailed(id)
                      setAsking(null)
                    }}
                  >
                    כן, לבטל
                  </button>
                  <button type="button" className="btn" ref={safeAnswer} onClick={() => setAsking(null)}>
                    לא, להשאיר
                  </button>
                </>
              ) : (
                <>
                  {task && (
                    <Link className="btn" to={`/tasks/${id}`} aria-label={`פתיחת המשימה: ${title}`}>
                      פתיחת המשימה
                    </Link>
                  )}
                  <button type="button" className="btn" id={`refused-give-up-${id}`} aria-label={`ביטול השינוי: ${title}`} onClick={() => setAsking(id)}>
                    ביטול השינוי
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>
    </section>
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
          <Link to="/profile" className="btn" onClick={() => setOpen(false)}>
            הפרופיל שלי
          </Link>
          <button type="button" className="btn" onClick={() => void signOut()}>
            התנתקות
          </button>
        </div>
      )}
    </div>
  )
}

/** The tab that an address is on: the first part of it. */
const tabOf = (pathname: string) => pathname.split('/')[1] ?? ''

/**
 * When the person goes to another tab the focus goes to the page. Otherwise it would stay on the link that
 * was used (or be lost, when that link is gone, as the one in the menu of the user is), and a person who
 * works with the keyboard or with a screen reader would have to go through the whole bar again to reach
 * what they opened. The card of a task opens inside its tab and has its own care for the focus; the first
 * address (the bare address, which is sent on to Today) is not a change of tab.
 */
function useFocusPageOnTabChange(page: RefObject<HTMLElement | null>) {
  const tab = tabOf(useLocation().pathname)
  const was = useRef(tab)
  useEffect(() => {
    if (was.current === tab) return
    const first = was.current === ''
    was.current = tab
    if (!first) page.current?.focus()
  }, [tab, page])
}

/**
 * The frame of the app once somebody is signed in: the tabs, the state of the sync, the user menu, and
 * the reminders of the person, which are kept for as long as the frame is there and shown above every page.
 */
export function AppShell({ serverHost }: { serverHost: string }) {
  useMembershipCheck()
  const page = useRef<HTMLElement>(null)
  useFocusPageOnTabChange(page)
  return (
    <RemindersProvider>
      <div className="app">
        <a
          className="skip-link"
          href="#main"
          onClick={(event) => {
            // The address of the app is what follows the #, so the link must not be followed: it only moves the focus.
            event.preventDefault()
            page.current?.focus()
          }}
        >
          דלגו לתוכן הראשי
        </a>
        <header className="app-bar">
          <h1 className="display app-title">יומן משימות מוקד</h1>
          <Tabs />
          <div className="app-bar-end">
            <SyncStatus />
            <UserMenu serverHost={serverHost} />
          </div>
        </header>
        <ConnectionBanner />
        <BackupBanner />
        <RefusedChanges />
        <ReminderStrip />
        <main className="app-main" id="main" tabIndex={-1} ref={page}>
          <Outlet />
        </main>
      </div>
    </RemindersProvider>
  )
}
