export interface CredentialErrors {
  email?: string
  password?: string
}

/** Phone keyboards capitalise and pad: "  Dana@Example.com " must still sign in. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateCredentials(email: string, password: string): CredentialErrors {
  const errors: CredentialErrors = {}
  const normalized = normalizeEmail(email)
  if (!normalized) errors.email = 'הזינו כתובת אימייל.'
  else if (!EMAIL_SHAPE.test(normalized)) errors.email = 'כתובת האימייל אינה תקינה.'
  if (!password) errors.password = 'הזינו סיסמה.'
  return errors
}
