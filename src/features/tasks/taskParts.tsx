import { Link } from 'react-router'
import type { Profile } from '../auth/types'
import { CopyButton } from './CopyButton'
import { dialHref, formatDue, statusTextColor, taskTitle, UNKNOWN_STATUS_COLOR } from './display'
import type { Status } from './gateways'
import { KIND_LABEL, PRIORITY_LABEL, type Task } from './model'
import { isOverdue } from './selectors'

/** What the table and the cards are given. They show the tasks in the order they come. */
export interface TaskListProps {
  tasks: Task[]
  statuses: Map<string, Status>
  people: Map<string, Profile>
  now: Date
  onToggleDone(id: string, done: boolean): void
}

export function DoneBox({ task, onToggle }: { task: Task; onToggle: TaskListProps['onToggleDone'] }) {
  return (
    <input
      type="checkbox"
      className="done-box"
      aria-label={`בוצע: ${taskTitle(task)}`}
      checked={task.done_at !== null}
      onChange={(event) => onToggle(task.id, event.target.checked)}
    />
  )
}

/**
 * The title, as a link to the card of the task, with a mark for what is urgent and for a delivery or a
 * pickup. The card opens over the page that `base` names: the list, Today or the calendar.
 */
export function TitleLink({ task, base = '/tasks' }: { task: Task; base?: string }) {
  return (
    <span className="title-cell">
      <Link to={`${base}/${task.id}`} className={task.done_at !== null ? 'title-link is-done' : 'title-link'}>
        {taskTitle(task)}
      </Link>
      {task.priority !== 'normal' && <span className={`badge priority-${task.priority}`}>{PRIORITY_LABEL[task.priority]}</span>}
      {task.kind !== 'general' && <span className="badge kind">{KIND_LABEL[task.kind]}</span>}
    </span>
  )
}

export function StatusBadge({ task, statuses }: { task: Task; statuses: TaskListProps['statuses'] }) {
  const status = statuses.get(task.status_key)
  const color = status?.color ?? UNKNOWN_STATUS_COLOR
  return (
    <span className="status-badge" style={{ background: color, color: statusTextColor(color) }}>
      {status?.name_he ?? task.status_key}
    </span>
  )
}

export function Assignee({ task, people }: { task: Task; people: TaskListProps['people'] }) {
  if (task.assignee_id === null) return <span className="muted">ללא שיוך</span>
  return <span>{people.get(task.assignee_id)?.display_name ?? 'לא ידוע'}</span>
}

export function Due({ task, now }: { task: Task; now: Date }) {
  if (task.due_at === null) return <span className="muted">ללא מועד</span>
  const late = isOverdue(task, now)
  return (
    <span className={late ? 'due is-late' : 'due'}>
      <time dateTime={task.due_at}>{formatDue(task.due_at, now)}</time>
      {late && <span className="badge late">באיחור</span>}
    </span>
  )
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.58a1 1 0 0 1-.25 1.01l-2.2 2.2z"
      />
    </svg>
  )
}

/** The name of the customer, and the phone: a value to copy, and a link to dial. */
export function Customer({ task }: { task: Task }) {
  const phone = task.customer_phone.trim()
  const dial = dialHref(phone)
  return (
    <span className="customer">
      {task.customer_name && <span>{task.customer_name}</span>}
      {phone && (
        <span className="phone">
          <CopyButton value={phone} label="טלפון" />
          {dial && (
            <a className="dial" href={dial} aria-label={`חיוג אל ${phone}`}>
              <PhoneIcon />
            </a>
          )}
        </span>
      )}
    </span>
  )
}

/** A value to copy, or nothing when the task has none. */
export function Copyable({ value, label }: { value: string; label: string }) {
  const text = value.trim()
  return text ? <CopyButton value={text} label={label} /> : null
}
