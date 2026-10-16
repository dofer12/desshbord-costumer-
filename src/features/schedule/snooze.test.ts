import { describe, expect, it } from 'vitest'
import { SNOOZE_MS } from './reminders'
import { createSnoozeStore, snoozeKey } from './snooze'

// The snoozes of a person are kept in the storage of the device, one list per person, so that a snooze
// survives closing the app and one person's snooze is not another's.

const NOW = Date.parse('2026-10-16T09:00:00Z')

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  }
}

const open = (storage: ReturnType<typeof memoryStorage>, userId = 'u-dana', now = NOW) => createSnoozeStore({ storage, userId, now: () => now })

describe('createSnoozeStore', () => {
  it('quiets a task for ten minutes from now, and remembers the due time it was snoozed for', () => {
    const store = open(memoryStorage())
    store.getState().snooze('a', '2026-10-16T09:10:00.000Z')
    expect(store.getState().snoozed).toEqual({ a: NOW + SNOOZE_MS })
    expect(store.getState().dueOf('a')).toBe('2026-10-16T09:10:00.000Z')
    expect(store.getState().dueOf('b')).toBeNull()
  })

  it('snoozing again counts from the moment of the second snooze', () => {
    const storage = memoryStorage()
    open(storage, 'u-dana', NOW).getState().snooze('a', null)
    const later = open(storage, 'u-dana', NOW + 4 * 60_000)
    later.getState().snooze('a', null)
    expect(later.getState().snoozed.a).toBe(NOW + 4 * 60_000 + SNOOZE_MS)
  })

  it('keeps the snooze in the storage of the device, under the person', () => {
    const storage = memoryStorage()
    open(storage).getState().snooze('a', '2026-10-16T09:10:00.000Z')
    expect(storage.data.has(snoozeKey('u-dana'))).toBe(true)
    expect(snoozeKey('u-dana')).toBe('moked.snooze.u-dana')

    const again = open(storage)
    expect(again.getState().snoozed).toEqual({ a: NOW + SNOOZE_MS })
    expect(again.getState().dueOf('a')).toBe('2026-10-16T09:10:00.000Z')
  })

  it('does not share a snooze between two people on the same device', () => {
    const storage = memoryStorage()
    open(storage, 'u-dana').getState().snooze('a', null)
    expect(open(storage, 'u-avi').getState().snoozed).toEqual({})
  })

  it('drops a snooze that is over when it reads, and when it is pruned', () => {
    const storage = memoryStorage()
    const first = open(storage, 'u-dana', NOW)
    first.getState().snooze('old', null)
    first.getState().snooze('later', null)
    // Eleven minutes on: the first two are over. A third is added then.
    const second = open(storage, 'u-dana', NOW + 11 * 60_000)
    expect(second.getState().snoozed).toEqual({})
    // Pruning at run time: the entry exists until its time has come, and goes after.
    let clock = NOW
    const live = createSnoozeStore({ storage: memoryStorage(), userId: 'u-dana', now: () => clock })
    live.getState().snooze('a', null)
    clock = NOW + SNOOZE_MS - 1
    live.getState().prune()
    expect(Object.keys(live.getState().snoozed)).toEqual(['a'])
    clock = NOW + SNOOZE_MS
    live.getState().prune()
    expect(live.getState().snoozed).toEqual({})
  })

  it('counts a snooze that ends at this very moment as over', () => {
    const storage = memoryStorage()
    open(storage, 'u-dana', NOW).getState().snooze('a', null)
    expect(open(storage, 'u-dana', NOW + SNOOZE_MS - 1).getState().snoozed).toEqual({ a: NOW + SNOOZE_MS })
    expect(open(storage, 'u-dana', NOW + SNOOZE_MS).getState().snoozed).toEqual({})
  })

  it('clears one snooze and keeps the others, also in the storage', () => {
    const storage = memoryStorage()
    const store = open(storage)
    store.getState().snooze('a', null)
    store.getState().snooze('b', null)
    store.getState().clear('a')
    expect(Object.keys(store.getState().snoozed)).toEqual(['b'])
    expect(Object.keys(JSON.parse(storage.data.get(snoozeKey('u-dana')) as string))).toEqual(['b'])
    // Clearing what is not there changes nothing and does not fail.
    store.getState().clear('nothing')
    expect(Object.keys(store.getState().snoozed)).toEqual(['b'])
  })

  it('starts empty from a storage that cannot be read, that holds nonsense, or that holds the wrong shapes', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => undefined,
    }
    expect(createSnoozeStore({ storage: throwing, userId: 'u', now: () => NOW }).getState().snoozed).toEqual({})
    expect(open(memoryStorage({ [snoozeKey('u-dana')]: 'not json' })).getState().snoozed).toEqual({})
    expect(open(memoryStorage({ [snoozeKey('u-dana')]: '[1,2]' })).getState().snoozed).toEqual({})
    expect(open(memoryStorage({ [snoozeKey('u-dana')]: 'null' })).getState().snoozed).toEqual({})
    const wrong = JSON.stringify({ a: { until: 'soon', due: null }, b: 'x', c: { until: NOW + 60_000, due: 5 }, d: { until: NOW + 60_000, due: null } })
    expect(open(memoryStorage({ [snoozeKey('u-dana')]: wrong })).getState().snoozed).toEqual({ d: NOW + 60_000 })
  })

  it('goes on working in memory when the storage cannot be written', () => {
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    }
    const store = createSnoozeStore({ storage: full, userId: 'u', now: () => NOW })
    expect(() => store.getState().snooze('a', null)).not.toThrow()
    expect(store.getState().snoozed).toEqual({ a: NOW + SNOOZE_MS })
    expect(() => store.getState().clear('a')).not.toThrow()
    expect(store.getState().snoozed).toEqual({})
  })

  it('works without any storage at all', () => {
    const store = createSnoozeStore({ storage: null, userId: 'u', now: () => NOW })
    store.getState().snooze('a', null)
    expect(store.getState().snoozed).toEqual({ a: NOW + SNOOZE_MS })
  })
})
