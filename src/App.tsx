import { Navigate, Route, Routes } from 'react-router'
import { LoginPage } from './features/auth/LoginPage'
import { AuthShell, RequireAuth } from './features/auth/routes'
import { CalendarPage } from './features/schedule/CalendarPage'
import { TodayPage } from './features/schedule/TodayPage'
import { AppShell } from './features/shell/AppShell'
import { TaskCardRoute } from './features/tasks/TaskCardRoute'
import { TasksPage } from './features/tasks/TasksPage'
import { TasksProvider } from './features/tasks/TasksProvider'

// The card of a task opens over the page it was opened from, so that the page keeps its filters, its
// day and its place. Closing the card goes back to that page.
const cardRoutes = (
  <>
    <Route path="new" element={<TaskCardRoute />} />
    <Route path=":id" element={<TaskCardRoute />} />
  </>
)

export function App({ serverHost }: { serverHost: string }) {
  return (
    <Routes>
      <Route element={<AuthShell />}>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route
            element={
              <TasksProvider>
                <AppShell serverHost={serverHost} />
              </TasksProvider>
            }
          >
            <Route index element={<Navigate to="/today" replace />} />
            <Route path="today" element={<TodayPage />}>
              {cardRoutes}
            </Route>
            <Route path="tasks" element={<TasksPage />}>
              {cardRoutes}
            </Route>
            <Route path="calendar" element={<CalendarPage />}>
              {cardRoutes}
            </Route>
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
