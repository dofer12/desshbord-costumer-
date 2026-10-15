import { createContext, useContext } from 'react'
import type { AttachmentsGateway, DirectoryGateway, TasksGateway } from './gateways'
import type { OutboxStorage } from './outbox'

/**
 * Everything that the screens of the tasks need from outside the app: the three gateways, and the
 * place where the waiting changes of one person are kept on this device. The real app and the demo
 * build each make one, in main.tsx, and the tests make one from fakes.
 */
export interface Backend {
  tasks: TasksGateway
  directory: DirectoryGateway
  attachments: AttachmentsGateway
  /** The storage of one person's waiting changes. It has to be a different one for every person. */
  outbox(userId: string): OutboxStorage
}

export const BackendContext = createContext<Backend | null>(null)

export function useBackend(): Backend {
  const backend = useContext(BackendContext)
  if (!backend) throw new Error('useBackend must be used inside a <BackendContext>')
  return backend
}
