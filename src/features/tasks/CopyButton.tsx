import { useEffect, useRef, useState, type ReactNode } from 'react'
import { copyText } from '../../lib/clipboard'

/** How long "הועתק" stays next to the value. */
const CONFIRMATION_MS = 1_800

interface Props {
  value: string
  /** What the value is, for the name of the button: "העתקת מספר הזמנה: 10442". */
  label: string
  /** What the button shows. The value itself when it is not given. */
  children?: ReactNode
}

/** A value that is copied to the clipboard when it is clicked, with a word of confirmation for a moment. */
export function CopyButton({ value, label, children }: Props) {
  const [outcome, setOutcome] = useState<'copied' | 'failed' | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      clearTimeout(timer.current)
    }
  }, [])

  async function copy() {
    const worked = await copyText(value)
    if (!mounted.current) return
    setOutcome(worked ? 'copied' : 'failed')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOutcome(null), CONFIRMATION_MS)
  }

  return (
    <span className="copy">
      <button type="button" className="copy-btn num" aria-label={`העתקת ${label}: ${value}`} onClick={() => void copy()}>
        {children ?? value}
      </button>
      {outcome && (
        <span role="status" className={outcome === 'copied' ? 'copy-note' : 'copy-note copy-failed'}>
          {outcome === 'copied' ? 'הועתק' : 'ההעתקה נכשלה'}
        </span>
      )}
    </span>
  )
}
