export interface CredentialErrors {
  email?: string
  password?: string
}

/** Phone keyboards capitalise and pad: "  Dana@Example.com " must still sign in. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** The longest address that there is. */
const MAX_EMAIL_LENGTH = 254

/**
 * The sentence for an address that cannot be used, or null. It is read as the sign-in reads it, trimmed and
 * whatever the case, so that the address an administrator types for a new employee is the one that signs in.
 */
export function checkEmail(email: string): string | null {
  const normalized = normalizeEmail(email)
  if (!normalized) return 'הזינו כתובת אימייל.'
  if (normalized.length > MAX_EMAIL_LENGTH || !EMAIL_SHAPE.test(normalized)) return 'כתובת האימייל אינה תקינה.'
  return null
}

export function validateCredentials(email: string, password: string): CredentialErrors {
  const errors: CredentialErrors = {}
  const problem = checkEmail(email)
  if (problem) errors.email = problem
  if (!password) errors.password = 'הזינו סיסמה.'
  return errors
}

/** The shortest password the server takes: the setting of the project. */
export const MIN_PASSWORD_LENGTH = 10
/** bcrypt keeps no more than 72 bytes of a password, and the server refuses a longer one. */
export const MAX_PASSWORD_BYTES = 72

export interface NewPasswordError {
  /** The field that is to blame, so that the message can be put next to it and the cursor sent there. */
  field: 'password' | 'confirm'
  message: string
}

const bytesOf = (text: string) => new TextEncoder().encode(text).length

/**
 * Whether a password that a person chose for themselves can be sent, with the second time they typed it.
 * Spaces count and nothing is trimmed, since a space can be part of a password. The length is counted in
 * characters as a person counts them (an emoji is one), and the upper limit in bytes, as the server does
 * (a Hebrew letter is two).
 */
export function checkNewPassword(password: string, confirm: string): NewPasswordError | null {
  if (!password) return { field: 'password', message: 'הזינו סיסמה חדשה.' }
  if ([...password].length < MIN_PASSWORD_LENGTH) {
    return { field: 'password', message: `הסיסמה קצרה מדי: לפחות ${MIN_PASSWORD_LENGTH} תווים.` }
  }
  if (bytesOf(password) > MAX_PASSWORD_BYTES) {
    return {
      field: 'password',
      message: `הסיסמה ארוכה מדי. בחרו סיסמה קצרה יותר (עד ${MAX_PASSWORD_BYTES} תווים באנגלית, וכ-${MAX_PASSWORD_BYTES / 2} באותיות עבריות).`,
    }
  }
  if (!confirm) return { field: 'confirm', message: 'הזינו את הסיסמה שוב כדי לאמת אותה.' }
  if (confirm !== password) return { field: 'confirm', message: 'שתי הסיסמאות אינן זהות.' }
  return null
}

/** The sentence for the person, or null when the password can be sent. */
export function validateNewPassword(password: string, confirm: string): string | null {
  return checkNewPassword(password, confirm)?.message ?? null
}
