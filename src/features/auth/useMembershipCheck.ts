import { useEffect } from 'react'
import { useAuth } from './authContext'

/** How often a signed-in user is checked to still be an active member. */
const MEMBERSHIP_CHECK_MS = 5 * 60_000

/**
 * Looks at the profile of the signed-in user when the app comes back to the front and every five
 * minutes. A user who was deactivated while the app was open is sent back to the login screen, with
 * the reason, instead of looking at a list that has silently gone empty. A profile that has begun to
 * ask for a new password (an administrator reset it) is seen the same way, and holds the app back.
 *
 * Every screen of a signed-in user has it: the frame of the app, and the page that asks for a password.
 */
export function useMembershipCheck() {
  const recheck = useAuth((state) => state.recheck)
  useEffect(() => {
    const check = () => void recheck()
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(check, MEMBERSHIP_CHECK_MS)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [recheck])
}
