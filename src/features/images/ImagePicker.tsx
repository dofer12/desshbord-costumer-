import { useEffect, type ChangeEvent } from 'react'
import type { AttachmentKind } from '../tasks/gateways'

interface Props {
  /** True while the pictures are not there yet, when nothing can be added. */
  disabled: boolean
  /** The files that were chosen, and how they came: from the camera or the gallery, or pasted. */
  onPick(files: File[], kind: AttachmentKind): void
}

/** A place where text is typed: a picture that comes with text is meant for it, not for the card. */
const TEXT_FIELD = 'input, textarea, [contenteditable]:not([contenteditable="false"])'

/**
 * The ways to give the card a picture: the camera, the gallery, and Ctrl+V. A paste is taken only when
 * it holds a picture and is not meant for a field: what a spreadsheet copies holds a picture of the
 * cells beside the text, and the text is what the person wants in a field.
 */
export function ImagePicker({ disabled, onPick }: Props) {
  useEffect(() => {
    if (disabled) return
    function onPaste(event: ClipboardEvent) {
      const clipboard = event.clipboardData
      if (!clipboard) return
      const pictures = Array.from(clipboard.files).filter((file) => file.type.startsWith('image/'))
      if (pictures.length === 0) return
      const hasText = Array.from(clipboard.types).includes('text/plain')
      const intoField = event.target instanceof Element && event.target.closest(TEXT_FIELD) !== null
      if (hasText && intoField) return
      event.preventDefault()
      onPick(pictures, 'screenshot')
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [disabled, onPick])

  function onChoose(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    // The browser says nothing when the same file is chosen again; this lets it be chosen twice in a row.
    event.target.value = ''
    if (files.length > 0) onPick(files, 'image')
  }

  const button = disabled ? 'btn file-btn disabled' : 'btn file-btn'
  return (
    <div className="image-actions">
      <label className={button}>
        צלם
        <input type="file" accept="image/*" capture="environment" className="visually-hidden" disabled={disabled} onChange={onChoose} />
      </label>
      <label className={button}>
        מהגלריה
        <input type="file" accept="image/*" multiple className="visually-hidden" disabled={disabled} onChange={onChoose} />
      </label>
      <span className="hint">אפשר גם להדביק תמונה (Ctrl+V).</span>
    </div>
  )
}
