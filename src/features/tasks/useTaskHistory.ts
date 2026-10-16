import { useEffect, useState } from 'react'
import { toHebrewLoadError } from './errors'
import type { TaskEvent } from './gateways'
import { useHistory } from './tasksContext'

export interface TaskHistory {
  /** What was read last, in the order the server gave it. It stays while the history is read again, and after a new reading fails. Null until the first reading. */
  events: TaskEvent[] | null
  /** Why the first reading failed. Null once there are events to show. */
  failure: string | null
  /** Reads it again after a failure. */
  retry(): void
}

/** The last answer, and the request that it answered. */
interface Answer {
  key: string
  events: TaskEvent[] | null
  failure: string | null
}

/**
 * The history of a task, read from the server: when the card opens and again whenever `version` changes
 * (somebody saved the task, or the server wrote something on its history). Pass null for a task that
 * is not saved yet, which has none.
 */
export function useTaskHistory(taskId: string | null, version: string): TaskHistory {
  const read = useHistory()
  const [attempt, setAttempt] = useState(0)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const key = `${taskId}|${version}|${attempt}`

  useEffect(() => {
    if (taskId === null) return
    let current = true
    read(taskId).then(
      (events) => {
        if (current) setAnswer({ key, events, failure: null })
      },
      (error: unknown) => {
        if (current) setAnswer((was) => ({ key, events: was?.events ?? null, failure: toHebrewLoadError(error) }))
      },
    )
    return () => {
      current = false
    }
  }, [read, taskId, key])

  const events = taskId === null ? null : (answer?.events ?? null)
  // A failure is told only for the reading that is the latest: while it is read again, the person sees that it is loading.
  const failure = events === null && answer?.key === key ? answer.failure : null
  return { events, failure, retry: () => setAttempt((count) => count + 1) }
}
