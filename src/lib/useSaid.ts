import { useCallback, useEffect, useRef, useState } from 'react'

/** How long a line stays in a status region. */
const SAID_MS = 6_000

/**
 * A line for a status region: said at once, and taken away after a few seconds. A new line replaces
 * the old one, and the time is counted again from it.
 */
export function useSaid(ms = SAID_MS): [string | null, (line: string) => void] {
  const [said, setSaid] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const say = useCallback(
    (line: string) => {
      setSaid(line)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setSaid(null), ms)
    },
    [ms],
  )

  return [said, say]
}
