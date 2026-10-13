import { Navigate, Outlet } from 'react-router'
import { useAuth } from './authContext'
import { SplashScreen, UnreachableScreen } from './StatusScreens'

/** Shows a splash or "unreachable" screen until the auth state is settled. */
export function AuthShell() {
  const status = useAuth((s) => s.status)
  if (status === 'loading') return <SplashScreen />
  if (status === 'unreachable') return <UnreachableScreen />
  return <Outlet />
}

/** Sends signed-out visitors to the login screen. */
export function RequireAuth() {
  const status = useAuth((s) => s.status)
  if (status === 'signedOut') return <Navigate to="/login" replace />
  return <Outlet />
}
