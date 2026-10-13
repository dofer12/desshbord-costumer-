import { describe, expect, it } from 'vitest'
import { normalizeEmail, validateCredentials } from './credentials'

describe('normalizeEmail', () => {
  it('trims and lowercases what phone keyboards capitalise and pad', () => {
    expect(normalizeEmail('  Dana@Example.COM \n')).toBe('dana@example.com')
  })
})

describe('validateCredentials', () => {
  it('accepts a plausible email and any non-empty password', () => {
    expect(validateCredentials('dana@example.com', 'x')).toEqual({})
  })

  it('accepts an email that only becomes valid after normalising', () => {
    expect(validateCredentials('  Dana@Example.com ', 'secret')).toEqual({})
  })

  it('asks for a missing email and a missing password separately', () => {
    expect(validateCredentials('', '')).toEqual({
      email: 'הזינו כתובת אימייל.',
      password: 'הזינו סיסמה.',
    })
  })

  it('rejects text that is not shaped like an email', () => {
    expect(validateCredentials('dana', 'secret').email).toBe('כתובת האימייל אינה תקינה.')
    expect(validateCredentials('dana@', 'secret').email).toBe('כתובת האימייל אינה תקינה.')
    expect(validateCredentials('dana@example', 'secret').email).toBe('כתובת האימייל אינה תקינה.')
  })

  it('does not trim the password, because spaces can be part of it', () => {
    expect(validateCredentials('dana@example.com', '   ')).toEqual({})
  })
})
