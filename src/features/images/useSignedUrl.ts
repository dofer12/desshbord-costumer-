import { useEffect, useState } from 'react'
import { useAttachments } from '../tasks/tasksContext'
import { signedUrlCacheFor, type SignedUrlCache } from './signedUrls'

export interface SignedUrl {
  /** The address to show, once there is one. */
  url: string | null
  /** True when the server would not give it. */
  failed: boolean
}

const NOTHING: SignedUrl = { url: null, failed: false }

/** The address of a picture in the private bucket. The addresses are kept for a while, and shared by every picture on the screen. */
export function useSignedUrl(path: string | null): SignedUrl {
  const cache = signedUrlCacheFor(useAttachments())
  const [answer, setAnswer] = useState<{ cache: SignedUrlCache; path: string; url: string | null } | null>(null)

  useEffect(() => {
    if (path === null || cache.peek(path) !== undefined) return
    let current = true
    cache.get(path).then(
      (url) => {
        if (current) setAnswer({ cache, path, url })
      },
      () => {
        if (current) setAnswer({ cache, path, url: null })
      },
    )
    return () => {
      current = false
    }
  }, [cache, path])

  if (path === null) return NOTHING
  const mine = answer && answer.cache === cache && answer.path === path ? answer : null
  // The address that was given stays, even if the memory has let go of it since: a picture that is
  // on the screen must not lose its source because the page was drawn again.
  const url = mine?.url ?? cache.peek(path) ?? null
  return { url, failed: url === null && mine !== null }
}
