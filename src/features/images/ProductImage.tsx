import type { Task } from '../tasks/model'
import { Picture } from './Picture'
import type { TaskImages } from './useTaskImages'

interface Props {
  task: Task
  images: TaskImages
}

/** The small picture of the product of a pickup, when one of the pictures of the task was set as it. */
export function ProductImage({ task, images }: Props) {
  const picture = task.thumb_attachment_id === null ? undefined : images.items?.find((item) => item.id === task.thumb_attachment_id)
  if (!picture) return null
  return (
    <div className="product-image">
      <Picture path={picture.thumb_path} alt="תמונת המוצר" className="product-thumb" />
    </div>
  )
}
