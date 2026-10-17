import { useId, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { Modal } from '../../ui/Modal'
import { useAuth } from '../auth/authContext'
import type { Profile } from '../auth/types'
import { newTask } from './model'
import { TaskCard } from './TaskCard'
import { useTasks } from './tasksContext'
import { parseDuePreset } from './validation'

/** A message in the place of the card: the tasks are loading, or the one that was asked for is not there. */
function Notice({ text, onClose }: { text: string; onClose(): void }) {
  const heading = useId()
  return (
    <Modal labelledBy={heading} onClose={onClose}>
      <div className="task-card-form">
        <header className="card-head">
          <h2 id={heading}>כרטיס משימה</h2>
          <button type="button" className="icon-btn" aria-label="סגירה" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <p className="state">{text}</p>
      </div>
    </Modal>
  )
}

/** The pages that the card opens over: Today, the list and the calendar. */
const PAGES = ['today', 'tasks', 'calendar']

/**
 * The reminder that a new task starts with: the default of the person, which their profile keeps.
 * Nought is a reminder at the due time and is kept. A profile without one gives none.
 */
function defaultReminder(profile: Profile | null): number | null {
  const minutes: unknown = profile?.default_remind_min
  return typeof minutes === 'number' && minutes >= 0 ? minutes : null
}

/**
 * The card at #/<page>/new and at #/<page>/:id, over Today, the list or the calendar. Closing it goes
 * back to the page it was opened from, where the page kept its place. A new task may be opened on a
 * moment that was clicked (`?due=`), and starts with the default reminder of the person.
 */
export function TaskCardRoute() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [search] = useSearchParams()
  const me = useAuth((state) => state.profile?.id ?? '')
  const remind = useAuth((state) => defaultReminder(state.profile))
  const status = useTasks((state) => state.status)
  const stored = useTasks((state) => (id === undefined ? undefined : state.tasks[id]))
  // A new task is made once, so that its id is the same however many times it is sent.
  const [fresh] = useState(() => ({ ...newTask(me), assignee_id: me, due_at: parseDuePreset(search.get('due')), remind_min: remind }))
  const page = pathname.split('/')[1]
  // From the moment the card is told to close until the page has changed, show nothing: a task that
  // was just deleted must not flash "המשימה נמחקה." on its way out.
  const [closing, setClosing] = useState(false)

  function close() {
    setClosing(true)
    void navigate(PAGES.includes(page) ? `/${page}` : '/today')
  }

  if (closing) return null
  if (id === undefined) return <TaskCard task={fresh} isNew onClose={close} />
  if (!stored) return <Notice text={status === 'ready' || status === 'error' ? 'המשימה לא נמצאה ברשימה.' : 'טוען את המשימה…'} onClose={close} />
  if (stored.deleted_at !== null) return <Notice text="המשימה נמחקה." onClose={close} />
  return <TaskCard key={stored.id} task={stored} isNew={false} onClose={close} />
}
