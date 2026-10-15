import { useEffect, useState } from 'react'

/** The time of now, brought up to date every minute, so that "late" and "tomorrow" stay true on a screen that is left open. */
export function useNow(everyMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), everyMs)
    return () => clearInterval(timer)
  }, [everyMs])
  return now
}
