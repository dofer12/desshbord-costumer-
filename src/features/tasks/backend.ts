import { createContext, useContext } from 'react'
import type { AdminGateway } from '../admin/gateways'
import type { AttachmentsGateway, DirectoryGateway, TasksGateway } from './gateways'
import type { OutboxStorage } from './outbox'

/**
 * Everything that the screens need from outside the app: the gateways (the tasks, the directory of
 * people, statuses and settings, the pictures, and the tools of the administrator), and the place where
 * the waiting changes of one person are kept on this device. The real app and the demo build each make
 * one, in main.tsx, and the tests make one from fakes.
 */
export interface Backend {
  tasks: TasksGateway
  directory: DirectoryGateway
  attachments: AttachmentsGateway
  admin: AdminGateway
  /** The storage of one person's waiting changes. It has to be a different one for every person. */
  outbox(userId: string): OutboxStorage
}

export const BackendContext = createContext<Backend | null>(null)

export function useBackend(): Backend {
  const backend = useContext(BackendContext)
  if (!backend) throw new Error('useBackend must be used inside a <BackendContext>')
  return backend
}
