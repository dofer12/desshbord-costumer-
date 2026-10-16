import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AttachmentsGateway } from '../tasks/gateways'
import { createSignedUrlCache, signedUrlCacheFor } from './signedUrls'

const MINUTE = 60_000

/** A gateway that gives a new address at every call, so that a test can tell which one it got. */
function source(options: { fail?: unknown[] } = {}) {
  let counter = 0
  const failures = [...(options.fail ?? [])]
  return {
    signedUrl: vi.fn(async (path: string) => {
      if (failures.length > 0) throw failures.shift()
      return `https://files.example/${path}?n=${++counter}`
    }),
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-16T10:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the cache of signed addresses', () => {
  it('asks the server once for a path, and gives the same address to whoever asks again', async () => {
    const gateway = source()
    const cache = createSignedUrlCache(gateway)
    const first = await cache.get('t/1_t.jpg')
    const second = await cache.get('t/1_t.jpg')
    expect(first).toBe('https://files.example/t/1_t.jpg?n=1')
    expect(second).toBe(first)
    expect(gateway.signedUrl).toHaveBeenCalledTimes(1)
  })

  it('asks for each path on its own', async () => {
    const gateway = source()
    const cache = createSignedUrlCache(gateway)
    await cache.get('t/1.jpg')
    await cache.get('t/2.jpg')
    expect(gateway.signedUrl.mock.calls).toEqual([['t/1.jpg'], ['t/2.jpg']])
  })

  it('makes one request for callers who ask at the same moment', async () => {
    const gateway = source()
    const cache = createSignedUrlCache(gateway)
    const [a, b] = await Promise.all([cache.get('t/1.jpg'), cache.get('t/1.jpg')])
    expect(a).toBe(b)
    expect(gateway.signedUrl).toHaveBeenCalledTimes(1)
  })

  it('keeps an address for 55 minutes, which is less than the hour that it works for, and then asks again', async () => {
    const gateway = source()
    const cache = createSignedUrlCache(gateway)
    const first = await cache.get('t/1.jpg')

    vi.setSystemTime(Date.now() + 54 * MINUTE)
    expect(await cache.get('t/1.jpg')).toBe(first)
    expect(gateway.signedUrl).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + 2 * MINUTE)
    const later = await cache.get('t/1.jpg')
    expect(later).not.toBe(first)
    expect(gateway.signedUrl).toHaveBeenCalledTimes(2)
  })

  it('counts the 55 minutes from the moment the address was given, not from the last time it was used', async () => {
    const gateway = source()
    const cache = createSignedUrlCache(gateway)
    await cache.get('t/1.jpg')
    vi.setSystemTime(Date.now() + 40 * MINUTE)
    await cache.get('t/1.jpg')
    vi.setSystemTime(Date.now() + 20 * MINUTE)
    await cache.get('t/1.jpg')
    expect(gateway.signedUrl).toHaveBeenCalledTimes(2)
  })

  it('does not keep a failure: the next call asks again, and the callers who shared the failed request all hear of it', async () => {
    const failure = Object.assign(new Error('offline'), { status: 0 })
    const gateway = source({ fail: [failure] })
    const cache = createSignedUrlCache(gateway)

    const [one, two] = await Promise.allSettled([cache.get('t/1.jpg'), cache.get('t/1.jpg')])
    expect(one).toMatchObject({ status: 'rejected', reason: failure })
    expect(two).toMatchObject({ status: 'rejected', reason: failure })
    expect(gateway.signedUrl).toHaveBeenCalledTimes(1)

    expect(await cache.get('t/1.jpg')).toBe('https://files.example/t/1.jpg?n=1')
    expect(gateway.signedUrl).toHaveBeenCalledTimes(2)
  })

  it('does not keep an empty address either, since it shows nothing', async () => {
    const gateway = { signedUrl: vi.fn().mockResolvedValueOnce('').mockResolvedValue('https://files.example/ok') }
    const cache = createSignedUrlCache(gateway)
    await expect(cache.get('t/1.jpg')).rejects.toThrow()
    expect(cache.peek('t/1.jpg')).toBeUndefined()
    expect(await cache.get('t/1.jpg')).toBe('https://files.example/ok')
  })

  it('peek gives the address when it is in the memory and still good, and nothing otherwise', async () => {
    const cache = createSignedUrlCache(source())
    expect(cache.peek('t/1.jpg')).toBeUndefined()
    const url = await cache.get('t/1.jpg')
    expect(cache.peek('t/1.jpg')).toBe(url)
    vi.setSystemTime(Date.now() + 56 * MINUTE)
    expect(cache.peek('t/1.jpg')).toBeUndefined()
  })

  it('peek does not start a request', () => {
    const gateway = source()
    createSignedUrlCache(gateway).peek('t/1.jpg')
    expect(gateway.signedUrl).not.toHaveBeenCalled()
  })
})

describe('the cache of a gateway', () => {
  it('is one for each gateway: the same gateway shares it, another one does not', async () => {
    const one = source() as unknown as AttachmentsGateway
    const other = source() as unknown as AttachmentsGateway
    expect(signedUrlCacheFor(one)).toBe(signedUrlCacheFor(one))
    expect(signedUrlCacheFor(one)).not.toBe(signedUrlCacheFor(other))
  })
})
