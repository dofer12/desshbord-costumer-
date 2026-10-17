import { useContext, useEffect } from 'react'
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router'

// The card of a task asks before it throws away what was typed, when it is closed with its own buttons
// or with Escape. These are the ways out that it does not know of: the Back button of the phone, the Back
// of the browser, a link to another card. Nothing else tells the card that it is being left.

/** A way out that was held back: let it through, or stay on the card. */
export interface HeldNavigation {
  proceed(): void
  reset(): void
}

interface GuardProps {
  /** Asked at the moment of each navigation: whether it is to be held back. */
  shouldHold(): boolean
  /** Told when a navigation was held back. */
  onHeld(held: HeldNavigation): void
}

function Guard({ shouldHold, onHeld }: GuardProps) {
  const blocker = useBlocker(shouldHold)
  useEffect(() => {
    if (blocker.state === 'blocked') onHeld({ proceed: blocker.proceed, reset: blocker.reset })
  }, [blocker, onHeld])
  return null
}

/**
 * Holds back the navigations that `shouldHold` says so of. A router can hold a navigation back only when
 * it is a data router (the app is: main.tsx); the plain router that most of the tests use cannot, and
 * there the guard is simply not there.
 */
export function LeaveGuard(props: GuardProps) {
  const router = useContext(UNSAFE_DataRouterContext)
  return router ? <Guard {...props} /> : null
}
