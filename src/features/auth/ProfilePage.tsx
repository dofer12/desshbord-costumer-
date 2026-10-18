import { useId, useRef, useState, type FormEvent } from 'react'
import { useAuth } from './authContext'
import { PROFILE_MESSAGES } from './errors'
import { PasswordForm } from './PasswordForm'
import { validateProfileForm, type ProfileFormErrors } from './profileForm'
import { ROLE_LABEL } from './roles'
import { ThemePicker } from './ThemePicker'
import { UpdateCheck } from './UpdateCheck'

/**
 * Where a person looks after themselves: the name that the team sees, the reminder that their new tasks
 * start with, and their password. Who they are (the e-mail and the role) is shown and not editable here:
 * an administrator changes the role, and the e-mail is how they sign in.
 */
export function ProfilePage() {
  const profile = useAuth((state) => state.profile)
  const saveProfile = useAuth((state) => state.saveProfile)
  const [name, setName] = useState(profile?.display_name ?? '')
  const [remind, setRemind] = useState(String(profile?.default_remind_min ?? 15))
  const [errors, setErrors] = useState<ProfileFormErrors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const remindRef = useRef<HTMLInputElement>(null)
  const nameId = useId()
  const remindId = useId()
  const nameErrorId = useId()
  const remindHintId = useId()
  const remindErrorId = useId()
  const passwordHeadingId = useId()
  const themeHeadingId = useId()
  const versionHeadingId = useId()

  if (!profile) return null

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setServerError(null)
    setSaved(false)
    const result = validateProfileForm(name, remind)
    if (!result.ok) {
      setErrors(result.errors)
      const field = result.errors.name ? nameRef : remindRef
      field.current?.focus()
      return
    }
    setErrors({})
    setBusy(true)
    const message = await saveProfile(result.input)
    setBusy(false)
    if (message === null) {
      setName(result.input.display_name)
      setRemind(String(result.input.default_remind_min))
      setSaved(true)
    } else if (message === PROFILE_MESSAGES.name_taken) {
      // The name is the one thing that can be wrong in a way that only the server knows.
      setErrors({ name: message })
      nameRef.current?.focus()
    } else {
      setServerError(message)
    }
  }

  const edited = () => setSaved(false)

  return (
    <section className="profile-page" aria-labelledby="profile-heading">
      <header className="page-head">
        <h2 id="profile-heading">הפרופיל שלי</h2>
      </header>

      <form className="card profile-card" aria-label="פרטים אישיים" onSubmit={(e) => void onSubmit(e)} noValidate>
        <dl className="profile-facts">
          <div>
            <dt>אימייל</dt>
            <dd className="num">{profile.email}</dd>
          </div>
          <div>
            <dt>תפקיד</dt>
            <dd>{ROLE_LABEL[profile.role]}</dd>
          </div>
        </dl>

        {serverError && (
          <p role="alert" className="alert">
            {serverError}
          </p>
        )}

        <div className="field">
          <label htmlFor={nameId}>שם תצוגה</label>
          <input
            id={nameId}
            ref={nameRef}
            type="text"
            autoComplete="off"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              edited()
            }}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? nameErrorId : undefined}
          />
          {errors.name && (
            <p id={nameErrorId} className="field-error">
              {errors.name}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor={remindId}>תזכורת ברירת מחדל (בדקות לפני המועד)</label>
          <input
            id={remindId}
            ref={remindRef}
            type="text"
            inputMode="numeric"
            dir="ltr"
            autoComplete="off"
            value={remind}
            onChange={(e) => {
              setRemind(e.target.value)
              edited()
            }}
            aria-invalid={errors.remind ? true : undefined}
            aria-describedby={errors.remind ? `${remindHintId} ${remindErrorId}` : remindHintId}
          />
          <p id={remindHintId} className="sub">
            0 הוא בדיוק בזמן המועד. משימה חדשה שלכם מתחילה עם התזכורת הזו.
          </p>
          {errors.remind && (
            <p id={remindErrorId} className="field-error">
              {errors.remind}
            </p>
          )}
        </div>

        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'שומר…' : 'שמירה'}
        </button>

        {saved && (
          <p role="status" className="sub">
            הפרופיל נשמר.
          </p>
        )}
      </form>

      <section className="card profile-card" aria-labelledby={passwordHeadingId}>
        <h3 id={passwordHeadingId}>החלפת סיסמה</h3>
        <PasswordForm label="החלפת סיסמה" submitLabel="החלפת סיסמה" doneMessage="הסיסמה הוחלפה." />
      </section>

      <section className="card profile-card" aria-labelledby={themeHeadingId}>
        <h3 id={themeHeadingId}>מראה</h3>
        <ThemePicker />
        <p className="sub">הבחירה נשמרת במכשיר הזה בלבד.</p>
      </section>

      <section className="card profile-card" aria-labelledby={versionHeadingId}>
        <h3 id={versionHeadingId}>גרסה ועדכון</h3>
        <UpdateCheck />
      </section>
    </section>
  )
}
