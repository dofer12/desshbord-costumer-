import { useAuth } from './authContext'

export function SplashScreen() {
  return (
    <main className="auth-screen">
      <p className="sub" role="status">
        טוען…
      </p>
    </main>
  )
}

export function UnreachableScreen() {
  const retry = useAuth((s) => s.retry)
  return (
    <main className="auth-screen">
      <section className="card">
        <h1 className="display">אין חיבור לשרת</h1>
        <p>לא הצלחנו להגיע לשרת. בדקו את החיבור לאינטרנט ונסו שוב. ההתחברות שלכם נשמרה.</p>
        <button type="button" className="btn primary" onClick={() => void retry()}>
          נסו שוב
        </button>
      </section>
    </main>
  )
}
