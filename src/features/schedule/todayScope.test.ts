import { describe, expect, it } from 'vitest'
import { readScope, saveScope, scopeKey } from './todayScope'

// The Today screen shows either my tasks or everybody's. The choice is kept on the device, one per
// person, so that it is the same the next time the app is opened and one person's choice is not another's.

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  }
}

describe('the scope of the Today screen', () => {
  it('is my tasks until somebody chooses otherwise', () => {
    expect(readScope(memoryStorage(), 'u-dana')).toBe('mine')
  })

  it('remembers the choice, under the person, on the device', () => {
    const storage = memoryStorage()
    saveScope(storage, 'u-dana', 'all')
    expect(storage.data.get(scopeKey('u-dana'))).toBe('all')
    expect(scopeKey('u-dana')).toBe('moked.today-scope.u-dana')
    expect(readScope(storage, 'u-dana')).toBe('all')
    saveScope(storage, 'u-dana', 'mine')
    expect(readScope(storage, 'u-dana')).toBe('mine')
  })

  it('does not share the choice between two people on the same device', () => {
    const storage = memoryStorage()
    saveScope(storage, 'u-dana', 'all')
    expect(readScope(storage, 'u-avi')).toBe('mine')
  })

  it('reads anything but "all" as my tasks', () => {
    expect(readScope(memoryStorage({ [scopeKey('u-dana')]: 'banana' }), 'u-dana')).toBe('mine')
    expect(readScope(memoryStorage({ [scopeKey('u-dana')]: '' }), 'u-dana')).toBe('mine')
    expect(readScope(memoryStorage({ [scopeKey('u-dana')]: 'ALL' }), 'u-dana')).toBe('mine')
  })

  it('goes on when the storage cannot be read or written', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(readScope(blocked, 'u-dana')).toBe('mine')
    expect(() => saveScope(blocked, 'u-dana', 'all')).not.toThrow()
  })

  it('works without any storage at all', () => {
    expect(readScope(null, 'u-dana')).toBe('mine')
    expect(() => saveScope(null, 'u-dana', 'all')).not.toThrow()
  })
})
