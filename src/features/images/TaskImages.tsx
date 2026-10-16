import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/authContext'
import type { Attachment } from '../tasks/gateways'
import type { Task } from '../tasks/model'
import { useTasks } from '../tasks/tasksContext'
import { ImagePicker } from './ImagePicker'
import { ImageViewer } from './ImageViewer'
import { Picture } from './Picture'
import type { TaskImages as Images } from './useTaskImages'

interface Props {
  /** A task that is saved: the pictures belong to it on the server. */
  task: Task
  images: Images
}

/** The pictures of a task: the ways to add one, a small picture of each, and a window to look at one. */
export function TaskImages({ task, images }: Props) {
  const update = useTasks((state) => state.update)
  const me = useAuth((state) => state.profile)
  const [viewing, setViewing] = useState<string | null>(null)
  const [refocus, setRefocus] = useState(0)
  const region = useRef<HTMLDivElement>(null)
  const { items } = images

  // Once a picture is deleted the focus has nothing to stand on: give it to a picture that is left, or to the first button.
  useEffect(() => {
    if (refocus === 0) return
    const root = region.current
    const target = root?.querySelector<HTMLElement>('.image-thumb') ?? root?.querySelector<HTMLElement>('input[type="file"]')
    target?.focus()
  }, [refocus])

  const open = items?.find((item) => item.id === viewing) ?? null
  // Only a pickup has a picture of the product.
  const productId = task.kind === 'pickup' ? task.thumb_attachment_id : null

  async function remove(attachment: Attachment): Promise<string | null> {
    const failure = await images.remove(attachment)
    if (failure) return failure
    if (task.thumb_attachment_id === attachment.id) update(task.id, { thumb_attachment_id: null })
    setViewing(null)
    setRefocus((count) => count + 1)
    return null
  }

  return (
    <div className="images" ref={region}>
      <ImagePicker disabled={items === null} onPick={images.add} />

      {images.problems.map((problem, index) => (
        <p key={index} role="alert" className="alert">
          {problem}
        </p>
      ))}
      {images.uploading > 0 && (
        <p role="status" className="hint">
          {images.uploading === 1 ? 'מעלה תמונה…' : `מעלה ${images.uploading} תמונות…`}
        </p>
      )}

      {items === null ? (
        images.loadFailure ? (
          <div className="images-failed">
            <p role="alert" className="alert">
              {images.loadFailure}
            </p>
            <button type="button" className="btn" onClick={images.reload}>
              נסו שוב
            </button>
          </div>
        ) : (
          <p className="state">טוען תמונות…</p>
        )
      ) : items.length === 0 ? (
        <p className="state">אין תמונות עדיין.</p>
      ) : (
        <ul className="image-grid" aria-label="תמונות המשימה">
          {items.map((item, index) => {
            const isProduct = item.id === productId
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="image-thumb"
                  aria-label={`תמונה ${index + 1} מתוך ${items.length}${isProduct ? ', תמונת מוצר' : ''}`}
                  onClick={() => setViewing(item.id)}
                >
                  <Picture path={item.thumb_path} alt="" />
                  {isProduct && <span className="image-badge">תמונת מוצר</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {open && items && (
        <ImageViewer
          attachment={open}
          position={items.indexOf(open) + 1}
          total={items.length}
          isProduct={task.kind === 'pickup' ? open.id === productId : null}
          // The server lets whoever uploaded a picture delete it, and an administrator any picture.
          canDelete={me !== null && (me.role === 'admin' || open.uploaded_by === me.id)}
          onClose={() => setViewing(null)}
          onToggleProduct={() => update(task.id, { thumb_attachment_id: open.id === productId ? null : open.id })}
          onRemove={() => remove(open)}
        />
      )}
    </div>
  )
}
