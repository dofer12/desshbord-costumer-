import { useId, type ReactNode } from 'react'
import { Modal } from './Modal'

interface Props {
  title: string
  /** What the person says yes to, in one or two words: "חסימה", not "כן". */
  confirmLabel: string
  /** What is asked is harmful or hard to take back: the button of the answer looks like it. */
  danger?: boolean
  /** The answer is being carried out: it cannot be given again, and the question cannot be left. */
  busy?: boolean
  onConfirm(): void
  onCancel(): void
  /** The question: what is about to happen, and to whom. */
  children: ReactNode
}

/**
 * A question with two answers, over the page. The cursor starts on the safe answer, so that Enter does no
 * harm, and Escape and a click outside say no. Once the answer is being carried out it cannot be changed.
 */
export function ConfirmDialog({ title, confirmLabel, danger = false, busy = false, onConfirm, onCancel, children }: Props) {
  const headingId = useId()
  return (
    <Modal
      labelledBy={headingId}
      compact
      onClose={() => {
        if (!busy) onCancel()
      }}
    >
      <div className="confirm">
        <h2 id={headingId}>{title}</h2>
        <div className="confirm-question">{children}</div>
        <div className="confirm-actions">
          <button type="button" className={danger ? 'btn danger' : 'btn primary'} disabled={busy} onClick={onConfirm}>
            {busy ? 'מבצע…' : confirmLabel}
          </button>
          <button type="button" className="btn" data-autofocus disabled={busy} onClick={onCancel}>
            ביטול
          </button>
        </div>
      </div>
    </Modal>
  )
}
