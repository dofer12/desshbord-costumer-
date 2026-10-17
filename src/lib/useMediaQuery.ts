import { useCallback, useSyncExternalStore } from 'react'

/** A screen that is wide enough for a table: a laptop. On anything narrower the tasks are cards. */
export const WIDE_SCREEN_QUERY = '(min-width: 900px)'

/** The calendar shows a week at this width or more, three days at the next, and a day below it. */
export const CALENDAR_WEEK_QUERY = '(min-width: 1000px)'
export const CALENDAR_THREE_DAYS_QUERY = '(min-width: 640px)'

/**
 * Whether the media query matches now, and again whenever it changes. Where the browser cannot
 * tell (an old WebView, a test without a stub) it does not match.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const list = window.matchMedia?.(query)
      list?.addEventListener('change', notify)
      return () => list?.removeEventListener('change', notify)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  )
}
