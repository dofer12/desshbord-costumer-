import { useMemo, useRef, useState } from 'react'
import { useBackend } from '../tasks/backend'
import { filterTasks, statusCounts, type TaskFilter } from '../tasks/selectors'
import { useDirectory, useTasks } from '../tasks/tasksContext'
import type { StatusPatch } from './gateways'
import { StatusRow, type FocusTarget, type SaveResult } from './StatusRow'
import { freeStatusName, NEW_STATUS_COLOR } from './statusRules'
import { classifyWriteFailure, toAdminWriteMessage } from './writeErrors'

const ALL_OPEN: TaskFilter = { statusKey: null, assignee: 'all', shipMethod: null, state: 'open', text: '' }

/** What a request came to: it ran and gave a value, it ran and failed (the page said why), or it did not run because another was still on its way. */
type Outcome<T> = { kind: 'done'; value: T } | { kind: 'failed' } | { kind: 'skipped' }

/** The row that the cursor goes to when it is where it is meant to be: after a move, the index it is moving to. */
interface FocusAfter {
  key: string
  target: FocusTarget
  /** Where the row must be before the cursor goes to it, or null for as soon as nothing is on its way. */
  index: number | null
}

/**
 * The statuses of the tasks: an administrator renames them, colours them, blocks them and puts them in order,
 * and adds new ones. A status is never deleted, since tasks keep it, and its key never changes. Every change
 * is written to the database by itself, one request at a time; the list is brought up to date from the
 * database after each one (unless the server could not be reached), so that a screen that was out of date is put right.
 */
export function StatusesPage() {
  const api = useBackend().admin.statuses
  const statuses = useDirectory((state) => state.statuses)
  const status = useDirectory((state) => state.status)
  const loadError = useDirectory((state) => state.error)
  const load = useDirectory((state) => state.load)
  const tasks = useTasks((state) => state.tasks)

  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [focusAfter, setFocusAfter] = useState<FocusAfter | null>(null)
  /** Set at once, where a state would wait for the next render: a second click in the same moment must not send a second request. */
  const running = useRef(false)

  const openTasks = useMemo(() => statusCounts(filterTasks(Object.values(tasks), ALL_OPEN, '')), [tasks])

  /**
   * Sends one request, and only one at a time. Whatever goes wrong is told in words and the list is loaded
   * again, except when the server could not be reached: then nothing is known that the screen does not show.
   */
  async function act<T>(call: () => Promise<T>): Promise<Outcome<T>> {
    if (running.current) return { kind: 'skipped' }
    running.current = true
    setBusy(true)
    setNotice(null)
    setFocusAfter(null)
    try {
      const value = await call()
      void load()
      return { kind: 'done', value }
    } catch (err) {
      setNotice(toAdminWriteMessage(err))
      if (classifyWriteFailure(err) !== 'network') void load()
      return { kind: 'failed' }
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  async function save(key: string, patch: StatusPatch): Promise<SaveResult> {
    const outcome = await act(() => api.update(key, patch))
    return outcome.kind === 'done' ? 'saved' : outcome.kind
  }

  async function add() {
    const outcome = await act(() => api.add({ name_he: freeStatusName(statuses), color: NEW_STATUS_COLOR }))
    // The new row is where the person names it: the name is selected, so that typing replaces it.
    if (outcome.kind === 'done') setFocusAfter({ key: outcome.value.key, target: 'name', index: null })
  }

  async function move(from: number, direction: 'up' | 'down') {
    const to = direction === 'up' ? from - 1 : from + 1
    const keys = statuses.map((s) => s.key)
    ;[keys[from], keys[to]] = [keys[to], keys[from]]
    const outcome = await act(() => api.reorder(keys))
    // The cursor stays on the button that was used, once the row is in its new place (or at once, if it was not moved).
    if (outcome.kind !== 'skipped') setFocusAfter({ key: statuses[from].key, target: direction, index: outcome.kind === 'done' ? to : null })
  }

  function focusFor(key: string, index: number): FocusTarget | null {
    if (focusAfter === null || focusAfter.key !== key) return null
    return focusAfter.index === null || focusAfter.index === index ? focusAfter.target : null
  }

  return (
    <section className="admin-section" aria-labelledby="statuses-heading">
      <header className="page-head">
        <h3 id="statuses-heading">סטטוסים</h3>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void add()}>
          סטטוס חדש
        </button>
      </header>

      <p className="sub statuses-hint">
        סטטוס לא נמחק, כי משימות שומרות אותו. אפשר לשנות לו שם וצבע, לסדר אותו מחדש או לחסום אותו: סטטוס חסום לא מוצע למשימה שנפתחת או משתנה.
      </p>

      {notice && (
        <p role="alert" className="alert">
          {notice}
        </p>
      )}
      {loadError && (
        <p role="alert" className="alert">
          {loadError}{' '}
          <button type="button" className="btn" onClick={() => void load()}>
            נסו שוב
          </button>
        </p>
      )}

      {status === 'loading' || status === 'idle' ? (
        <p className="sub" role="status">
          טוען…
        </p>
      ) : status === 'error' ? null : (
        <ul className="statuses" aria-label="רשימת הסטטוסים">
          {statuses.map((item, index) => (
            <StatusRow
              key={item.key}
              status={item}
              others={statuses.filter((other) => other.key !== item.key)}
              index={index}
              count={statuses.length}
              openTasks={openTasks[item.key] ?? 0}
              busy={busy}
              onSave={(patch) => save(item.key, patch)}
              onMove={(direction) => void move(index, direction)}
              focusRequest={focusFor(item.key, index)}
              onFocused={() => setFocusAfter(null)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
