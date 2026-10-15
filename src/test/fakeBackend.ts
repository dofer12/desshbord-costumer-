import type { Backend } from '../features/tasks/backend'
import type { Task } from '../features/tasks/model'
import { createMemoryOutboxStorage, type OutboxStorage } from '../features/tasks/outbox'
import {
  createFakeAttachments,
  createFakeDirectory,
  createFakeTasks,
  type FakeAttachments,
  type FakeDirectory,
  type FakeTasks,
} from './fakeTasksGateways'

export interface FakeBackend {
  backend: Backend
  tasks: FakeTasks
  directory: FakeDirectory
  attachments: FakeAttachments
  /** The storage of waiting changes that each person has been given, by user id. */
  outboxes: Map<string, OutboxStorage>
}

/** A backend made of the fakes. A person gets the same storage of waiting changes every time they ask for it. */
export function createFakeBackend(options: { tasks?: Task[]; now?: () => Date } = {}): FakeBackend {
  const tasks = createFakeTasks({ tasks: options.tasks, now: options.now })
  const directory = createFakeDirectory()
  const attachments = createFakeAttachments()
  const outboxes = new Map<string, OutboxStorage>()
  return {
    tasks,
    directory,
    attachments,
    outboxes,
    backend: {
      tasks: tasks.gateway,
      directory: directory.gateway,
      attachments: attachments.gateway,
      outbox(userId) {
        let storage = outboxes.get(userId)
        if (!storage) {
          storage = createMemoryOutboxStorage()
          outboxes.set(userId, storage)
        }
        return storage
      },
    },
  }
}
