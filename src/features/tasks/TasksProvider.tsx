import { useEffect, useMemo, type ReactNode } from 'react'
import { useAuth } from '../auth/authContext'
import { useBackend } from './backend'
import { createDirectoryStore } from './directoryStore'
import { TasksContext, type TasksContextValue } from './tasksContext'
import { createTasksStore } from './tasksStore'

/**
 * Makes the stores of the signed-in user, loads them and keeps them live. It is mounted only while
 * somebody is signed in, so the stores go away with the sign-out and the next person gets new ones,
 * with a storage of waiting changes that is theirs.
 */
export function TasksProvider({ children }: { children: ReactNode }) {
  const backend = useBackend()
  const userId = useAuth((state) => state.profile?.id ?? null)

  const value = useMemo<TasksContextValue | null>(
    () =>
      userId === null
        ? null
        : {
            tasks: createTasksStore({ gateway: backend.tasks, storage: backend.outbox(userId) }),
            directory: createDirectoryStore(backend.directory),
            attachments: backend.attachments,
          },
    [backend, userId],
  )

  useEffect(() => {
    if (!value) return
    const { tasks, directory } = value
    void tasks.getState().load()
    void directory.getState().load()
    tasks.getState().start()
    directory.getState().start()
    return () => {
      tasks.getState().stop()
      directory.getState().stop()
    }
  }, [value])

  if (!value) return null
  return <TasksContext value={value}>{children}</TasksContext>
}
