export function ConfigErrorScreen({ message }: { message: string }) {
  return (
    <main className="auth-screen">
      <section className="card">
        <h1 className="display">האפליקציה עדיין לא הוגדרה</h1>
        <p role="alert" className="alert">
          {message}
        </p>
        <p className="sub">
          פרטי החיבור לשרת נקבעים בזמן הבנייה בקובץ <code className="num">.env</code>. ההוראות נמצאות ב-
          <code className="num">docs/setup-he.md</code>.
        </p>
      </section>
    </main>
  )
}
