import { Navigate, Outlet } from 'react-router'
import { useAuth } from '../auth/authContext'

/**
 * The door of the Admin area: an administrator goes through, anybody else is sent to Today. It reads the
 * role from the profile that the app holds, so a person whose role changes while the app is open is let in,
 * or sent out, as soon as the app reads the profile again. It is not the protection: the database and the
 * function of the administrators check every request again.
 */
export function RequireAdmin() {
  const isAdmin = useAuth((state) => state.profile?.role === 'admin')
  if (!isAdmin) return <Navigate to="/today" replace />
  return <Outlet />
}
