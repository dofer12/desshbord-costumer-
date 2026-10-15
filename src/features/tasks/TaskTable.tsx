import { Assignee, Copyable, Customer, DoneBox, Due, StatusBadge, TitleLink, type TaskListProps } from './taskParts'

/** The tasks as a table, for a screen that is wide enough. */
export function TaskTable({ tasks, statuses, people, now, onToggleDone }: TaskListProps) {
  return (
    <div className="table-wrap">
      <table className="task-table" aria-label="רשימת משימות">
        <thead>
          <tr>
            <th scope="col">בוצע</th>
            <th scope="col">משימה</th>
            <th scope="col">לקוח</th>
            <th scope="col">הזמנה</th>
            <th scope="col">Glassix</th>
            <th scope="col">Cargo</th>
            <th scope="col">סטטוס</th>
            <th scope="col">שיוך</th>
            <th scope="col">מועד</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id} className={task.done_at !== null ? 'is-done' : undefined}>
              <td>
                <DoneBox task={task} onToggle={onToggleDone} />
              </td>
              <td>
                <TitleLink task={task} />
              </td>
              <td>
                <Customer task={task} />
              </td>
              <td>
                <Copyable value={task.order_number} label="מספר הזמנה" />
              </td>
              <td>
                <Copyable value={task.glassix_conversation_id} label="מזהה Glassix" />
              </td>
              <td>
                <Copyable value={task.cargo_number} label="מספר Cargo" />
              </td>
              <td>
                <StatusBadge task={task} statuses={statuses} />
              </td>
              <td>
                <Assignee task={task} people={people} />
              </td>
              <td>
                <Due task={task} now={now} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
