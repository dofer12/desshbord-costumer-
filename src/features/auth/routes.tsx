import { Navigate, Outlet } from 'react-router'
import { useAuth } from './authContext'
import { ChangePasswordPage } from './ChangePasswordPage'
import { SplashScreen, UnreachableScreen } from './StatusScreens'

/** Shows a splash or "unreachable" screen until the auth state is settled. */
export function AuthShell() {
  const status = useAuth((s) => s.status)
  if (status === 'loading') return <SplashScreen />
  if (status === 'unreachable') return <UnreachableScreen />
  return <Outlet />
}

/**
 * Sends signed-out visitors to the login screen, and holds a person who has not chosen a password of their
 * own on the page that asks for one: they see nothing of the app until they have, and the address they
 * asked for is kept, so that the app opens there afterwards.
 */
export function RequireAuth() {
  const status = useAuth((s) => s.status)
  const mustChangePassword = useAuth((s) => s.profile?.must_change_password === true)
  if (status === 'signedOut') return <Navigate to="/login" replace />
  if (mustChangePassword) return <ChangePasswordPage />
  return <Outlet />
}
