import type { Profile } from '../auth/types'
import type { Status } from '../tasks/gateways'

// How a file that comes from outside says "which status" and "who": a name that a person wrote, matched to
// the status or the person of the app. The aliases are the other names that the old app knew for its 17
// statuses, and what the order system calls them (wc-processing, on hold).
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  processing: ['processing'],
  pending: ['pending'],
  completed: ['completed', 'הושלם'],
  'on-hold': ['on-hold', 'on hold', 'מושהה'],
  cancelled: ['cancelled', 'בוטל'],
  refunded: ['refunded'],
  failed: ['failed', 'נכשל'],
  cargo: ['cargo'],
  bank: ['העברה בנקאית'],
  abroad: ['הזמנת חול', 'הזמנת חו״ל'],
}

/** The status that a task has when the file does not say, or says what nobody knows. */
export const DEFAULT_STATUS_KEY = 'processing'

export interface StatusMatch {
  key: string
  /** False when the label was only part of a name (or a name only part of the label), or was not found at all. */
  exact: boolean
}

/**
 * The status that a label of a file stands for. The label is lower-cased and a leading "wc-" is taken off.
 * Empty is "processing". Then an exact match with the Hebrew name, the key or an alias of a status; then
 * a match by containment (the label has the name in it, or the name has the label in it); else "processing",
 * not exact. The statuses are tried in the order of their places, so that a status that an administrator
 * added is matched by its own name like the others.
 */
export function matchStatus(label: string, statuses: Status[]): StatusMatch {
  const x = label.trim().toLowerCase().replace(/^wc-/, '')
  if (!x) return { key: DEFAULT_STATUS_KEY, exact: true }
  const ordered = [...statuses].sort((a, b) => a.sort - b.sort)
  const aliasesOf = (status: Status) => ALIASES[status.key] ?? []

  const exact = ordered.find((status) => status.name_he.toLowerCase() === x || status.key === x || aliasesOf(status).includes(x))
  if (exact) return { key: exact.key, exact: true }

  const part = ordered.find((status) => {
    const name = status.name_he.toLowerCase()
    return name.includes(x) || x.includes(name) || aliasesOf(status).some((alias) => x.includes(alias))
  })
  return { key: part ? part.key : DEFAULT_STATUS_KEY, exact: false }
}

/**
 * The person that a name of a file stands for, by their name in the app, whatever the case and the spaces
 * at the ends; or null. A name that two people have is nobody's: it would be a guess.
 */
export function matchPerson(name: string, profiles: Profile[]): string | null {
  const wanted = name.trim().toLowerCase()
  if (!wanted) return null
  const found = profiles.filter((profile) => profile.display_name.trim().toLowerCase() === wanted)
  return found.length === 1 ? found[0].id : null
}
