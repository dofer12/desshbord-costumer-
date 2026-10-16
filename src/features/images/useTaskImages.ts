import { useCallback, useEffect, useRef, useState } from 'react'
import { toHebrewLoadError } from '../tasks/errors'
import type { Attachment, AttachmentKind } from '../tasks/gateways'
import { useAttachments } from '../tasks/tasksContext'
import { toHebrewImageFailure } from './imageErrors'
import { IMAGE_MESSAGES, resizeToJpeg, validateImageFile } from './resize'

/** The picture as it is kept, and the small one that the grid shows. */
const FULL = { maxEdge: 1600, quality: 0.82 }
const THUMB = { maxEdge: 320, quality: 0.82 }

export interface TaskImages {
  /** The pictures of the task, oldest first. Null until they are loaded. */
  items: Attachment[] | null
  /** Why they could not be loaded. */
  loadFailure: string | null
  /** How many files are waiting to be uploaded, or are being uploaded. */
  uploading: number
  /** What went wrong with the files that were picked last, in words for the person. */
  problems: string[]
  /** Makes the files smaller and uploads them, one after the other. Whatever cannot be added is told in `problems`. */
  add(files: File[], kind: AttachmentKind): void
  /** Deletes a picture. Resolves with what went wrong, or with null when the picture is gone. */
  remove(attachment: Attachment): Promise<string | null>
  /** Tries to load the pictures again. */
  reload(): void
}

interface Loaded {
  taskId: string
  attempt: number
  items: Attachment[] | null
  failure: string | null
}

/** The pictures of a task: loading them, adding and deleting. Pass null for a task that is not saved yet, which has none. */
export function useTaskImages(taskId: string | null): TaskImages {
  const gateway = useAttachments()
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [uploading, setUploading] = useState(0)
  const [problems, setProblems] = useState<string[]>([])
  // One picture at a time: a phone has no memory to decode several photos at once.
  const queue = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    if (taskId === null) return
    let current = true
    gateway.list(taskId).then(
      (items) => {
        if (current) setLoaded({ taskId, attempt, items, failure: null })
      },
      (error: unknown) => {
        if (current) setLoaded({ taskId, attempt, items: null, failure: toHebrewLoadError(error) })
      },
    )
    return () => {
      current = false
    }
  }, [gateway, taskId, attempt])

  const add = useCallback(
    (files: File[], kind: AttachmentKind) => {
      if (taskId === null) return
      const id = taskId
      // With several files the message says which one it is about.
      const named = (file: File, text: string) => (files.length > 1 ? `${file.name}: ${text}` : text)
      const refused: string[] = []
      const accepted: File[] = []
      for (const file of files) {
        const reason = validateImageFile(file)
        if (reason) refused.push(named(file, reason))
        else accepted.push(file)
      }
      setProblems(refused)
      setUploading((count) => count + accepted.length)

      async function upload(file: File): Promise<Attachment | string> {
        let full, thumb
        try {
          full = await resizeToJpeg(file, FULL)
          // The small one is made from the big one: it is quicker to read than the photo.
          thumb = await resizeToJpeg(full.blob, THUMB)
        } catch {
          return IMAGE_MESSAGES.unreadable
        }
        try {
          return await gateway.add(id, { full: full.blob, thumb: thumb.blob, kind, width: full.width, height: full.height })
        } catch (error) {
          return toHebrewImageFailure(error, 'add')
        }
      }

      for (const file of accepted) {
        queue.current = queue.current.then(async () => {
          const result = await upload(file)
          setUploading((count) => count - 1)
          if (typeof result === 'string') {
            setProblems((were) => [...were, named(file, result)])
          } else {
            setLoaded((was) => (was && was.taskId === taskId && was.items ? { ...was, items: [...was.items, result] } : was))
          }
        })
      }
    },
    [gateway, taskId],
  )

  const remove = useCallback(
    async (attachment: Attachment): Promise<string | null> => {
      try {
        await gateway.remove(attachment)
      } catch (error) {
        return toHebrewImageFailure(error, 'remove')
      }
      setLoaded((was) => (was && was.items ? { ...was, items: was.items.filter((item) => item.id !== attachment.id) } : was))
      return null
    },
    [gateway],
  )

  const reload = useCallback(() => setAttempt((count) => count + 1), [])

  const mine = taskId !== null && loaded?.taskId === taskId && loaded.attempt === attempt ? loaded : null
  return { items: mine?.items ?? null, loadFailure: mine?.failure ?? null, uploading, problems, add, remove, reload }
}
