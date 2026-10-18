import { useEffect, useRef, useState } from 'react'
import { useNow } from '../../lib/useNow'
import { addDays, dayKey, dayStart, formatClock } from '../schedule/time'
import { useBackend } from '../tasks/backend'
import { taskTitle } from '../tasks/display'
import type { Task } from '../tasks/model'
import { useTasks } from '../tasks/tasksContext'
import { toAdminWriteMessage } from './writeErrors'

/** The deleted tasks that are shown: the ones that were deleted in this many days, counted by the days of Jerusalem. */
const SHOWN_DAYS = 30
/** The list is cut here by the gateway. */
const SHOWN_AT_MOST = 500

const DAY_MS = 86_400_000

/** How many calendar days of Jerusalem there are from one day to the other. */
function daysBetween(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number)
  const [toYear, toMonth, toDay] = to.split('-').map(Number)
  return Math.round((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / DAY_MS)
}

/** When a task was deleted, in a few words: "היום ב-14:30", "אתמול ב-09:05", "לפני 3 ימים". */
function deletedAgo(deletedAt: string, now: Date): string {
  const days = daysBetween(dayKey(deletedAt), dayKey(now))
  if (days <= 0) return `היום ב-${formatClock(deletedAt)}`
  if (days === 1) return `אתמול ב-${formatClock(deletedAt)}`
  return `לפני ${days} ימים`
}

interface Notice {
  kind: 'done' | 'failed'
  text: string
}

/**
 * The tasks that were deleted in the last 30 days, which an administrator can bring back. A task is never
 * removed from the database, only marked, so a restore takes the mark away: the task is in the tasks of
 * everybody again at once, and the history of the task says that it was restored.
 */
export function DeletedPage() {
  const api = useBackend().admin.tasks
  const applyRemote = useTasks((state) => state.applyRemote)
  const now = useNow()

  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  /** Set at once, where a state would wait for the next render: a second click in the same moment must not send a second request. */
  const running = useRef(false)
  const noticeLine = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    let current = true
    const since = dayStart(addDays(dayKey(new Date()), -SHOWN_DAYS))
    api.listDeleted(since).then(
      (list) => {
        if (!current) return
        setTasks(list)
        setLoadError(null)
      },
      (err: unknown) => {
        if (current) setLoadError(`לא הצלחנו לקרוא את המשימות שנמחקו. ${toAdminWriteMessage(err)}`)
      },
    )
    return () => {
      current = false
    }
  }, [api, attempt])

  // What was said about the last restore is read out and is where the cursor goes, since the row that had it is gone.
  useEffect(() => {
    if (notice) noticeLine.current?.focus()
  }, [notice])

  async function restore(task: Task) {
    if (running.current) return
    running.current = true
    setRestoring(task.id)
    setNotice(null)
    try {
      const restored = await api.restore(task.id)
      // The task is among the tasks of the app at once; the live connection brings it to everybody else.
      if (restored) applyRemote(restored)
      setTasks((current) => (current === null ? null : current.filter((item) => item.id !== task.id)))
      setNotice({ kind: 'done', text: restored ? `המשימה "${taskTitle(task)}" שוחזרה.` : `המשימה "${taskTitle(task)}" כבר שוחזרה.` })
    } catch (err) {
      setNotice({ kind: 'failed', text: `לא הצלחנו לשחזר את "${taskTitle(task)}". ${toAdminWriteMessage(err)}` })
    } finally {
      running.current = false
      setRestoring(null)
    }
  }

  return (
    <section className="admin-section" aria-labelledby="deleted-heading">
      <header className="page-head">
        <h3 id="deleted-heading">נמחקו לאחרונה</h3>
      </header>
      <p className="sub">משימות שנמחקו ב-{SHOWN_DAYS} הימים האחרונים. משימה שמשחזרים חוזרת לכולם, עם ההיסטוריה שלה.</p>

      {notice && (
        <p ref={noticeLine} tabIndex={-1} role={notice.kind === 'failed' ? 'alert' : 'status'} className={notice.kind === 'failed' ? 'alert' : 'saved-note'}>
          {notice.text}
        </p>
      )}
      {loadError && (
        <p role="alert" className="alert">
          {loadError}{' '}
          <button type="button" className="btn" onClick={() => setAttempt((count) => count + 1)}>
            נסו שוב
          </button>
        </p>
      )}

      {tasks === null ? (
        loadError ? null : (
          <p className="sub" role="status">
            טוען…
          </p>
        )
      ) : tasks.length === 0 ? (
        <p className="sub">אין משימות לשחזר: לא נמחקה אף משימה ב-{SHOWN_DAYS} הימים האחרונים.</p>
      ) : (
        <>
          <ul className="deleted-list" aria-label="רשימת המשימות שנמחקו">
            {tasks.map((task) => {
              const title = taskTitle(task)
              const details = [task.customer_name.trim(), task.order_number.trim() ? `הזמנה #${task.order_number.trim().replace(/^#\s*/, '')}` : ''].filter(Boolean)
              return (
                <li key={task.id} className="deleted-row">
                  <div className="deleted-id">
                    <strong className="deleted-title">{title}</strong>
                    {details.length > 0 && <span className="sub">{details.join(' · ')}</span>}
                    <span className="sub">נמחקה {task.deleted_at ? deletedAgo(task.deleted_at, now) : ''}</span>
                  </div>
                  <button type="button" className="btn" aria-label={`שחזור: ${title}`} disabled={restoring !== null} onClick={() => void restore(task)}>
                    שחזור
                  </button>
                </li>
              )
            })}
          </ul>
          {tasks.length >= SHOWN_AT_MOST && <p className="sub">מוצגות {SHOWN_AT_MOST} המשימות שנמחקו לאחרונה.</p>}
        </>
      )}
    </section>
  )
}
