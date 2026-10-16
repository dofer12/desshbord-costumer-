import { useNow } from '../../lib/useNow'
import { formatDue } from './display'
import { actorName, describeEvent } from './historyText'
import { useDirectory } from './tasksContext'
import type { TaskHistory } from './useTaskHistory'

interface Props {
  history: TaskHistory
}

/** Who did what to the task, and when, newest first. */
export function History({ history }: Props) {
  const statuses = useDirectory((state) => state.statuses)
  const profiles = useDirectory((state) => state.profiles)
  const now = useNow()
  const { events } = history

  if (events === null) {
    if (history.failure) {
      return (
        <div className="history-failed">
          <p role="alert" className="alert">
            {history.failure}
          </p>
          <button type="button" className="btn" onClick={history.retry}>
            נסו שוב
          </button>
        </div>
      )
    }
    return <p className="state">טוען היסטוריה…</p>
  }
  if (events.length === 0) return <p className="state">אין היסטוריה עדיין.</p>

  const names = { statuses, profiles }
  return (
    <ol className="history" aria-label="היסטוריית המשימה">
      {[...events]
        .sort((a, b) => b.id - a.id)
        .map((event) => (
          <li key={event.id} className="history-item">
            <div className="history-head">
              <strong className="history-who">{actorName(event.actor_id, profiles)}</strong>
              <time dateTime={event.at}>{formatDue(event.at, now)}</time>
            </div>
            {describeEvent(event, names).map((line, index) => (
              <p key={index} className="history-line">
                {line}
              </p>
            ))}
          </li>
        ))}
    </ol>
  )
}
