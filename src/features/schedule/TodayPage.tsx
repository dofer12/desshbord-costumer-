import { Outlet } from 'react-router'

/** The screen of the day. The card of a task opens over it. */
export function TodayPage() {
  return (
    <section className="today-page" aria-labelledby="today-heading">
      <header className="page-head">
        <h2 id="today-heading">היום</h2>
      </header>
      <Outlet />
    </section>
  )
}
