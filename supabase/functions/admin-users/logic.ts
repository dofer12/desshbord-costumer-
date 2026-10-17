// The rules of the Edge Function admin-users. There is no API of any platform in this file: what comes in
// is a token and a body, what the world offers is `AdminDeps`, and what goes out is a value. The
// function (handler.ts and index.ts) only turns a request into these arguments and the result into a
// response, so every rule here is tested against pretend services and, in adminUsers.db.test.ts,
// against the real SQL.
//
// The secret key of the project lives in the services that index.ts gives to this module, never here.

export type Role = 'admin' | 'employee'

/** The columns of a profile that an administrator sees (the same as the Profile of the app). */
export interface ProfileRow {
  id: string
  email: string
  display_name: string
  role: Role
  is_active: boolean
  must_change_password: boolean
  default_remind_min: number
}

export type AdminRequest =
  | { action: 'create'; email: string; display_name: string; role: Role }
  | { action: 'reset_password'; user_id: string }
  | { action: 'set_active'; user_id: string; is_active: boolean }
  | { action: 'set_role'; user_id: string; role: Role }
  | { action: 'rename'; user_id: string; display_name: string }

export type AdminErrorCode = 'unauthenticated' | 'forbidden' | 'invalid' | 'email_taken' | 'name_taken' | 'not_found' | 'last_admin' | 'failed'

/** `temp_password` comes only with `create` and `reset_password`, once. */
export type AdminResult = { ok: true; user: ProfileRow; temp_password?: string } | { ok: false; code: AdminErrorCode; field?: string }

type ProfilePatch = Partial<Pick<ProfileRow, 'role' | 'is_active' | 'display_name' | 'must_change_password'>>
type UpdateError = 'name_taken' | 'last_admin' | 'not_found' | 'failed'

/** What the function needs of the world. The real ones are made in index.ts, the pretend ones in the tests. */
export interface AdminDeps {
  /** Who a token belongs to, or null. The token is the one that came with the request. */
  identify(token: string): Promise<string | null>
  profile(id: string): Promise<ProfileRow | null>
  /** The profile with this display name, whatever the case of the letters. */
  profileByName(name: string): Promise<ProfileRow | null>
  /** The profile with this e-mail, whatever the case of the letters. */
  profileByEmail(email: string): Promise<ProfileRow | null>
  authCreate(input: { email: string; password: string; role: Role; display_name: string }): Promise<{ id: string } | { error: 'email_taken' | 'failed' }>
  authSetPassword(id: string, password: string): Promise<boolean>
  authBan(id: string, banned: boolean): Promise<boolean>
  authDelete(id: string): Promise<void>
  revokeSessions(id: string): Promise<boolean>
  /** A change of a profile. The rules of the database answer: the last administrator stays, a name is not used twice. */
  updateProfile(id: string, patch: ProfilePatch): Promise<ProfileRow | { error: UpdateError }>
  randomBytes(n: number): Uint8Array
  /** One line for each request: who, what, to whom, and how it ended. Never a password or a token. */
  log(line: Record<string, unknown>): void
}

// ---------------------------------------------------------------------------------------------------
// The temporary password

export const TEMP_PASSWORD_LENGTH = 16
/**
 * Letters of both cases and digits, without the ones that look like each other (I l O o 0 1): 56
 * characters, so that a byte can be turned into one of them without favouring any (see below).
 */
export const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
/** The biggest multiple of the length of the alphabet that fits in a byte. A byte at or above it is skipped, because the remainders below it would come up more often than the others. */
const BYTE_LIMIT = 224
const BYTES_PER_ROUND = 32
const MAX_ROUNDS = 8

/** A password made from `randomBytes`, by rejection sampling. Throws when nothing usable comes after a number of rounds. */
export function makeTempPassword(randomBytes: (n: number) => Uint8Array): string {
  let password = ''
  for (let round = 0; round < MAX_ROUNDS && password.length < TEMP_PASSWORD_LENGTH; round++) {
    for (const byte of randomBytes(BYTES_PER_ROUND)) {
      if (byte >= BYTE_LIMIT) continue
      password += TEMP_PASSWORD_ALPHABET[byte % TEMP_PASSWORD_ALPHABET.length]
      if (password.length === TEMP_PASSWORD_LENGTH) break
    }
  }
  if (password.length < TEMP_PASSWORD_LENGTH) throw new Error('No usable random bytes.')
  return password
}

// ---------------------------------------------------------------------------------------------------
// What a request must look like

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/
const EMAIL = /^[^\s@]+@[^\s@]+$/
const MAX_EMAIL = 254
const MAX_NAME = 60
const ACTIONS = ['create', 'reset_password', 'set_active', 'set_role', 'rename'] as const

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isRole = (value: unknown): value is Role => value === 'admin' || value === 'employee'

