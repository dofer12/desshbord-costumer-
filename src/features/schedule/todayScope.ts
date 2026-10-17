// Whose tasks the Today screen shows: the signed-in person's own, or everybody's. The choice is kept
// on the device, one per person, so that it is the same the next time the app opens and one person's
// choice is not another's.

export type Scope = 'mine' | 'all'

export const scopeKey = (userId: string) => `moked.today-scope.${userId}`

/** The choice that was made on this device, or "mine" when there is none, or the storage cannot be read. */
export function readScope(storage: Pick<Storage, 'getItem'> | null, userId: string): Scope {
  try {
    return storage?.getItem(scopeKey(userId)) === 'all' ? 'all' : 'mine'
  } catch {
    return 'mine'
  }
}

export function saveScope(storage: Pick<Storage, 'setItem'> | null, userId: string, scope: Scope): void {
  try {
    storage?.setItem(scopeKey(userId), scope)
  } catch {
    // A storage that is full or blocked: the choice holds for as long as the screen is open.
  }
}
