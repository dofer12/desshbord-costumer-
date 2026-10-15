import { useTasks } from './tasksContext'

// The screen of the tasks is built in the next steps; this is the place for it.
export function TasksPage() {
  const status = useTasks((state) => state.status)
  const count = useTasks((state) => Object.keys(state.tasks).length)
  return (
    <section aria-labelledby="tasks-heading">
      <h2 id="tasks-heading">משימות</h2>
      <p className="sub">{status === 'ready' ? `נטענו ${count} משימות` : 'טוען…'}</p>
    </section>
  )
}