/** A name: trimmed, not empty, not long, with nothing in it that a line of a log or a list could be spoiled by. */
function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  const length = [...name].length
  return length >= 1 && length <= MAX_NAME && !CONTROL.test(name) ? name : null
}

function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.length <= MAX_EMAIL && EMAIL.test(email) && !CONTROL.test(email) ? email : null
}

/** What the rules are told that is not in the request itself. */
export interface AdminOptions {
  /**
   * What a user id may look like. The function takes UUIDs only, as the database does, and that is
   * the default; the pretend server of the demo and of the tests has ids of other shapes.
   */
  isUserId?(value: string): boolean
}

function cleanUserId(value: unknown, options: AdminOptions): string | null {
  if (typeof value !== 'string') return null
  if (options.isUserId) return options.isUserId(value) ? value : null
  const id = value.toLowerCase()
  return UUID.test(id) ? id : null
}

/** The request that a body asks for, or the field that is wrong. Fields that are not known are left out. */
export function parseAdminRequest(body: unknown, options: AdminOptions = {}): AdminRequest | { invalid: string } {
  if (!isObject(body)) return { invalid: 'body' }
  const action = body.action
  if (typeof action !== 'string' || !(ACTIONS as readonly string[]).includes(action)) return { invalid: 'action' }

  if (action === 'create') {
    const email = cleanEmail(body.email)
    if (email === null) return { invalid: 'email' }
    const display_name = cleanName(body.display_name)
    if (display_name === null) return { invalid: 'display_name' }
    if (!isRole(body.role)) return { invalid: 'role' }
    return { action, email, display_name, role: body.role }
  }

  const user_id = cleanUserId(body.user_id, options)
  if (user_id === null) return { invalid: 'user_id' }
  switch (action) {
    case 'reset_password':
      return { action, user_id }
    case 'set_active':
      return typeof body.is_active === 'boolean' ? { action, user_id, is_active: body.is_active } : { invalid: 'is_active' }
    case 'set_role':
      return isRole(body.role) ? { action, user_id, role: body.role } : { invalid: 'role' }
    default: {
      const display_name = cleanName(body.display_name)
      return display_name === null ? { invalid: 'display_name' } : { action: 'rename', user_id, display_name }
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// The rules

const refuse = (code: AdminErrorCode, field?: string): AdminResult => (field === undefined ? { ok: false, code } : { ok: false, code, field })

const fromUpdateError = (error: UpdateError): AdminResult => {
  if (error === 'last_admin') return refuse('last_admin')
  if (error === 'name_taken') return refuse('name_taken', 'display_name')
  if (error === 'not_found') return refuse('not_found')
  return refuse('failed')
}

/** What is safe to write in a log of a request that came from an administrator: a known action, and an id. Nothing else of what was typed. */
function whatWasAsked(body: unknown, options: AdminOptions): { action?: string; target?: string } {
  if (!isObject(body)) return {}
  const action = typeof body.action === 'string' && (ACTIONS as readonly string[]).includes(body.action) ? body.action : undefined
  const target = cleanUserId(body.user_id, options) ?? undefined
  return { ...(action ? { action } : {}), ...(target ? { target } : {}) }
}

async function create(deps: AdminDeps, request: Extract<AdminRequest, { action: 'create' }>): Promise<AdminResult> {
  // Both are asked before anything is made, so that a refusal leaves nothing behind.
  if (await deps.profileByEmail(request.email)) return refuse('email_taken', 'email')
  if (await deps.profileByName(request.display_name)) return refuse('name_taken', 'display_name')

  const password = makeTempPassword(deps.randomBytes)
  const made = await deps.authCreate({ email: request.email, password, role: request.role, display_name: request.display_name })
  if ('error' in made) return made.error === 'email_taken' ? refuse('email_taken', 'email') : refuse('failed')

  try {
    let user = await deps.profile(made.id)
    if (!user) {
      await deps.authDelete(made.id)
      return refuse('failed')
    }
    if (!user.must_change_password) {
      const fixed = await deps.updateProfile(made.id, { must_change_password: true })
      if ('error' in fixed) {
        await deps.authDelete(made.id)
        return refuse('failed')
      }
      user = fixed
    }
    return { ok: true, user, temp_password: password }
  } catch (error) {
    // The user was made and something broke after that: no user is left without the profile that a person can work from.
    await deps.authDelete(made.id).catch(() => undefined)
    throw error
  }
}

async function resetPassword(deps: AdminDeps, caller: string, request: Extract<AdminRequest, { action: 'reset_password' }>): Promise<AdminResult> {
  // An administrator who resets their own password would lock themselves out of the screen that shows it: the profile page is for that.
  if (request.user_id === caller) return refuse('invalid', 'user_id')
  const target = await deps.profile(request.user_id)
  if (!target) return refuse('not_found')

  const password = makeTempPassword(deps.randomBytes)
  if (!(await deps.authSetPassword(target.id, password))) return refuse('failed')
  const updated = await deps.updateProfile(target.id, { must_change_password: true })
  if ('error' in updated) return fromUpdateError(updated.error)
  if (!(await deps.revokeSessions(target.id))) return refuse('failed')
  return { ok: true, user: updated, temp_password: password }
}

async function setActive(deps: AdminDeps, caller: string, request: Extract<AdminRequest, { action: 'set_active' }>): Promise<AdminResult> {
  // A blocked sole administrator has no way back: the app sends no e-mail.
  if (!request.is_active && request.user_id === caller) return refuse('invalid', 'user_id')
  const target = await deps.profile(request.user_id)
  if (!target) return refuse('not_found')

  if (request.is_active) {
    // The sign-in first: if the profile were switched on and the sign-in could not be, the person would find a closed door while the screen says they are active.
    if (!(await deps.authBan(target.id, false))) return refuse('failed')
    const updated = await deps.updateProfile(target.id, { is_active: true })
    return 'error' in updated ? fromUpdateError(updated.error) : { ok: true, user: updated }
  }
  // The profile first: the policies of the database stop the person at that very moment. The sign-in and the sessions follow; a failure there is safe to repeat.
  const updated = await deps.updateProfile(target.id, { is_active: false })
  if ('error' in updated) return fromUpdateError(updated.error)
  if (!(await deps.authBan(target.id, true))) return refuse('failed')
  if (!(await deps.revokeSessions(target.id))) return refuse('failed')
  return { ok: true, user: updated }
}

async function setRole(deps: AdminDeps, request: Extract<AdminRequest, { action: 'set_role' }>): Promise<AdminResult> {
  const target = await deps.profile(request.user_id)
  if (!target) return refuse('not_found')
  if (target.role === request.role) return { ok: true, user: target }
  const updated = await deps.updateProfile(target.id, { role: request.role })
  return 'error' in updated ? fromUpdateError(updated.error) : { ok: true, user: updated }
}

async function rename(deps: AdminDeps, request: Extract<AdminRequest, { action: 'rename' }>): Promise<AdminResult> {
  const target = await deps.profile(request.user_id)
  if (!target) return refuse('not_found')
  if (target.display_name === request.display_name) return { ok: true, user: target }
  const taken = await deps.profileByName(request.display_name)
  if (taken && taken.id !== target.id) return refuse('name_taken', 'display_name')
  const updated = await deps.updateProfile(target.id, { display_name: request.display_name })
  return 'error' in updated ? fromUpdateError(updated.error) : { ok: true, user: updated }
}

/**
 * Judges a request by the token that came with it, and does what it asks. Nothing in the body says
 * who the caller is or what they may do. Every outcome is a value; what throws unexpectedly is caught
 * here and becomes `failed`, with no word of what went wrong.
 */
export async function handleAdminRequest(deps: AdminDeps, token: string | null, body: unknown, options: AdminOptions = {}): Promise<AdminResult> {
  let caller: string | null = null
  // Only a request of an administrator says what it asked for in the log.
  let administrator = false
  const finish = (result: AdminResult): AdminResult => {
    try {
      deps.log({
        ...(caller === null ? {} : { caller }),
        ...(administrator ? whatWasAsked(body, options) : {}),
        code: result.ok ? 'ok' : result.code,
      })
    } catch {
      // A log that cannot be written does not change what was done.
    }
    return result
  }

  try {
    if (token === null || token.trim() === '') return finish(refuse('unauthenticated'))
    caller = await deps.identify(token)
    if (caller === null) return finish(refuse('unauthenticated'))
    const me = await deps.profile(caller)
    if (!me || me.role !== 'admin' || !me.is_active) return finish(refuse('forbidden'))
    administrator = true

    const request = parseAdminRequest(body, options)
    if ('invalid' in request) return finish(refuse('invalid', request.invalid))
    switch (request.action) {
      case 'create':
        return finish(await create(deps, request))
      case 'reset_password':
        return finish(await resetPassword(deps, caller, request))
      case 'set_active':
        return finish(await setActive(deps, caller, request))
      case 'set_role':
        return finish(await setRole(deps, request))
      case 'rename':
        return finish(await rename(deps, request))
    }
  } catch {
    return finish(refuse('failed'))
  }
}
