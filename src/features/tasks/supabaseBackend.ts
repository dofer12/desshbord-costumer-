import type { SupabaseClient } from '@supabase/supabase-js'
import type { Backend } from './backend'
import { createIdbOutboxStorage } from './outbox'
import {
  createSupabaseAttachmentsGateway,
  createSupabaseDirectoryGateway,
  createSupabaseTasksGateway,
} from './supabaseGateways'

/** The backend of the real app: the Supabase project, and IndexedDB for the waiting changes. */
export function createSupabaseBackend(client: SupabaseClient): Backend {
  return {
    tasks: createSupabaseTasksGateway(client),
    directory: createSupabaseDirectoryGateway(client),
    attachments: createSupabaseAttachmentsGateway(client),
    // One key for each person: what one person left waiting is never sent in the name of the next.
    outbox: (userId) => createIdbOutboxStorage(`moked-outbox-${userId}`),
  }
}
