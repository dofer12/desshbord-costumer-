import { useAuth } from '../auth/authContext'

const ROLE_LABEL = { admin: 'מנהל', employee: 'עובד' } as const

export function HomePage({ serverHost }: { serverHost: string }) {
  const profile = useAuth((s) => s.profile)
  const signOut = useAuth((s) => s.signOut)
  if (!profile) return null

  return (
    <main className="shell">
      <header className="shell-bar">
        <h1 className="display">יומן משימות מוקד</h1>
        <button type="button" className="btn" onClick={() => void signOut()}>
          התנתקות
        </button>
      </header>

      <section className="card">
        <h2>שלום, {profile.display_name}</h2>
        <p className="sub">תפקיד: {ROLE_LABEL[profile.role]}</p>
        <p>השלד של האפליקציה פועל. מסך היום, המשימות והיומן ייבנו בשלבים הבאים.</p>
      </section>

      <footer className="sub">
        גרסה <span className="num">{__APP_VERSION__}</span> · שרת: <span className="num">{serverHost}</span>
      </footer>
    </main>
  )
}
