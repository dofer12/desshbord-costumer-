import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { AuthActions, AuthState, AuthStore } from './authStore'

export const AuthContext = createContext<AuthStore | null>(null)

export function useAuth<T>(selector: (state: AuthState & AuthActions) => T): T {
  const store = useContext(AuthContext)
  if (!store) throw new Error('useAuth must be used inside <AuthProvider>')
  return useStore(store, selector)
}
