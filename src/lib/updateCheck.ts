// The check for a newer version, for the apps that are installed by hand (the APK and the Windows
// installer): it asks the list of the releases of the project, and takes from the answer nothing but the
// version numbers. The page of the releases that the person is sent to is the one written here.

const RELEASES_API = 'https://api.github.com/repos/dofer12/desshbord-costumer-/releases?per_page=30'
export const RELEASES_PAGE = 'https://github.com/dofer12/desshbord-costumer-/releases'

export type UpdateResult =
  /** A release with a higher version than this one is published. */
  | { kind: 'newer'; version: string }
  | { kind: 'same' }
  /** This version is higher than any that is published (a build that is not released yet). */
  | { kind: 'older' }
  /** The list has no release with a version in it. */
  | { kind: 'none' }
  | { kind: 'failed' }

const VERSION = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-[0-9A-Za-z.-]+)?$/

/** The three numbers of a version such as 1.2.3 or v1.2.3 (a pre-release suffix is left out), or null for anything else. */
export function parseVersion(text: string): [number, number, number] | null {
  const parts = VERSION.exec(text.trim())
  return parts === null ? null : [Number(parts[1]), Number(parts[2]), Number(parts[3])]
}

/** Negative when `a` is lower than `b`, zero when they are the same, positive when `a` is higher. */
export function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

/**
 * Whether a release that is newer than `current` is published. The releases are read from the list (a
 * pre-release counts: the first versions were published as such), drafts are left out, and only the
 * `tag_name` of each is read. A network that fails, an answer that is not a list, and a list with no version
 * in it are not guesses: they are `failed` and `none`.
 */
export async function checkForUpdate(current: string, fetcher: typeof fetch = fetch): Promise<UpdateResult> {
  const mine = parseVersion(current)
  let list: unknown
  try {
    const response = await fetcher(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } })
    if (!response.ok) return { kind: 'failed' }
    list = await response.json()
  } catch {
    return { kind: 'failed' }
  }
  if (!Array.isArray(list) || mine === null) return { kind: 'failed' }

  let latest: [number, number, number] | null = null
  for (const release of list) {
    if (typeof release !== 'object' || release === null) continue
    const { tag_name: tag, draft } = release as { tag_name?: unknown; draft?: unknown }
    if (draft === true || typeof tag !== 'string') continue
    const version = parseVersion(tag)
    if (version !== null && (latest === null || compareVersions(version, latest) > 0)) latest = version
  }
  if (latest === null) return { kind: 'none' }
  const apart = compareVersions(latest, mine)
  if (apart > 0) return { kind: 'newer', version: latest.join('.') }
  return apart === 0 ? { kind: 'same' } : { kind: 'older' }
}
