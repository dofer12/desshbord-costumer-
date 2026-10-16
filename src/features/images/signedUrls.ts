import type { AttachmentsGateway } from '../tasks/gateways'

/**
 * How long an address is kept. It works for an hour; a little less is kept, so that an address that
 * is handed out late still works for the person who gets it.
 */
export const SIGNED_URL_KEPT_MS = 55 * 60_000

export interface SignedUrlCache {
  /** The address of a file: from the memory while it is good, otherwise from the server. A failure is not kept. */
  get(path: string): Promise<string>
  /** The address if it is in the memory and still good. Never asks the server. */
  peek(path: string): string | undefined
}

export function createSignedUrlCache(source: Pick<AttachmentsGateway, 'signedUrl'>): SignedUrlCache {
  const kept = new Map<string, { url: string; until: number }>()
  const asked = new Map<string, Promise<string>>()

  function peek(path: string): string | undefined {
    const entry = kept.get(path)
    if (!entry) return undefined
    if (Date.now() >= entry.until) {
      kept.delete(path)
      return undefined
    }
    return entry.url
  }

  return {
    peek,
    get(path) {
      const good = peek(path)
      if (good !== undefined) return Promise.resolve(good)
      const pending = asked.get(path)
      if (pending) return pending

      const request = source.signedUrl(path).then(
        (url) => {
          asked.delete(path)
          // An empty address shows nothing: it is a failure, and is not kept.
          if (!url) throw new Error('The server gave no address for the file')
          kept.set(path, { url, until: Date.now() + SIGNED_URL_KEPT_MS })
          return url
        },
        (error: unknown) => {
          asked.delete(path)
          throw error
        },
      )
      asked.set(path, request)
      return request
    },
  }
}

const caches = new WeakMap<AttachmentsGateway, SignedUrlCache>()

/** The cache of a gateway: every picture on the screen shares it. */
export function signedUrlCacheFor(gateway: AttachmentsGateway): SignedUrlCache {
  let cache = caches.get(gateway)
  if (!cache) {
    cache = createSignedUrlCache(gateway)
    caches.set(gateway, cache)
  }
  return cache
}
