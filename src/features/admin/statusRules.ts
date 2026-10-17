import { hasControlCharacter } from '../auth/profileForm'
import type { Status } from '../tasks/gateways'
import type { NewStatus, StatusPatch } from './gateways'

/** The longest name of a status. */
export const MAX_STATUS_NAME = 40
/** What a status that was just added is called until its name is changed, and the colour that it starts with. */
export const NEW_STATUS_NAME = 'סטטוס חדש'
export const NEW_STATUS_COLOR = '#6b7280'

/** Six places of lower-case letters and digits. */
const KEY_SPACE = 36 ** 6

const COLOR_SHAPE = /^#[0-9a-f]{6}$/i

/**
 * The key of a new status: "custom-" and six lower-case letters or digits, made by the app and never by
 * the person, and never one that exists. When the random source gives a key that is taken, the next one is
 * tried, so that a source that says the same again and again still ends with a key that is free.
 */
export function newStatusKey(existing: string[], random: () => number = Math.random): string {
  const taken = new Set(existing)
  let n = Math.floor(random() * KEY_SPACE) % KEY_SPACE
  for (let tries = 0; tries < KEY_SPACE; tries++) {
    const key = `custom-${n.toString(36).padStart(6, '0')}`
    if (!taken.has(key)) return key
    n = (n + 1) % KEY_SPACE
  }
  throw new Error('There is no free key.')
}

/**
 * The name for a status that was just added: "סטטוס חדש", and when a status has that name (this one that
 * was not renamed yet, say) the first of "סטטוס חדש 2", "סטטוס חדש 3" and so on that no status has. Names
 * are compared as validateStatus compares them, so the one that is made always passes it.
 */
export function freeStatusName(statuses: Array<Pick<Status, 'name_he'>>): string {
  const taken = new Set(statuses.map((status) => status.name_he.trim().toLowerCase()))
  for (let n = 1; ; n++) {
    const name = n === 1 ? NEW_STATUS_NAME : `${NEW_STATUS_NAME} ${n}`
    if (!taken.has(name.toLowerCase())) return name
  }
}

/** The sentence under a status that is blocked and still held by open tasks, or null when none is. */
export function openTasksNote(count: number): string | null {
  if (count <= 0) return null
  return count === 1 ? 'יש משימה פתוחה אחת בסטטוס הזה. היא שומרת אותו.' : `יש ${count} משימות פתוחות בסטטוס הזה. הן שומרות אותו.`
}

/** The place after the last one, wherever the last one is in the list. */
export function nextStatusSort(statuses: Array<Pick<Status, 'sort'>>): number {
  return statuses.reduce((highest, status) => Math.max(highest, status.sort), 0) + 1
}

/** A colour as it is kept: in lower-case, with nothing around it. */
export function normalizeColor(color: string): string {
  return color.trim().toLowerCase()
}

/** The sentence for a colour that cannot be used, or null. Both #ABCDEF and #abcdef are colours. */
export function checkColor(color: string): string | null {
  return COLOR_SHAPE.test(color.trim()) ? null : 'הצבע צריך להיות בצורה #rrggbb.'
}

/** The sentence for a name that cannot be used, or null: not empty, not long, and not the name of another status. */
export function checkStatusName(name: string, others: Status[]): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'הזינו שם לסטטוס.'
  if (hasControlCharacter(trimmed)) return 'השם מכיל תו שאי אפשר להציג.'
  if ([...trimmed].length > MAX_STATUS_NAME) return `השם ארוך מדי: עד ${MAX_STATUS_NAME} תווים.`
  const lower = trimmed.toLowerCase()
  if (others.some((other) => other.name_he.trim().toLowerCase() === lower)) return 'יש כבר סטטוס בשם הזה.'
  return null
}

/**
 * The sentence for a status that cannot be saved, or null. `others` are the other statuses, the blocked ones
 * too, since a blocked status can be unblocked and its name is still its own.
 */
export function validateStatus(input: { name_he: string; color: string }, others: Status[]): string | null {
  return checkStatusName(input.name_he, others) ?? checkColor(input.color)
}

/**
 * The row of a new status as it is written. Its key and its place come from what there is (and from the keys
 * to avoid, which are the ones that the database refused), it is active, and nothing else is the caller's to say.
 */
export function newStatusRow(
  input: NewStatus,
  existing: Array<Pick<Status, 'key' | 'sort'>>,
  avoid: string[] = [],
  random?: () => number,
): Status {
  return {
    key: newStatusKey([...existing.map((status) => status.key), ...avoid], random),
    name_he: input.name_he.trim(),
    color: normalizeColor(input.color),
    sort: nextStatusSort(existing),
    is_active: true,
  }
}

/**
 * What is to be written of a patch: only the columns that can be changed and that were given, with the name
 * trimmed and the colour in lower-case. A patch with nothing in it is a mistake of the caller, not a request.
 */
export function cleanStatusPatch(patch: StatusPatch): StatusPatch {
  const clean: StatusPatch = {}
  if (patch.name_he !== undefined) clean.name_he = patch.name_he.trim()
  if (patch.color !== undefined) clean.color = normalizeColor(patch.color)
  if (patch.sort !== undefined) clean.sort = patch.sort
  if (patch.is_active !== undefined) clean.is_active = patch.is_active
  if (Object.keys(clean).length === 0) throw new Error('There is nothing to change.')
  return clean
}
