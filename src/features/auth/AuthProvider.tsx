import type { ReactNode } from 'react'
import { AuthContext } from './authContext'
import type { AuthStore } from './authStore'

export function AuthProvider({ store, children }: { store: AuthStore; children: ReactNode }) {
  return <AuthContext value={store}>{children}</AuthContext>
}
