import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import { useAuth } from '../auth/authContext'
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

/** The frame of the app once somebody is signed in: the tabs, the state of the sync, the user menu. */
export function AppShell({ serverHost }: { serverHost: string }) {
  useMembershipCheck()
  return (
    <div className="app">
      <header className="app-bar">
        <h1 className="display app-title">יומן משימות מוקד</h1>
        <nav className="app-tabs" aria-label="ניווט ראשי">
          <NavLink to="/tasks" className="app-tab">
            משימות
          </NavLink>
        </nav>
        <div className="app-bar-end">
          <SyncStatus />
          <UserMenu serverHost={serverHost} />
        </div>
      </header>
      <ConnectionBanner />
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
