import { useId, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Modal } from '../../ui/Modal'
import { useAuth } from '../auth/authContext'
import { newTask } from './model'
import { TaskCard } from './TaskCard'
import { useTasks } from './tasksContext'

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

/** The card at #/tasks/new and at #/tasks/:id. Closing it goes back to #/tasks, where the list kept its place. */
export function TaskCardRoute() {
  const { id } = useParams()
  const navigate = useNavigate()
  const me = useAuth((state) => state.profile?.id ?? '')
  const status = useTasks((state) => state.status)
  const stored = useTasks((state) => (id === undefined ? undefined : state.tasks[id]))
  // A new task is made once, so that its id is the same however many times it is sent.
  const [fresh] = useState(() => ({ ...newTask(me), assignee_id: me }))
  // From the moment the card is told to close until the page has changed, show nothing: a task that
  // was just deleted must not flash "המשימה נמחקה." on its way out.
  const [closing, setClosing] = useState(false)

  function close() {
    setClosing(true)
    void navigate('/tasks')
  }

  if (closing) return null
  if (id === undefined) return <TaskCard task={fresh} isNew onClose={close} />
  if (!stored) return <Notice text={status === 'ready' || status === 'error' ? 'המשימה לא נמצאה ברשימה.' : 'טוען את המשימה…'} onClose={close} />
  if (stored.deleted_at !== null) return <Notice text="המשימה נמחקה." onClose={close} />
  return <TaskCard key={stored.id} task={stored} isNew={false} onClose={close} />
}
