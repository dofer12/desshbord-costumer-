import { describe, expect, it } from 'vitest'
import { checkEmail, checkNewPassword, normalizeEmail, validateCredentials, validateNewPassword } from './credentials'

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

// An address that an administrator types for a new employee is judged as the sign-in judges it.
describe('checkEmail', () => {
  it('accepts a plausible address, with its case and its padding', () => {
    expect(checkEmail('dana@example.com')).toBeNull()
    expect(checkEmail('  Dana@Example.COM ')).toBeNull()
  })

  it('asks for an address when there is none', () => {
    expect(checkEmail('')).toBe('הזינו כתובת אימייל.')
    expect(checkEmail('   ')).toBe('הזינו כתובת אימייל.')
  })

  it.each(['dana', 'dana@', 'dana@example', '@example.com', 'da na@example.com', 'a@b@c.com'])('refuses %j, which is not shaped like an address', (text) => {
    expect(checkEmail(text)).toBe('כתובת האימייל אינה תקינה.')
  })

  it('refuses an address of more than 254 characters, which is the longest that there is', () => {
    const local = 'a'.repeat(64)
    expect(checkEmail(`${local}@${'b'.repeat(180)}.com`)).toBeNull()
    expect(checkEmail(`${local}@${'b'.repeat(190)}.com`)).toBe('כתובת האימייל אינה תקינה.')
    // Exactly 254 is the longest that there is, and 255 is one too many.
    expect(checkEmail(`${local}@${'b'.repeat(185)}.com`)).toBeNull()
    expect(checkEmail(`${local}@${'b'.repeat(186)}.com`)).toBe('כתובת האימייל אינה תקינה.')
  })

  it('is what the sign-in says about the address', () => {
    for (const text of ['', 'dana', 'dana@example.com']) expect(validateCredentials(text, 'x').email ?? null).toBe(checkEmail(text))
  })
})

// The password that a person chooses for themselves: on the first sign-in, and later from their profile.
// The server's own setting is ten characters at least, and it refuses what bcrypt cannot keep (72 bytes).
describe('validateNewPassword', () => {
  const MISSING = 'הזינו סיסמה חדשה.'
  const SHORT = 'הסיסמה קצרה מדי: לפחות 10 תווים.'
  const MISMATCH = 'שתי הסיסמאות אינן זהות.'
  const ten = 'abcdefghij'

  it('refuses nine characters and accepts ten', () => {
    expect(validateNewPassword('abcdefghi', 'abcdefghi')).toBe(SHORT)
    expect(validateNewPassword(ten, ten)).toBeNull()
  })

  it('asks for a password when there is none, whatever the confirmation says', () => {
    expect(validateNewPassword('', '')).toBe(MISSING)
    expect(validateNewPassword('', ten)).toBe(MISSING)
  })

  it('refuses a confirmation that is different, or that is missing', () => {
    expect(validateNewPassword(ten, 'abcdefghik')).toBe(MISMATCH)
    expect(validateNewPassword(ten, ten.toUpperCase())).toBe(MISMATCH)
    expect(validateNewPassword(ten, '')).toBe('הזינו את הסיסמה שוב כדי לאמת אותה.')
  })

  it('judges the password before the confirmation', () => {
    expect(validateNewPassword('short', 'different')).toBe(SHORT)
  })

  it('counts spaces as characters and does not trim them', () => {
    expect(validateNewPassword(' '.repeat(10), ' '.repeat(10))).toBeNull()
    expect(validateNewPassword('abcdefghi ', 'abcdefghi ')).toBeNull()
    expect(validateNewPassword(' abcdefghi', ' abcdefghi')).toBeNull()
    // A space at one end is a difference, not a thing to ignore.
    expect(validateNewPassword(`${ten} `, ten)).toBe(MISMATCH)
    expect(validateNewPassword(ten, ` ${ten}`)).toBe(MISMATCH)
    // Seven characters are too short, spaces or not.
    expect(validateNewPassword('  abc  ', '  abc  ')).toBe(SHORT)
  })

  it('counts a character as a person does: an emoji is one, so nine of them are too few', () => {
    const nine = '😀'.repeat(9)
    expect(validateNewPassword(nine, nine)).toBe(SHORT)
    expect(validateNewPassword('😀'.repeat(10), '😀'.repeat(10))).toBeNull()
  })

  it('counts letters of any alphabet', () => {
    expect(validateNewPassword('אבגדהוזחט', 'אבגדהוזחט')).toBe(SHORT)
    expect(validateNewPassword('אבגדהוזחטי', 'אבגדהוזחטי')).toBeNull()
  })

  it('refuses what the server would refuse as too long: more than 72 bytes, where a Hebrew letter is two', () => {
    const LONG = 'הסיסמה ארוכה מדי. בחרו סיסמה קצרה יותר (עד 72 תווים באנגלית, וכ-36 באותיות עבריות).'
    expect(validateNewPassword('a'.repeat(72), 'a'.repeat(72))).toBeNull()
    expect(validateNewPassword('a'.repeat(73), 'a'.repeat(73))).toBe(LONG)
    expect(validateNewPassword('א'.repeat(36), 'א'.repeat(36))).toBeNull()
    expect(validateNewPassword('א'.repeat(37), 'א'.repeat(37))).toBe(LONG)
  })

  it('speaks to everybody, in the plural', () => {
    for (const message of [
      validateNewPassword('', ''),
      validateNewPassword('abc', 'abc'),
      validateNewPassword('a'.repeat(100), 'a'.repeat(100)),
      validateNewPassword(ten, ''),
      validateNewPassword(ten, 'x'),
    ]) {
      expect(message).toMatch(/[.]$/)
      expect(message).not.toMatch(/(^|\s)(הזן|בחר|קצר|נסה)(\s|[.,:]|$)/)
    }
  })
})

describe('checkNewPassword', () => {
  const ten = 'abcdefghij'

  it('says nothing when the password can be used', () => {
    expect(checkNewPassword(ten, ten)).toBeNull()
  })

  it('puts the blame on the password when it is missing, short or long', () => {
    expect(checkNewPassword('', '')?.field).toBe('password')
    expect(checkNewPassword('abc', 'abc')?.field).toBe('password')
    expect(checkNewPassword('a'.repeat(73), 'a'.repeat(73))?.field).toBe('password')
  })

  it('puts the blame on the confirmation when it is missing or different', () => {
    expect(checkNewPassword(ten, '')?.field).toBe('confirm')
    expect(checkNewPassword(ten, `${ten}x`)?.field).toBe('confirm')
  })

  it('has the same sentence as validateNewPassword', () => {
    for (const [password, confirm] of [['', ''], ['abc', 'abc'], [ten, ''], [ten, 'x'], [ten, ten]] as const) {
      expect(checkNewPassword(password, confirm)?.message ?? null).toBe(validateNewPassword(password, confirm))
    }
  })
})
