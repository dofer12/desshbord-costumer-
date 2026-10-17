import { useId, useRef, useState, type FormEvent } from 'react'
import { useAuth } from './authContext'
import { checkNewPassword, type NewPasswordError } from './credentials'

interface PasswordFormProps {
  /** What the form is called, for a screen reader. */
  label: string
  submitLabel: string
  /** Said under the button once the password is changed. Left out where the whole screen goes away by itself. */
  doneMessage?: string
  /** The cursor starts in the first field. */
  autoFocus?: boolean
}

/**
 * Choosing a password: the password, and the same again. It is the form of the first sign-in and the form
 * of the profile, and both use the same action of the store. Nothing is kept once the password is changed.
 */
export function PasswordForm({ label, submitLabel, doneMessage, autoFocus = false }: PasswordFormProps) {
  const changePassword = useAuth((state) => state.changePassword)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [problem, setProblem] = useState<NewPasswordError | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)
  const passwordId = useId()
  const confirmId = useId()
  const passwordErrorId = useId()
  const confirmErrorId = useId()

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setServerError(null)
    setDone(false)
    const found = checkNewPassword(password, confirm)
    setProblem(found)
    if (found) {
      const field = found.field === 'password' ? passwordRef : confirmRef
      field.current?.focus()
      return
    }
    setBusy(true)
    const message = await changePassword(password)
    setBusy(false)
    if (message) {
      setServerError(message)
      return
    }
    setPassword('')
    setConfirm('')
    setDone(true)
  }

  const passwordProblem = problem?.field === 'password' ? problem.message : null
  const confirmProblem = problem?.field === 'confirm' ? problem.message : null

  return (
    <form className="password-form" aria-label={label} onSubmit={(e) => void onSubmit(e)} noValidate>
      {serverError && (
        <p role="alert" className="alert">
          {serverError}
        </p>
      )}

      <div className="field">
        <label htmlFor={passwordId}>סיסמה חדשה</label>
        <input
          id={passwordId}
          ref={passwordRef}
          type="password"
          dir="ltr"
          autoComplete="new-password"
          autoFocus={autoFocus}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setDone(false)
          }}
          aria-invalid={passwordProblem ? true : undefined}
          aria-describedby={passwordProblem ? passwordErrorId : undefined}
        />
        {passwordProblem && (
          <p id={passwordErrorId} className="field-error">
            {passwordProblem}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor={confirmId}>אימות הסיסמה</label>
        <input
          id={confirmId}
          ref={confirmRef}
          type="password"
          dir="ltr"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value)
            setDone(false)
          }}
          aria-invalid={confirmProblem ? true : undefined}
          aria-describedby={confirmProblem ? confirmErrorId : undefined}
        />
        {confirmProblem && (
          <p id={confirmErrorId} className="field-error">
            {confirmProblem}
          </p>
        )}
      </div>

      <button type="submit" className="btn primary" disabled={busy}>
        {busy ? 'שומר…' : submitLabel}
      </button>

      {done && doneMessage && (
        <p role="status" className="sub">
          {doneMessage}
        </p>
      )}
    </form>
  )
}
