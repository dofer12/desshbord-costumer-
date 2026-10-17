import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'

interface Props {
  /** The id of the heading inside, which gives the dialog its name. */
  labelledBy: string
  /** Called for the Escape key and for a click on the dark area; the owner decides whether to close. */
  onClose(): void
  /** A question with a few answers: narrow, and not a whole screen on a phone. The card of a task is the large one. */
  compact?: boolean
  children: ReactNode
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'

/** What can take the focus now: not a disabled control, and not what is inside a section that is closed. */
function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => {
    const closed = element.closest('details:not([open])')
    return !closed || (element.tagName === 'SUMMARY' && element.parentElement === closed)
  })
}

/**
 * A dialog over the page: the focus moves into it and comes back to what had it when it closes,
 * the Tab key stays inside, Escape and a click outside ask the owner to close it, and the page
 * behind does not scroll. On a phone the styles make it fill the screen.
 */
export function Modal({ labelledBy, onClose, compact = false, children }: Props) {
  const panel = useRef<HTMLDivElement>(null)
  const pressedOnBackdrop = useRef(false)

  useEffect(() => {
    const element = panel.current
    if (!element) return
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const scrolling = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const wanted = element.querySelector<HTMLElement>('[data-autofocus]')
    ;(wanted ?? focusableIn(element)[0] ?? element).focus()
    return () => {
      document.body.style.overflow = scrolling
      before?.focus()
    }
  }, [])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !panel.current) return
    const items = focusableIn(panel.current)
    if (items.length === 0) {
      event.preventDefault()
      return
    }
    const [first, last] = [items[0], items[items.length - 1]]
    const here = document.activeElement
    if (event.shiftKey && (here === first || here === panel.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && here === last) {
      event.preventDefault()
      first.focus()
    }
  }

  // A click counts only when it began and ended on the dark area: a text selection that is dragged
  // out of the dialog must not close it.
  function onBackdropDown(event: MouseEvent<HTMLDivElement>) {
    pressedOnBackdrop.current = event.target === event.currentTarget
  }
  function onBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (pressedOnBackdrop.current && event.target === event.currentTarget) onClose()
    pressedOnBackdrop.current = false
  }

  return (
    <div className="modal-backdrop" onMouseDown={onBackdropDown} onClick={onBackdropClick}>
      <div className={compact ? 'modal modal-compact' : 'modal'} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} ref={panel} onKeyDown={onKeyDown}>
        {children}
      </div>
    </div>
  )
}
