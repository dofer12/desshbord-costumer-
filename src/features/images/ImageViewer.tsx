import { useEffect, useId, useRef, useState } from 'react'
import { Modal } from '../../ui/Modal'
import type { Attachment } from '../tasks/gateways'
import { Picture } from './Picture'

interface Props {
  attachment: Attachment
  /** Which picture this is of all of them, counting from 1. */
  position: number
  total: number
  /** Whether it is the picture of the product. Null for a task that is not a pickup, which has no such picture. */
  isProduct: boolean | null
  /** Whether the person may delete it: the button is not offered to somebody whom the server would refuse. */
  canDelete: boolean
  onClose(): void
  onToggleProduct(): void
  /** Deletes the picture. Resolves with what went wrong, or with null when it is gone, and then the window goes too. */
  onRemove(): Promise<string | null>
}

/** One picture at full size in a window of its own over the card, with what can be done to it. */
export function ImageViewer({ attachment, position, total, isProduct, canDelete, onClose, onToggleProduct, onRemove }: Props) {
  const heading = useId()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const safeAnswer = useRef<HTMLButtonElement>(null)
  const deleteButton = useRef<HTMLButtonElement>(null)
  const wasAsking = useRef(false)

  // The question puts the focus on the safe answer. When it is gone without the picture, the focus
  // goes back to the button that asked it: the one that had it is no longer on the page.
  useEffect(() => {
    if (asking) safeAnswer.current?.focus()
    else if (wasAsking.current) deleteButton.current?.focus()
    wasAsking.current = asking
  }, [asking])

  function requestClose() {
    if (busy) return
    if (asking) setAsking(false)
    else onClose()
  }

  async function confirmDelete() {
    setBusy(true)
    const failure = await onRemove()
    setBusy(false)
    if (failure) {
      setProblem(failure)
      setAsking(false)
    }
  }

  return (
    <Modal labelledBy={heading} onClose={requestClose}>
      <div className="image-viewer">
        <header className="card-head">
          <h2 id={heading}>{`תמונה ${position} מתוך ${total}`}</h2>
          <button type="button" className="icon-btn" aria-label="סגירת התמונה" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="viewer-body">
          <Picture path={attachment.storage_path} alt="התמונה המצורפת" className="viewer-image" />
        </div>

        {problem && (
          <p role="alert" className="alert viewer-problem">
            {problem}
          </p>
        )}

        {asking ? (
          <footer className="card-actions" role="alert">
            <p>למחוק את התמונה?</p>
            <button type="button" className="btn danger" disabled={busy} onClick={() => void confirmDelete()}>
              כן, למחוק
            </button>
            <button type="button" className="btn" ref={safeAnswer} disabled={busy} onClick={() => setAsking(false)}>
              לא, להשאיר
            </button>
          </footer>
        ) : (
          <footer className="card-actions">
            {isProduct !== null && (
              <>
                <button type="button" className="btn" onClick={onToggleProduct}>
                  {isProduct ? 'הסר כתמונת מוצר' : 'קבע כתמונת מוצר'}
                </button>
                <span role="status" className="product-note">
                  {isProduct ? 'זו תמונת המוצר' : ''}
                </span>
              </>
            )}
            {canDelete && (
              <button
                type="button"
                className="btn danger push"
                ref={deleteButton}
                onClick={() => {
                  setProblem(null)
                  setAsking(true)
                }}
              >
                מחיקת התמונה
              </button>
            )}
          </footer>
        )}
      </div>
    </Modal>
  )
}
