import { NavLink, Outlet } from 'react-router'

/** The pages of the area, in the order of their links. */
const AREAS = [
  { to: 'employees', label: 'עובדים' },
  { to: 'statuses', label: 'סטטוסים' },
  { to: 'settings', label: 'הגדרות' },
  { to: 'import', label: 'ייבוא' },
  { to: 'backup', label: 'גיבוי' },
  { to: 'deleted', label: 'נמחקו לאחרונה' },
] as const

/** The frame of the Admin area: its heading, the links to its pages, and the page that is open. */
export function AdminPage() {
  return (
    <section className="admin-page" aria-labelledby="admin-heading">
      <header className="page-head">
        <h2 id="admin-heading">ניהול</h2>
      </header>
      <nav className="admin-nav" aria-label="אזורי הניהול">
        {AREAS.map(({ to, label }) => (
          <NavLink key={to} to={to} className="admin-tab">
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </section>
  )
}
