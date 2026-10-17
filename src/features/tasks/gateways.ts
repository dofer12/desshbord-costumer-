import type { Profile } from '../auth/types'
import type { Task, TaskPatch } from './model'

// What the screens and stores need from the backend, as plain interfaces: the real thing talks to
// Supabase (supabaseGateways.ts) and the tests use in-memory fakes (src/test/fakeTasksGateways.ts).
//
// A failed call rejects with an Error that carries the HTTP `status` (0 when the server could not be
// reached), like the auth gateway does. `isRetryable` in errors.ts reads it.

export type TaskEventType =
  | 'created'
  | 'updated'
  | 'status'
  | 'assigned'
  | 'done'
  | 'reopened'
  | 'deleted'
  | 'restored'
  | 'attachment_added'
  | 'attachment_removed'

/** A line of the history of a task: who did what, and the old and the new value of what changed. */
export interface TaskEvent {
  id: number
  task_id: string
  actor_id: string | null
  type: TaskEventType
  changes: Record<string, [unknown, unknown]>
  at: string
}

export interface Status {
  key: string
  name_he: string
  color: string
  sort: number
  is_active: boolean
}

/** The `app_settings` table as one object. */
export interface Settings {
  glassix_url_template: string
  ship_methods: string[]
  last_backup_at: string | null
}

export type AttachmentKind = 'image' | 'screenshot' | 'product'

export interface Attachment {
  id: string
  task_id: string
  storage_path: string
  thumb_path: string
  kind: AttachmentKind
  width: number | null
  height: number | null
  bytes: number | null
  uploaded_by: string | null
  created_at: string
}

export interface TaskChangeEvent {
  type: 'upsert'
  task: Task
}

export interface TasksGateway {
  /** Every open task and every task done in the last 30 days, not deleted, whatever their number. */
  loadInitial(now: Date): Promise<Task[]>
  /** The server-side search over all tasks that are not deleted: at most 200 rows, newest change first. */
  search(query: string): Promise<Task[]>
  /** Creates or changes a task. Safe to send again: the id is made by the app, and the patch holds only the changed fields. */
  /** `options.signal` stops the request: the store gives up on one that is never answered. */
  upsert(id: string, patch: TaskPatch, options?: { signal?: AbortSignal }): Promise<Task>
  /** Calls back for every row that changes anywhere, and with `false` whenever the live connection is lost. */
  subscribe(onEvent: (event: TaskChangeEvent) => void, onState: (live: boolean) => void): () => void
  /** The history of a task, newest first. */
  loadHistory(taskId: string): Promise<TaskEvent[]>
}

export interface DirectoryGateway {
  load(): Promise<{ statuses: Status[]; profiles: Profile[]; settings: Settings }>
  /** Calls back when a status, a setting or a profile changes anywhere. */
  subscribe(onChange: () => void): () => void
}

export interface AttachmentsGateway {
  list(taskId: string): Promise<Attachment[]>
  /** Uploads both pictures and then adds the row. If anything fails, nothing is left behind. */
  add(
    taskId: string,
    files: { full: Blob; thumb: Blob; kind: AttachmentKind; width: number; height: number },
  ): Promise<Attachment>
  /** Deletes the row, then the files. A file that cannot be removed is ignored: it harms no one. */
  remove(attachment: Attachment): Promise<void>
  /** An address that shows a picture of the private bucket for one hour. */
  signedUrl(path: string): Promise<string>
}
