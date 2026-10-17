import { describe, expect, it } from 'vitest'
import { ADMIN_MESSAGES, adminMessage, type UserFailureCode } from './gateways'

// What an administrator is told when something goes wrong with the people of the team. Every outcome
// has a sentence, in Hebrew, in words that say what happened and, when there is something to do, what.

const CODES = Object.keys(ADMIN_MESSAGES) as UserFailureCode[]

describe('the messages of the admin gateway', () => {
  it('has a sentence for every code that a request can fail with', () => {
    expect([...CODES].sort()).toEqual(
      ['email_taken', 'failed', 'forbidden', 'invalid', 'last_admin', 'name_taken', 'network', 'not_deployed', 'not_found', 'unauthenticated'].sort(),
    )
  })

  it.each(CODES)('says "%s" in Hebrew, in a sentence that ends with a full stop', (code) => {
    const message = ADMIN_MESSAGES[code]
    expect(message).toMatch(/[֐-׿]/)
    expect(message.trim()).toBe(message)
    expect(message).toMatch(/[.:]$/)
    expect(message.length).toBeGreaterThan(15)
  })

  it('does not say the same thing for two codes', () => {
    expect(new Set(CODES.map((code) => ADMIN_MESSAGES[code])).size).toBe(CODES.length)
  })

  it('tells what to do when the last administrator cannot be blocked, and when the function is not there', () => {
    expect(ADMIN_MESSAGES.last_admin).toMatch(/מנהל/)
    expect(ADMIN_MESSAGES.last_admin).toMatch(/קודם|הגדירו/)
    expect(ADMIN_MESSAGES.not_deployed).toMatch(/מדריך/)
    expect(ADMIN_MESSAGES.not_deployed).toMatch(/שלב 8/)
    expect(ADMIN_MESSAGES.network).toMatch(/אינטרנט/)
    expect(ADMIN_MESSAGES.unauthenticated).toMatch(/התחברו/)
  })

  it('uses the plural form of the imperative, for everybody', () => {
    // The masculine singular ("נסה", "בחר", "בדוק", "התחבר") is not used.
    for (const code of CODES) expect(ADMIN_MESSAGES[code]).not.toMatch(/(^|\s)(נסה|בחר|בדוק|התחבר|פעל|הגדר|רענן)(\s|[.,:]|$)/)
  })

  it('has no raw error text, no code, and no word that could hold a password', () => {
    for (const code of CODES) {
      const message = ADMIN_MESSAGES[code]
      expect(message).not.toMatch(/[a-z]{4,}/i)
      expect(message).not.toMatch(/\d{4,}/)
      expect(message).not.toMatch(/password|סיסמה זמנית/i)
    }
  })
})

describe('adminMessage', () => {
  it('is the sentence of the code', () => {
    for (const code of CODES.filter((c) => c !== 'invalid')) expect(adminMessage({ ok: false, code })).toBe(ADMIN_MESSAGES[code])
  })

  it('says what is wrong when the function names the field that is', () => {
    const generic = adminMessage({ ok: false, code: 'invalid' })
    const email = adminMessage({ ok: false, code: 'invalid', field: 'email' })
    const name = adminMessage({ ok: false, code: 'invalid', field: 'display_name' })
    const self = adminMessage({ ok: false, code: 'invalid', field: 'user_id' })
    expect(new Set([generic, email, name, self]).size).toBe(4)
    expect(email).toMatch(/אימייל/)
    expect(name).toMatch(/שם/)
    expect(self).toMatch(/עצמכם|הפרופיל/)
  })

  it('falls back to the sentence of the code for a field that it does not know, and never repeats what was sent', () => {
    expect(adminMessage({ ok: false, code: 'invalid', field: 'sb_secret_abc <script>' })).toBe(ADMIN_MESSAGES.invalid)
    expect(adminMessage({ ok: false, code: 'failed', field: 'connection to 10.0.0.5 refused' })).toBe(ADMIN_MESSAGES.failed)
  })

  it('does not take a name of the object itself for a field that it knows', () => {
    for (const field of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(adminMessage({ ok: false, code: 'invalid', field })).toBe(ADMIN_MESSAGES.invalid)
    }
  })

  it('says what a taken name and a taken e-mail are, each with its own words', () => {
    expect(adminMessage({ ok: false, code: 'name_taken', field: 'display_name' })).toMatch(/שם/)
    expect(adminMessage({ ok: false, code: 'email_taken', field: 'email' })).toMatch(/אימייל/)
  })
})
