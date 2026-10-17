import type { Profile } from '../auth/types'
import { formatDue, taskTitle } from '../tasks/display'
import type { Status } from '../tasks/gateways'
import type { Task } from '../tasks/model'
import { Copyable, Customer, StatusBadge, TitleLink } from '../tasks/taskParts'
import { relativeTo } from './time'
import type { PostponeChoice, TodayView, WorkloadRow } from './today'

// The parts of the Today screen. Each is given what it shows; the page owns the data and the actions.

const COUNTS: Array<[keyof TodayView['counts'], string]> = [
  ['late', 'באיחור'],
  ['remaining', 'נותרו להיום'],
  ['soon', 'בשעה הקרובה'],
  ['undated', 'ללא מועד'],
  ['doneToday', 'בוצעו היום'],
]

const POSTPONE: Array<[PostponeChoice, string]> = [
  ['30', 'ב-30 דק׳'],
  ['60', 'בשעה'],
  ['tomorrow', 'למחר 09:00'],
]

/** The five numbers at the head of the screen, with the labels of the old app. The late ones are red. */
export function Counts({ counts }: { counts: TodayView['counts'] }) {
  return (
    <dl className="today-counts">
      {COUNTS.map(([key, label]) => (
        <div key={key} className={key === 'late' && counts.late > 0 ? 'count is-late' : 'count'}>
          <dt>{label}</dt>
          <dd className="num">{counts[key]}</dd>
        </div>
      ))}
    </dl>
  )
}

interface QueueProps {
  tasks: Task[]
  statuses: Map<string, Status>
  people: Map<string, Profile>
  now: Date
  onDone(id: string): void
  onPostpone(task: Task, choice: PostponeChoice): void
}

/** "באיחור 2 שע׳", "עכשיו", "בעוד 45 דק׳". */
function Relative({ task, now }: { task: Task; now: Date }) {
  const { state, span } = relativeTo(task.due_at as string, now)
  const text = state === 'ahead' ? `בעוד ${span}` : state === 'now' ? 'עכשיו' : `באיחור ${span}`
  return <span className={`queue-relative is-${state}`}>{text}</span>
}

/** Who has the task: "בטיפול של דנה", or that nobody does. */
function owner(task: Task, people: Map<string, Profile>): string {
  if (task.assignee_id === null) return 'ללא שיוך'
  return `בטיפול של ${people.get(task.assignee_id)?.display_name ?? 'לא ידוע'}`
}

/** A task of the queue: when, what and who, and the two things to do with it, which are done and put off. */
function QueueRow({ task, statuses, people, now, onDone, onPostpone }: Omit<QueueProps, 'tasks'> & { task: Task }) {
  const due = task.due_at
  return (
    <li className={`queue-item is-${due === null ? 'none' : relativeTo(due, now).state}`}>
      <div className="queue-when">
        {due === null ? (
          <span className="queue-relative">ללא מועד</span>
        ) : (
          <>
            <time dateTime={due}>{formatDue(due, now)}</time>
            <Relative task={task} now={now} />
          </>
        )}
      </div>
      <div className="queue-main">
        <TitleLink task={task} base="/today" />
        <div className="card-line">
          <StatusBadge task={task} statuses={statuses} />
          <Copyable value={task.order_number} label="מספר הזמנה" />
        </div>
        <Customer task={task} />
        <span className="muted">{owner(task, people)}</span>
      </div>
      <div className="queue-actions">
        <button type="button" className="btn" aria-label={`בוצע: ${taskTitle(task)}`} onClick={() => onDone(task.id)}>
          בוצע
        </button>
        <select
          aria-label={`דחיית ${taskTitle(task)}`}
          value=""
          onChange={(event) => event.target.value && onPostpone(task, event.target.value as PostponeChoice)}
        >
          <option value="">דחה…</option>
          {POSTPONE.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </li>
  )
}

/** What is late and what is left of today, as a list to work through. */
export function Queue({ tasks, ...row }: QueueProps) {
  return (
    <ul className="queue" aria-labelledby="queue-heading">
      {tasks.map((task) => (
        <QueueRow key={task.id} task={task} {...row} />
      ))}
    </ul>
  )
}

/** The tasks that have no time yet, a few of them, as rows of the same kind: they too can be done, or put off to a time. */
export function Undated({ tasks, ...row }: QueueProps) {
  return (
    <ul className="queue" aria-labelledby="undated-heading">
      {tasks.map((task) => (
        <QueueRow key={task.id} task={task} {...row} />
      ))}
    </ul>
  )
}

/** The open work of everybody: how much each person has, how much of it is late and how much is for today. */
export function Workload({ rows, people }: { rows: WorkloadRow[]; people: Map<string, Profile> }) {
  const name = (key: string) => (key === 'none' ? 'ללא שיוך' : (people.get(key)?.display_name ?? 'לא ידוע'))
  return (
    <table className="workload" aria-labelledby="workload-heading">
      <thead>
        <tr>
          <th scope="col">עובד</th>
          <th scope="col">פתוחות</th>
          <th scope="col">באיחור</th>
          <th scope="col">להיום</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row">{name(row.key)}</th>
            <td className="num">{row.open}</td>
            <td className={row.late > 0 ? 'num is-late' : 'num'}>{row.late}</td>
            <td className="num">{row.today}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
