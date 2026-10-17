import { createMemoryAdminGateway } from '../features/admin/memoryAdminGateway'
import type { Backend } from '../features/tasks/backend'
import type { Task } from '../features/tasks/model'
import { createMemoryOutboxStorage, type OutboxStorage } from '../features/tasks/outbox'
import { OWNER } from './fakeGateway'
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
  /** Who the tools of the administrator act for, from now on: the owner (an administrator) until it is told otherwise. Null is nobody. */
  actAs(userId: string | null): void
}

/** A backend made of the fakes. A person gets the same storage of waiting changes every time they ask for it. */
export function createFakeBackend(options: { tasks?: Task[]; now?: () => Date } = {}): FakeBackend {
  const tasks = createFakeTasks({ tasks: options.tasks, now: options.now })
  const directory = createFakeDirectory()
  // A picture is written on the history of its task, as the database does.
  const attachments = createFakeAttachments({ events: tasks.events })
  const outboxes = new Map<string, OutboxStorage>()
  let acting: string | null = OWNER.id
  return {
    tasks,
    directory,
    attachments,
    outboxes,
    actAs(userId) {
      acting = userId
    },
    backend: {
      tasks: tasks.gateway,
      directory: directory.gateway,
      attachments: attachments.gateway,
      admin: createMemoryAdminGateway({ directory: directory.memory, currentUserId: () => acting }),
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
