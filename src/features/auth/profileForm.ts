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
function hasControlCharacter(text: string): boolean {
  return [...text].some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
  })
}

/**
 * What the profile form holds, as it is to be sent: the name trimmed and the reminder as a whole number
 * of minutes. The two fields are judged together, so that a person is told about both at once.
 */
export function validateProfileForm(name: string, remind: string): ProfileFormResult {
  const errors: ProfileFormErrors = {}

  const trimmed = name.trim()
  if (trimmed === '') errors.name = 'הזינו שם.'
  else if (hasControlCharacter(trimmed)) errors.name = 'השם מכיל תו שאי אפשר להציג.'
  else if ([...trimmed].length > MAX_NAME_LENGTH) errors.name = `השם ארוך מדי: עד ${MAX_NAME_LENGTH} תווים.`

  // Digits and nothing else: no sign, no fraction, no exponent, and no digits of another alphabet.
  const minutes = remind.trim()
  if (!/^\d{1,4}$/.test(minutes) || Number(minutes) > MAX_REMIND_MIN) {
    errors.remind = `התזכורת היא מספר שלם של דקות, מ-0 עד ${MAX_REMIND_MIN}.`
  }

  if (errors.name !== undefined || errors.remind !== undefined) return { ok: false, errors }
  return { ok: true, input: { display_name: trimmed, default_remind_min: Number(minutes) } }
}
