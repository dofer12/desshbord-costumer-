import { useId, useState } from 'react'
import { copyText } from '../../lib/clipboard'
import { Modal } from '../../ui/Modal'

interface Props {
  /** A new employee, or a password that was reset. */
  kind: 'created' | 'reset'
  /** Whose password it is. */
  person: string
  /** The temporary password. It is a prop and goes nowhere: not into a storage, a name, a title or the address. */
  password: string
  onClose(): void
}

const TITLES = { created: 'העובד נוצר', reset: 'הסיסמה אופסה' } as const

/**
 * The only place where a temporary password is shown, and it is shown once: it stays for as long as the
 * dialog does, and the page that opened it holds it in no other place. The person copies it with the button
 * and hands it over; at the first sign-in the employee chooses a password of their own.
 */
export function TempPasswordDialog({ kind, person, password, onClose }: Props) {
  const headingId = useId()
  const labelId = useId()
  const [outcome, setOutcome] = useState<'copied' | 'failed' | null>(null)

  async function copy() {
    setOutcome((await copyText(password)) ? 'copied' : 'failed')
  }

  return (
    <Modal labelledBy={headingId} compact onClose={onClose}>
      <div className="confirm">
        <h2 id={headingId}>{TITLES[kind]}</h2>
        <p>{kind === 'created' ? `נוצר משתמש עבור ${person}.` : `הסיסמה של ${person} אופסה, והוא נותק מכל המכשירים.`}</p>

        <div role="group" aria-labelledby={labelId} className="temp-password-box">
          <p id={labelId} className="sub">
            הסיסמה הזמנית
          </p>
          <code className="temp-password num" dir="ltr">
            {password}
          </code>
        </div>

        <div className="confirm-actions">
          <button type="button" className="btn primary" onClick={() => void copy()}>
            העתקת הסיסמה
          </button>
          {outcome && (
            <span role="status" className={outcome === 'copied' ? 'copy-note' : 'copy-note copy-failed'}>
              {outcome === 'copied' ? 'הועתק' : 'ההעתקה נכשלה: סמנו את הסיסמה והעתיקו אותה ידנית.'}
            </span>
          )}
        </div>

        <p className="sub">
          הסיסמה מוצגת פעם אחת בלבד: אחרי הסגירה אי אפשר לראות אותה שוב. מסרו אותה לעובד בדרך בטוחה; בכניסה הראשונה הוא יבחר סיסמה משלו.
        </p>

        <div className="confirm-actions">
          <button type="button" className="btn" onClick={onClose}>
            סגירה
          </button>
        </div>
      </div>
    </Modal>
  )
}
