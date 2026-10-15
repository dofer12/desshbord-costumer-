import { useId } from 'react'
import type { Profile } from '../auth/types'
import type { SortChoice, TaskFilter } from './selectors'

interface Props {
  filter: TaskFilter
  onChange(next: TaskFilter): void
  sort: SortChoice
  onSort(next: SortChoice): void
  /** The people that a task can be given to, besides the person who is signed in. */
  people: Profile[]
  shipMethods: string[]
  /** Turns off the filters, and leaves the order, for the results of a search on the server. */
  disabled?: boolean
}

const SORT_OPTIONS: Array<[SortChoice, string]> = [
  ['due-asc', 'מועד: הקרוב קודם'],
  ['due-desc', 'מועד: הרחוק קודם'],
  ['title-asc', 'כותרת: א׳–ת׳'],
  ['updated-desc', 'עודכנו לאחרונה'],
  ['updated-asc', 'עודכנו מזמן'],
]

const STATES: Array<[TaskFilter['state'], string]> = [
  ['open', 'פתוחות'],
  ['done', 'בוצעו'],
  ['all', 'הכול'],
]

/** The person, the shipping method, open or done, and the order of the list. */
export function Filters({ filter, onChange, sort, onSort, people, shipMethods, disabled = false }: Props) {
  const id = useId()
  const methods = filter.shipMethod !== null && !shipMethods.includes(filter.shipMethod) ? [...shipMethods, filter.shipMethod] : shipMethods

  return (
    <div className="filters">
      <div className="control">
        <label htmlFor={`${id}-assignee`}>שיוך</label>
        <select
          id={`${id}-assignee`}
          value={filter.assignee}
          disabled={disabled}
          onChange={(event) => onChange({ ...filter, assignee: event.target.value })}
        >
          <option value="me">המשימות שלי</option>
          <option value="all">כולם</option>
          <option value="none">ללא שיוך</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.display_name}
              {person.is_active ? '' : ' (לא פעיל)'}
            </option>
          ))}
        </select>
      </div>

      <div className="control">
        <label htmlFor={`${id}-ship`}>שיטת משלוח</label>
        <select
          id={`${id}-ship`}
          value={filter.shipMethod ?? ''}
          disabled={disabled}
          onChange={(event) => onChange({ ...filter, shipMethod: event.target.value || null })}
        >
          <option value="">כל השיטות</option>
          {methods.map((method) => (
            <option key={method} value={method}>
              {method}
            </option>
          ))}
        </select>
      </div>

      <div className="control">
        <span id={`${id}-state`}>מצב</span>
        <div className="seg" role="group" aria-labelledby={`${id}-state`}>
          {STATES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter.state === value}
              disabled={disabled}
              onClick={() => onChange({ ...filter, state: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="control">
        <label htmlFor={`${id}-sort`}>מיון</label>
        <select id={`${id}-sort`} value={sort} onChange={(event) => onSort(event.target.value as SortChoice)}>
          {SORT_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
