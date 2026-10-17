import { useEffect } from 'react'

/**
 * Asks the browser to ask before the page is closed or loaded again, for as long as `when` holds. Not in
 * the Windows app: a window that has a handler of this kind cannot be closed by Electron, nor the app left,
 * until somebody answers a question that the app never shows.
 */
export function useUnloadWarning(when: boolean) {
  useEffect(() => {
    if (!when || window.mokedDesktop !== undefined) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Some browsers ask only when the old property is set as well.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [when])
}
