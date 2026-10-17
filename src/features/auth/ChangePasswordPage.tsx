import { useAuth } from './authContext'
import { MIN_PASSWORD_LENGTH } from './credentials'
import { PasswordForm } from './PasswordForm'
import { useMembershipCheck } from './useMembershipCheck'

/**
 * Shown instead of the whole app to a person who has not chosen a password of their own: after an
 * administrator created them, or reset their password. Nothing of the app is mounted behind it, and
 * the address that was asked for is kept, so the app opens there once the password is chosen.
 */
export function ChangePasswordPage() {
  useMembershipCheck()
  const signOut = useAuth((state) => state.signOut)
  return (
    <main className="auth-screen">
      <div className="card login">
        <h1 className="display">בחירת סיסמה חדשה</h1>
        <p className="sub">
          כדי להמשיך, בחרו סיסמה אישית שתחליף את הסיסמה הזמנית. רק אתם תכירו אותה. לפחות {MIN_PASSWORD_LENGTH} תווים.
        </p>
        <PasswordForm label="בחירת סיסמה חדשה" submitLabel="שמירה והמשך" autoFocus />
        <button type="button" className="btn" onClick={() => void signOut()}>
          התנתקות
        </button>
      </div>
    </main>
  )
}
