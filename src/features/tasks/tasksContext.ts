import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { DirectoryActions, DirectoryState, DirectoryStore } from './directoryStore'
import type { AttachmentsGateway } from './gateways'
import type { TasksActions, TasksState, TasksStore } from './tasksStore'

/** What the screens of the tasks share: the two stores of the signed-in user, and the pictures. */
export interface TasksContextValue {
  tasks: TasksStore
  directory: DirectoryStore
  attachments: AttachmentsGateway
}

export const TasksContext = createContext<TasksContextValue | null>(null)

function useTasksContext(): TasksContextValue {
  const value = useContext(TasksContext)
  if (!value) throw new Error('useTasks, useDirectory and useAttachments must be used inside <TasksProvider>')
  return value
}

export function useTasks<T>(selector: (state: TasksState & TasksActions) => T): T {
  return useStore(useTasksContext().tasks, selector)
}

export function useDirectory<T>(selector: (state: DirectoryState & DirectoryActions) => T): T {
  return useStore(useTasksContext().directory, selector)
}

export function useAttachments(): AttachmentsGateway {
  return useTasksContext().attachments
}
