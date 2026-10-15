import { Assignee, Copyable, Customer, DoneBox, Due, StatusBadge, TitleLink, type TaskListProps } from './taskParts'

/** The tasks as cards, for a phone. */
export function TaskCards({ tasks, statuses, people, now, onToggleDone }: TaskListProps) {
  return (
    <ul className="task-cards" aria-label="רשימת משימות">
      {tasks.map((task) => (
        <li key={task.id} className={task.done_at !== null ? 'task-card is-done' : 'task-card'}>
          <div className="card-top">
            <DoneBox task={task} onToggle={onToggleDone} />
            <TitleLink task={task} />
          </div>
          <div className="card-line">
            <StatusBadge task={task} statuses={statuses} />
            <Due task={task} now={now} />
          </div>
          <Customer task={task} />
          <div className="card-line">
            <Copyable value={task.order_number} label="מספר הזמנה" />
            <Copyable value={task.glassix_conversation_id} label="מזהה Glassix" />
            <Copyable value={task.cargo_number} label="מספר Cargo" />
          </div>
          <div className="card-foot">
            <Assignee task={task} people={people} />
          </div>
        </li>
      ))}
    </ul>
  )
}
