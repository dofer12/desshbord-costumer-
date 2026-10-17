import { Outlet } from 'react-router'

/** The calendar of the tasks. The card of a task opens over it. */
export function CalendarPage() {
  return (
    <section className="calendar-page" aria-labelledby="calendar-heading">
      <header className="page-head">
        <h2 id="calendar-heading">יומן</h2>
      </header>
      <Outlet />
    </section>
  )
}
