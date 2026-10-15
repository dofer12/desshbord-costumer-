import { Navigate, Route, Routes } from 'react-router'
import { LoginPage } from './features/auth/LoginPage'
import { AuthShell, RequireAuth } from './features/auth/routes'
import { AppShell } from './features/shell/AppShell'
import { TaskCardRoute } from './features/tasks/TaskCardRoute'
import { TasksPage } from './features/tasks/TasksPage'
import { TasksProvider } from './features/tasks/TasksProvider'

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
            <Route index element={<Navigate to="/tasks" replace />} />
            {/* The card of a task opens beside the list, so that the list keeps its filters and its place. */}
            <Route path="tasks" element={<TasksPage />}>
              <Route path="new" element={<TaskCardRoute />} />
              <Route path=":id" element={<TaskCardRoute />} />
            </Route>
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
