import type { ProfileInput } from './types'

/** The same limits as the function of the administrators puts on a name. */
export const MAX_NAME_LENGTH = 60
/** A reminder of a day before at the most. */
export const MAX_REMIND_MIN = 1440

export interface ProfileFormErrors {
  name?: string
  remind?: string
}

export type ProfileFormResult = { ok: true; input: ProfileInput } | { ok: false; errors: ProfileFormErrors }

/** A tab, a line break and the other characters that a list or a log line could be spoiled by. */
export function hasControlCharacter(text: string): boolean {
  return [...text].some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
  })
}

/**
 * The sentence for a name that cannot be used, or null. The name is judged trimmed, as it is sent: a person's
 * own profile, a new employee and the rename of an administrator all hold the same lines.
 */
export function checkDisplayName(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'הזינו שם.'
  if (hasControlCharacter(trimmed)) return 'השם מכיל תו שאי אפשר להציג.'
  if ([...trimmed].length > MAX_NAME_LENGTH) return `השם ארוך מדי: עד ${MAX_NAME_LENGTH} תווים.`
  return null
}

/**
 * What the profile form holds, as it is to be sent: the name trimmed and the reminder as a whole number
 * of minutes. The two fields are judged together, so that a person is told about both at once.
 */
export function validateProfileForm(name: string, remind: string): ProfileFormResult {
  const errors: ProfileFormErrors = {}

  const nameProblem = checkDisplayName(name)
  if (nameProblem) errors.name = nameProblem

  // Digits and nothing else: no sign, no fraction, no exponent, and no digits of another alphabet.
  const minutes = remind.trim()
  if (!/^\d{1,4}$/.test(minutes) || Number(minutes) > MAX_REMIND_MIN) {
    errors.remind = `התזכורת היא מספר שלם של דקות, מ-0 עד ${MAX_REMIND_MIN}.`
  }

  if (errors.name !== undefined || errors.remind !== undefined) return { ok: false, errors }
  return { ok: true, input: { display_name: name.trim(), default_remind_min: Number(minutes) } }
}
