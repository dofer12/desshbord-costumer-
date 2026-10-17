import { useMemo, useState } from 'react'
import { Link, Outlet } from 'react-router'
import { deviceStorage } from '../../lib/deviceStorage'
import { useNow } from '../../lib/useNow'
import { useSaid } from '../../lib/useSaid'
import { useAuth } from '../auth/authContext'
import { formatDue } from '../tasks/display'
import type { Task } from '../tasks/model'
import { useDirectory, useTasks } from '../tasks/tasksContext'
import { NotificationBanner } from './NotificationBanner'
import { buildToday, postponeTarget, type PostponeChoice } from './today'
import { Counts, Queue, Undated, Workload } from './todayParts'
import { readScope, saveScope, type Scope } from './todayScope'

/** How many of the tasks without a time are listed; the rest are counted. */
const UNDATED_SHOWN = 6

/**
 * The screen of the day: what is late and what is left of today, the tasks that have no time yet, and
 * how much work each person has. It shows the signed-in person's tasks or everybody's, as they chose,
 * and the card of a task opens over it.
 */
export function TodayPage() {
  const me = useAuth((state) => state.profile?.id ?? '')
  const byId = useTasks((state) => state.tasks)
  const status = useTasks((state) => state.status)
  const error = useTasks((state) => state.error)
  const load = useTasks((state) => state.load)
  const markDone = useTasks((state) => state.markDone)
  const update = useTasks((state) => state.update)
  const statuses = useDirectory((state) => state.statuses)
  const profiles = useDirectory((state) => state.profiles)
  const now = useNow()
  const [scope, setScope] = useState<Scope>(() => readScope(deviceStorage(), me))
  const [postponed, say] = useSaid()

  const all = useMemo(() => Object.values(byId), [byId])
  const view = useMemo(() => buildToday(all, now, { meId: me, mine: scope === 'mine' }), [all, now, me, scope])
  const statusByKey = useMemo(() => new Map(statuses.map((s) => [s.key, s])), [statuses])
  const peopleById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles])
  const loading = status === 'idle' || status === 'loading'
  const anyTask = all.some((task) => task.deleted_at === null)
  const undatedShown = view.undated.slice(0, UNDATED_SHOWN)
  const undatedMore = view.undated.length - undatedShown.length

  function choose(next: Scope) {
    setScope(next)
    saveScope(deviceStorage(), me, next)
  }

  function postpone(task: Task, choice: PostponeChoice) {
    // The moment of the choice, and not the minute that the screen last looked at the clock.
    const moment = new Date()
    const due = postponeTarget(task, choice, moment)
    update(task.id, { due_at: due })
    say(`נדחה ל${formatDue(due, moment)}`)
  }

  return (
    <section className="today-page" aria-labelledby="today-heading">
      <header className="page-head">
        <h2 id="today-heading">היום</h2>
        <div className="page-head-end">
          <div className="segmented" role="group" aria-label="אילו משימות להציג">
            <button type="button" className="btn" aria-pressed={scope === 'mine'} onClick={() => choose('mine')}>
              המשימות שלי
            </button>
            <button type="button" className="btn" aria-pressed={scope === 'all'} onClick={() => choose('all')}>
              כולם
            </button>
          </div>
          <Link to="/today/new" className="btn primary">
            משימה חדשה
          </Link>
        </div>
      </header>

      <NotificationBanner />

      <p role="status" className={postponed ? 'postponed' : 'visually-hidden'}>
        {postponed}
      </p>

      {status === 'ready' && error && (
        <p role="alert" className="alert">
          {error}
          <button type="button" className="btn" onClick={() => void load()}>
            נסו שוב
          </button>
        </p>
      )}

      {loading ? (
        <p role="status" className="state">
          טוען משימות…
        </p>
      ) : status === 'error' ? (
        <div role="alert" className="alert state">
          <p>{error}</p>
          <button type="button" className="btn" onClick={() => void load()}>
            נסו שוב
          </button>
        </div>
      ) : !anyTask ? (
        <p className="state">עדיין אין משימות. אפשר להתחיל עם ״משימה חדשה״.</p>
      ) : (
        <>
          <Counts counts={view.counts} />

          <section className="today-section">
            <h3 id="queue-heading">התור להיום</h3>
            {view.queue.length === 0 ? (
              <p className="state">אין משימות באיחור או להיום.</p>
            ) : (
              <Queue
                tasks={view.queue}
                statuses={statusByKey}
                people={peopleById}
                now={now}
                onDone={(id) => markDone(id, true)}
                onPostpone={postpone}
              />
            )}
          </section>

          {view.undated.length > 0 && (
            <section className="today-section">
              <h3 id="undated-heading">משימות ללא מועד</h3>
              <Undated
                tasks={undatedShown}
                statuses={statusByKey}
                people={peopleById}
                now={now}
                onDone={(id) => markDone(id, true)}
                onPostpone={postpone}
              />
              {undatedMore > 0 && (
                <Link to="/tasks" className="more-link">
                  {undatedMore === 1 ? 'ועוד משימה אחת ללא מועד' : `ועוד ${undatedMore} משימות ללא מועד`}
                </Link>
              )}
            </section>
          )}

          <section className="today-section">
            <h3 id="workload-heading">עומס לפי עובד</h3>
            <Workload rows={view.workload} people={peopleById} />
          </section>
        </>
      )}

      <Outlet />
    </section>
  )
}
