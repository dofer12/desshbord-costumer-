/**
 * The storage of the device (the local storage of the browser), or null where there is none or the page
 * may not touch it: a browser that blocks site data throws at the mere mention of it.
 */
export function deviceStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}
