import { useId, useRef, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { useAuth } from './authContext'
import { validateCredentials, type CredentialErrors } from './credentials'

export function LoginPage() {
  const status = useAuth((s) => s.status)
  const busy = useAuth((s) => s.busy)
  const serverError = useAuth((s) => s.error)
  const signIn = useAuth((s) => s.signIn)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<CredentialErrors>({})
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const emailId = useId()
  const passwordId = useId()
  const emailErrorId = useId()
  const passwordErrorId = useId()

  if (status === 'signedIn') return <Navigate to="/" replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const errors = validateCredentials(email, password)
    setFieldErrors(errors)
    if (errors.email) {
      emailRef.current?.focus()
      return
    }
    if (errors.password) {
      passwordRef.current?.focus()
      return
    }
    await signIn(email, password)
  }

  return (
    <main className="auth-screen">
      <form className="card login" onSubmit={(e) => void onSubmit(e)} noValidate>
        <h1 className="display">יומן משימות מוקד</h1>
        <p className="sub">התחברו עם המשתמש האישי שלכם</p>

        {serverError && (
          <p role="alert" className="alert">
            {serverError}
          </p>
        )}

        <div className="field">
          <label htmlFor={emailId}>אימייל</label>
          <input
            id={emailId}
            ref={emailRef}
            name="email"
            type="email"
            dir="ltr"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? emailErrorId : undefined}
          />
          {fieldErrors.email && (
            <p id={emailErrorId} className="field-error">
              {fieldErrors.email}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor={passwordId}>סיסמה</label>
          <input
            id={passwordId}
            ref={passwordRef}
            name="password"
            type="password"
            dir="ltr"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={fieldErrors.password ? passwordErrorId : undefined}
          />
          {fieldErrors.password && (
            <p id={passwordErrorId} className="field-error">
              {fieldErrors.password}
            </p>
          )}
        </div>

        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'מתחבר…' : 'כניסה'}
        </button>
      </form>
    </main>
  )
}
