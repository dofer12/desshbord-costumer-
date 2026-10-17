import { Link } from 'react-router'
import { useNow } from '../../lib/useNow'
import { useSaid } from '../../lib/useSaid'
import { taskTitle } from '../tasks/display'
import type { Task } from '../tasks/model'
import { useTasks } from '../tasks/tasksContext'
import { useReminders } from './remindersContext'
import { relativeTo } from './time'

/** The most reminders that are shown at once; the rest are counted. */
const MAX_SHOWN = 3
/** How often the words ("in 10 min", "3 min late") are looked at again. */
const CLOCK_TICK_MS = 15_000

const SNOOZED = 'אזכיר שוב בעוד 10 דקות'

/** How long it is to the task, that it is now, or how late it is. */
function when(task: Task, now: Date): { text: string; state: 'ahead' | 'now' | 'late' } {
  const { state, span } = relativeTo(task.due_at as string, now)
  return { state, text: state === 'ahead' ? `בעוד ${span}` : state === 'now' ? 'עכשיו' : `באיחור של ${span}` }
}

/**
 * The reminders that are on, above every page: at most three, each with how long it is to the task or
 * how late it is, a button for done and one to be reminded again in ten minutes. What is said when one
 * is put off goes in a status region that is always there, so that it is read out even when that was
 * the last reminder and the strip has gone.
 */
export function ReminderStrip() {
  const { active, snooze } = useReminders()
  const markDone = useTasks((state) => state.markDone)
  const now = useNow(CLOCK_TICK_MS)
  const [said, say] = useSaid()
  const shown = active.slice(0, MAX_SHOWN)
  const more = active.length - shown.length

  return (
    <>
      <p role="status" className={said ? 'strip-note' : 'visually-hidden'}>
        {said}
      </p>
      {active.length > 0 && (
        <section className="reminder-strip" aria-label="תזכורות פעילות">
          <ul>
            {shown.map((task) => {
              const left = when(task, now)
              return (
                <li key={task.id} className="reminder">
                  <Link to={`/today/${task.id}`} className="title-link">
                    {taskTitle(task)}
                  </Link>
                  <span className={`reminder-when is-${left.state}`}>{left.text}</span>
                  <span className="reminder-actions">
                    <button type="button" className="btn" aria-label={`בוצע: ${taskTitle(task)}`} onClick={() => markDone(task.id, true)}>
                      בוצע
                    </button>
                    <button
                      type="button"
                      className="btn"
                      aria-label={`נודניק 10 דק׳: ${taskTitle(task)}`}
                      onClick={() => {
                        snooze(task.id)
                        say(SNOOZED)
                      }}
                    >
                      נודניק 10 דק׳
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
          {more > 0 && (
            <Link to="/today" className="reminder-more">
              {more === 1 ? 'ועוד תזכורת פעילה אחת' : `ועוד ${more} תזכורות פעילות`}
            </Link>
          )}
        </section>
      )}
    </>
  )
}
