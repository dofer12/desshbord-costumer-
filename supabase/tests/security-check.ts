// The live check of the permissions of the database.
//
// It makes temporary users on the real project (an administrator, two employees and one that is
// deactivated), tries every cell of the table of permissions as each of them and as somebody who is
// not signed in (the tables, the private bucket of the pictures, the live connection and two settings
// of the sign-in), and then deletes everything that it made. The owner runs it on their own computer:
//
//   node supabase/tests/security-check.ts
//
// It asks for the secret key of the project and does not show it. The address of the project and the
// publishable key are public and are read from .env. Nothing is written anywhere, and the secret key
// is never printed. (SUPABASE_SECRET_KEY, SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the environment
// are used when they are set.)
//
// The checks themselves (`runChecks`) know nothing about the server: they ask a `Probe`, which is the
// real project here (createSupabaseProbe) and a Postgres in memory with the real migrations in the
// tests, where the same checks run against it.
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loadViteEnv } from '../../scripts/check-config.ts'
import { isSecretKey, loadConfig } from '../../src/lib/config.ts'

// ---------------------------------------------------------------------------------------------
// What a probe is asked, and what it answers
// ---------------------------------------------------------------------------------------------

/** The people that the checks act as. `anon` is somebody who is not signed in. */
export type Who = 'admin' | 'employee' | 'colleague' | 'inactive' | 'anon'
export type Member = Exclude<Who, 'anon'>

export type Row = Record<string, unknown>

/**
 * An operation on a table, as the app would send it. An insert, an update and a delete answer with
 * the number of rows that they touched and not with the rows themselves: asking for them back would
 * make the person pass the read policy too, which hides a mistake in the write policy.
 */
export type DbOp =
  | { op: 'select'; table: string; columns?: string; match?: Row }
  | { op: 'insert'; table: string; row: Row }
  | { op: 'upsert'; table: string; row: Row }
  | { op: 'update'; table: string; match: Row; patch: Row }
  | { op: 'delete'; table: string; match: Row }
  | { op: 'rpc'; fn: string; args: Row }

export type StorageOp =
  | { op: 'upload'; path: string; type: string; bytes: number; overwrite?: boolean }
  /** Asks for an address to open the file, and opens it. */
  | { op: 'sign'; path: string }
  /** Opens the file by the address that a public bucket would have, which needs no sign-in. */
  | { op: 'public'; path: string }
  | { op: 'remove'; path: string }

/**
 * What came of an operation. `refused` is the server saying no (a rule, a missing right); `ok` with
 * no rows is a rule that hid the rows; `error` is anything else, such as a server that is not there,
 * and is never taken for a refusal.
 */
export type Result =
  | { kind: 'ok'; rows: number; data?: Row[] }
  | { kind: 'refused'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'skipped'; why: string }

/** The rows that the cells work on, made by the check itself as the owner of the database would. */
export interface World {
  ids: Record<Member, string>
  /** What every title, key and name that the check makes starts with, so that the cleanup finds it. */
  mark: string
  /** A task that the employee made. */
  task: string
  /** A deleted task that the administrator made. */
  deletedTask: string
  /** A task of its own, for a cell that tries to destroy it. */
  newTask(by: Member): Promise<string>
  /** A picture of `task`, added by this person. Returns its id. */
  newAttachment(by: Member): Promise<string>
  /** A file in the bucket, uploaded by this person. Returns its path. */
  newFile(by: Member): Promise<string>
  /** A row of the statuses or of the settings. Returns its key. */
  newSetting(table: 'statuses' | 'app_settings'): Promise<string>
  /** A key or a name that nothing has yet. */
  fresh(prefix: string): string
}

export interface Probe {
  setup(): Promise<World>
  /** Deletes what the check made, and returns what it could not delete. */
  cleanup(): Promise<string[]>
  db(who: Who, op: DbOp): Promise<Result>
  storage(who: Who, op: StorageOp): Promise<Result>
  /** Whether a change of the task reaches this person through the live connection. */
  realtime(who: Who, taskId: string): Promise<Result>
  /** Somebody who is not signed in tries to make a user for themselves. */
  signUp(): Promise<Result>
  /** A member tries to give themselves a password that is too short. */
  weakPassword(): Promise<Result>
}

// ---------------------------------------------------------------------------------------------
// Judging a result
// ---------------------------------------------------------------------------------------------

/**
 * What a cell must come to.
 *  - allowed: it goes through, on at least one row (so an empty table cannot pass for a rule)
 *  - nothing: it goes through and touches no row (a rule hides the rows)
 *  - refused: the server says no
 *  - blocked: either of the last two
 */
export type Verdict = 'allowed' | 'nothing' | 'refused' | 'blocked'

const plural = (n: number) => `${n} row${n === 1 ? '' : 's'}`

function describeResult(result: Result): string {
  switch (result.kind) {
    case 'ok':
      return `went through (${plural(result.rows)})`
    case 'refused':
      return `was refused (${result.message})`
    case 'error':
      return `failed (${result.message})`
    case 'skipped':
      return `was skipped (${result.why})`
  }
}

const WANTED: Record<Verdict, string> = {
  allowed: 'it to go through, on at least one row',
  nothing: 'it to go through and touch no row',
  refused: 'the server to refuse it',
  blocked: 'it to be refused or to touch no row',
}

/** What is wrong with a result, or null when it is what the cell expects. */
export function judge(expect: Verdict, result: Result): string | null {
  const good =
    (expect === 'allowed' && result.kind === 'ok' && result.rows >= 1) ||
    (expect === 'nothing' && result.kind === 'ok' && result.rows === 0) ||
    (expect === 'refused' && result.kind === 'refused') ||
    (expect === 'blocked' && (result.kind === 'refused' || (result.kind === 'ok' && result.rows === 0)))
  return good ? null : `expected ${WANTED[expect]}, but it ${describeResult(result)}`
}

// ---------------------------------------------------------------------------------------------
// The cells
// ---------------------------------------------------------------------------------------------

export interface Cell {
  name: string
  run(probe: Probe, world: World): Promise<Result>
  expect: Verdict
}

const WHO: Record<Who, string> = {
  admin: 'the administrator',
  employee: 'the employee',
  colleague: 'a colleague',
  inactive: 'a deactivated member',
  anon: 'a visitor',
}

const TABLES = ['tasks', 'attachments', 'task_events', 'profiles', 'statuses', 'app_settings'] as const
const BUCKET = 'task-files'

/**
 * Every cell of the table of permissions. The order matters: what a faulty database lets a cell do
 * must not spoil the cells that come after it, so a cell that tries to destroy something works on a
 * row of its own, and the cells that try to change who is who come last.
 */
export function createCells(): Cell[] {
  const cells: Cell[] = []
  const add = (name: string, run: Cell['run'], expect: Verdict) => cells.push({ name, run, expect })

  // --- Who can read what: every active member, and nobody else.
  for (const table of TABLES) {
    for (const who of ['admin', 'employee', 'colleague'] as const) {
      add(`${table} · read as ${WHO[who]}`, (p) => p.db(who, { op: 'select', table }), 'allowed')
    }
    add(`${table} · read as ${WHO.inactive}`, (p) => p.db('inactive', { op: 'select', table }), 'nothing')
    add(`${table} · read as ${WHO.anon}`, (p) => p.db('anon', { op: 'select', table }), 'refused')
  }

  // --- Tasks: any member makes a task under their own name and edits any task; nobody deletes one.
  const newTask = (w: World, by: Member) => ({ id: randomUUID(), created_by: w.ids[by], no_glassix: true, title: w.mark })
  /** The author of a task, read as the owner would. */
  const authorOf = async (p: Probe, id: string): Promise<Result> => {
    const read = await p.db('admin', { op: 'select', table: 'tasks', columns: 'created_by', match: { id } })
    return read.kind === 'ok' ? { kind: 'ok', rows: 1, data: read.data } : read
  }
  add('tasks · create as the employee under their own name', (p, w) => p.db('employee', { op: 'insert', table: 'tasks', row: newTask(w, 'employee') }), 'allowed')
  add('tasks · create as the employee under the name of the administrator', (p, w) => p.db('employee', { op: 'insert', table: 'tasks', row: newTask(w, 'admin') }), 'refused')
  add(
    'tasks · create as the employee without an author takes the caller',
    async (p, w) => {
      const id = randomUUID()
      const made = await p.db('employee', { op: 'insert', table: 'tasks', row: { id, no_glassix: true, title: w.mark } })
      if (made.kind !== 'ok') return made
      const read = await authorOf(p, id)
      return read.kind === 'ok' ? { kind: 'ok', rows: read.data?.[0]?.created_by === w.ids.employee ? 1 : 0 } : read
    },
    'allowed',
  )
  add('tasks · create as a deactivated member', (p, w) => p.db('inactive', { op: 'insert', table: 'tasks', row: newTask(w, 'inactive') }), 'refused')
  add('tasks · create as a visitor', (p, w) => p.db('anon', { op: 'insert', table: 'tasks', row: newTask(w, 'employee') }), 'refused')

  const edit = (who: Who, id: (w: World) => string) => (p: Probe, w: World) =>
    p.db(who, { op: 'update', table: 'tasks', match: { id: id(w) }, patch: { notes: `by ${who}` } })
  add('tasks · edit as the employee', edit('employee', (w) => w.task), 'allowed')
  add('tasks · edit as a colleague', edit('colleague', (w) => w.task), 'allowed')
  add('tasks · edit a deleted task as a colleague', edit('colleague', (w) => w.deletedTask), 'allowed')
  add('tasks · edit as a deactivated member', edit('inactive', (w) => w.task), 'nothing')
  add('tasks · edit as a visitor', edit('anon', (w) => w.task), 'refused')
  add(
    'tasks · the author cannot be changed by an edit',
    async (p, w) => {
      const edited = await p.db('employee', { op: 'update', table: 'tasks', match: { id: w.task }, patch: { created_by: w.ids.admin } })
      if (edited.kind === 'error') return edited
      const read = await authorOf(p, w.task)
      return read.kind === 'ok' ? { kind: 'ok', rows: read.data?.[0]?.created_by === w.ids.employee ? 1 : 0 } : read
    },
    'allowed',
  )
  // The app sends a change as an upsert, and sends it again when the first try did not get through.
  add(
    'tasks · the same change sent twice is the same change',
    async (p, w) => {
      const row = newTask(w, 'employee')
      const first = await p.db('employee', { op: 'upsert', table: 'tasks', row })
      if (first.kind !== 'ok') return first
      return p.db('employee', { op: 'upsert', table: 'tasks', row: { ...row, notes: 'sent again' } })
    },
    'allowed',
  )
  add(
    'tasks · send a change as a deactivated member',
    (p, w) => p.db('inactive', { op: 'upsert', table: 'tasks', row: { id: w.task, created_by: w.ids.employee, no_glassix: true, title: w.mark } }),
    'refused',
  )
  for (const who of ['admin', 'employee', 'colleague', 'inactive', 'anon'] as const) {
    add(`tasks · delete as ${WHO[who]}`, async (p, w) => p.db(who, { op: 'delete', table: 'tasks', match: { id: await w.newTask('employee') } }), 'refused')
  }

  // --- The history is written by the server alone.
  for (const who of ['admin', 'employee'] as const) {
    add(`task_events · write as ${WHO[who]}`, (p, w) => p.db(who, { op: 'insert', table: 'task_events', row: { task_id: w.task, type: 'created', actor_id: w.ids[who] } }), 'refused')
    add(`task_events · change as ${WHO[who]}`, (p, w) => p.db(who, { op: 'update', table: 'task_events', match: { task_id: w.task }, patch: { type: 'deleted' } }), 'refused')
    add(`task_events · delete as ${WHO[who]}`, (p, w) => p.db(who, { op: 'delete', table: 'task_events', match: { task_id: w.task } }), 'refused')
  }

  // --- Attachments: members read and add (under their own name); whoever added one, or an administrator, removes it.
  const picture = (w: World, uploadedBy: string | null) => ({ task_id: w.task, storage_path: `${w.mark}/${randomUUID()}.jpg`, kind: 'image', uploaded_by: uploadedBy })
  add('attachments · add as the employee under their own name', (p, w) => p.db('employee', { op: 'insert', table: 'attachments', row: picture(w, w.ids.employee) }), 'allowed')
  add('attachments · add as the employee under the name of somebody else', (p, w) => p.db('employee', { op: 'insert', table: 'attachments', row: picture(w, w.ids.admin) }), 'refused')
  add('attachments · add as the employee under no name', (p, w) => p.db('employee', { op: 'insert', table: 'attachments', row: picture(w, null) }), 'refused')
  add('attachments · add as a deactivated member', (p, w) => p.db('inactive', { op: 'insert', table: 'attachments', row: picture(w, w.ids.inactive) }), 'refused')
  add('attachments · add as a visitor', (p, w) => p.db('anon', { op: 'insert', table: 'attachments', row: picture(w, w.ids.employee) }), 'refused')
  add(
    'attachments · change as the employee',
    async (p, w) => p.db('employee', { op: 'update', table: 'attachments', match: { id: await w.newAttachment('employee') }, patch: { kind: 'screenshot' } }),
    'refused',
  )
  const removePicture = (who: Who, addedBy: Member) => async (p: Probe, w: World) =>
    p.db(who, { op: 'delete', table: 'attachments', match: { id: await w.newAttachment(addedBy) } })
  add('attachments · delete as whoever added it', removePicture('employee', 'employee'), 'allowed')
  add('attachments · delete as a colleague who did not add it', removePicture('colleague', 'employee'), 'nothing')
  add('attachments · delete as the administrator, whoever added it', removePicture('admin', 'employee'), 'allowed')
  add('attachments · delete as a deactivated member', removePicture('inactive', 'inactive'), 'nothing')
  add('attachments · delete as a visitor', removePicture('anon', 'employee'), 'refused')

  // --- Statuses and settings: every member reads, an administrator writes.
  const SETTINGS = [
    {
      table: 'statuses' as const,
      row: (key: string) => ({ key, name_he: key, color: '#336699', sort: 999, is_active: true }),
      patch: { name_he: 'changed' },
    },
    {
      table: 'app_settings' as const,
      row: (key: string) => ({ key, value: { check: true } }),
      patch: { value: { check: false } },
    },
  ]
  for (const { table, row, patch } of SETTINGS) {
    add(`${table} · add as the administrator`, (p, w) => p.db('admin', { op: 'insert', table, row: row(w.fresh(table)) }), 'allowed')
    add(`${table} · add as the employee`, (p, w) => p.db('employee', { op: 'insert', table, row: row(w.fresh(table)) }), 'refused')
    add(`${table} · add as a visitor`, (p, w) => p.db('anon', { op: 'insert', table, row: row(w.fresh(table)) }), 'refused')
    add(`${table} · change as the employee`, async (p, w) => p.db('employee', { op: 'update', table, match: { key: await w.newSetting(table) }, patch }), 'nothing')
    add(`${table} · delete as the employee`, async (p, w) => p.db('employee', { op: 'delete', table, match: { key: await w.newSetting(table) } }), 'nothing')
    add(`${table} · change as the administrator`, async (p, w) => p.db('admin', { op: 'update', table, match: { key: await w.newSetting(table) }, patch }), 'allowed')
    add(`${table} · delete as the administrator`, async (p, w) => p.db('admin', { op: 'delete', table, match: { key: await w.newSetting(table) } }), 'allowed')
  }

  // --- The private bucket of the pictures.
  const upload = (who: Who, extra: Partial<Extract<StorageOp, { op: 'upload' }>> = {}) => (p: Probe, w: World) =>
    p.storage(who, { op: 'upload', path: `${w.task}/${randomUUID()}.jpg`, type: 'image/jpeg', bytes: 64, ...extra })
  add('storage · upload a JPEG as the employee', upload('employee'), 'allowed')
  add('storage · upload a JPEG as a deactivated member', upload('inactive'), 'blocked')
  add('storage · upload a JPEG as a visitor', upload('anon'), 'blocked')
  add('storage · upload what is not a JPEG', upload('employee', { type: 'text/plain' }), 'blocked')
  add('storage · upload a file of more than 5 MB', upload('employee', { bytes: 5 * 1024 * 1024 + 1 }), 'blocked')
  add(
    'storage · overwrite a file',
    async (p, w) => p.storage('employee', { op: 'upload', path: await w.newFile('employee'), type: 'image/jpeg', bytes: 64, overwrite: true }),
    'blocked',
  )
  for (const who of ['employee', 'colleague', 'admin'] as const) {
    add(`storage · open a file as ${WHO[who]}`, async (p, w) => p.storage(who, { op: 'sign', path: await w.newFile('employee') }), 'allowed')
  }
  add('storage · open a file as a deactivated member', async (p, w) => p.storage('inactive', { op: 'sign', path: await w.newFile('employee') }), 'blocked')
  add('storage · open a file as a visitor', async (p, w) => p.storage('anon', { op: 'sign', path: await w.newFile('employee') }), 'blocked')
  add('storage · a file cannot be opened by a public address', async (p, w) => p.storage('anon', { op: 'public', path: await w.newFile('employee') }), 'blocked')
  add('storage · delete a file as whoever uploaded it', async (p, w) => p.storage('employee', { op: 'remove', path: await w.newFile('employee') }), 'allowed')
  add('storage · delete a file as a colleague who did not upload it', async (p, w) => p.storage('colleague', { op: 'remove', path: await w.newFile('employee') }), 'blocked')
  add('storage · delete a file as the administrator', async (p, w) => p.storage('admin', { op: 'remove', path: await w.newFile('employee') }), 'allowed')
  add('storage · delete a file as a deactivated member', async (p, w) => p.storage('inactive', { op: 'remove', path: await w.newFile('employee') }), 'blocked')
  add('storage · delete a file as a visitor', async (p, w) => p.storage('anon', { op: 'remove', path: await w.newFile('employee') }), 'blocked')

  // --- The live connection brings a change to active members only.
  add('realtime · a change of a task reaches the employee', (p, w) => p.realtime('employee', w.task), 'allowed')
  add('realtime · a change of a task does not reach a deactivated member', (p, w) => p.realtime('inactive', w.task), 'blocked')
  add('realtime · a change of a task does not reach a visitor', (p, w) => p.realtime('anon', w.task), 'blocked')

  // --- The settings of the sign-in that the rules depend on.
  add('auth · nobody can make a user for themselves', (p) => p.signUp(), 'refused')
  add('auth · a password of 9 characters is refused', (p) => p.weakPassword(), 'refused')

  // --- Profiles: nobody writes to them directly, so nobody can make themselves an administrator.
  // These come last, because a database that allowed them would change who is who.
  const rename = (p: Probe, w: World, who: Who) => p.db(who, { op: 'rpc', fn: 'update_my_profile', args: { p_display_name: w.fresh('name'), p_default_remind_min: 20 } })
  add('profiles · a member changes their own name and reminder through the function', (p, w) => rename(p, w, 'employee'), 'allowed')
  add('profiles · a deactivated member cannot change their name through the function', (p, w) => rename(p, w, 'inactive'), 'refused')
  add('profiles · a visitor cannot change a name through the function', (p, w) => rename(p, w, 'anon'), 'refused')
  add('profiles · a member clears their own must-change-password mark', (p) => p.db('employee', { op: 'rpc', fn: 'clear_must_change_password', args: {} }), 'allowed')
  add('profiles · a visitor cannot clear the mark', (p) => p.db('anon', { op: 'rpc', fn: 'clear_must_change_password', args: {} }), 'refused')
  add(
    'profiles · a member cannot make a profile',
    (p, w) => p.db('employee', { op: 'insert', table: 'profiles', row: { id: randomUUID(), display_name: w.fresh('profile'), role: 'admin' } }),
    'refused',
  )
  add('profiles · an administrator cannot delete a profile', (p, w) => p.db('admin', { op: 'delete', table: 'profiles', match: { id: w.ids.colleague } }), 'refused')
  add(
    'profiles · an employee cannot make themselves an administrator',
    (p, w) => p.db('employee', { op: 'update', table: 'profiles', match: { id: w.ids.employee }, patch: { role: 'admin' } }),
    'refused',
  )
  add(
    'profiles · an administrator cannot change the role of a colleague directly',
    (p, w) => p.db('admin', { op: 'update', table: 'profiles', match: { id: w.ids.colleague }, patch: { role: 'admin' } }),
    'refused',
  )
  add(
    'profiles · a deactivated member cannot switch themselves on',
    (p, w) => p.db('inactive', { op: 'update', table: 'profiles', match: { id: w.ids.inactive }, patch: { is_active: true } }),
    'blocked',
  )

  return cells
}

// ---------------------------------------------------------------------------------------------
// Running them
// ---------------------------------------------------------------------------------------------

export interface Finding {
  name: string
  verdict: 'passed' | 'failed' | 'skipped'
  /** What was wrong, or why it was skipped. */
  detail?: string
}

export interface Report {
  findings: Finding[]
  /** Set when the temporary users and rows could not be made: no cell was tried. */
  setupError?: string
  /** What could not be deleted afterwards. */
  leftBehind: string[]
}

/** Tries every cell, and always deletes what it made, also when something goes wrong. */
export async function runChecks(
  probe: Probe,
  cells: Cell[] = createCells(),
  onProgress: (finding: Finding) => void = () => undefined,
): Promise<Report> {
  const findings: Finding[] = []
  let setupError: string | undefined
  try {
    const world = await probe.setup()
    for (const cell of cells) {
      let finding: Finding
      try {
        const result = await cell.run(probe, world)
        const wrong = result.kind === 'skipped' ? null : judge(cell.expect, result)
        finding =
          result.kind === 'skipped'
            ? { name: cell.name, verdict: 'skipped', detail: result.why }
            : wrong === null
              ? { name: cell.name, verdict: 'passed' }
              : { name: cell.name, verdict: 'failed', detail: wrong }
      } catch (error) {
        finding = { name: cell.name, verdict: 'failed', detail: `the check itself failed: ${(error as Error).message}` }
      }
      findings.push(finding)
      onProgress(finding)
    }
  } catch (error) {
    setupError = (error as Error).message
  }
  let leftBehind: string[]
  try {
    leftBehind = await probe.cleanup()
  } catch (error) {
    leftBehind = [`the cleanup itself failed: ${(error as Error).message}`]
  }
  return { findings, setupError, leftBehind }
}

/** Whether the project passed: nothing failed, something was really tried, and nothing was left behind. */
export function passed(report: Report): boolean {
  return (
    report.setupError === undefined &&
    report.leftBehind.length === 0 &&
    report.findings.every((f) => f.verdict !== 'failed') &&
    report.findings.some((f) => f.verdict === 'passed')
  )
}

const MARK = { passed: 'ok  ', failed: 'FAIL', skipped: 'skip' } as const

/** The lines to print: what failed or was skipped, what was left behind, and the verdict. */
export function formatReport(report: Report, secrets: string[] = []): string[] {
  const hide = (text: string) => secrets.filter((s) => s.length > 8).reduce((safe, secret) => safe.split(secret).join('***'), text)
  const lines: string[] = []
  if (report.setupError) lines.push(`SETUP FAILED: ${hide(report.setupError)}`)
  for (const f of report.findings) {
    if (f.verdict === 'passed') continue
    lines.push(`${MARK[f.verdict]}  ${f.name}${f.detail ? `\n      ${hide(f.detail)}` : ''}`)
  }
  for (const item of report.leftBehind) lines.push(`LEFT BEHIND: ${hide(item)} (delete it by hand)`)
  const count = (verdict: Finding['verdict']) => report.findings.filter((f) => f.verdict === verdict).length
  lines.push('')
  lines.push(`${count('passed')} passed, ${count('failed')} failed, ${count('skipped')} skipped.`)
  lines.push(passed(report) ? 'ALL CHECKS PASSED.' : 'THE CHECK FAILED: do not let other people use the app until this is fixed.')
  return lines
}

// ---------------------------------------------------------------------------------------------
// The settings
// ---------------------------------------------------------------------------------------------

export interface Settings {
  url: string
  publishableKey: string
  secretKey: string
}

/** Reads the three settings, or says which is missing or wrong. A message never holds a key. */
export function readSettings(env: Record<string, string | undefined>): Settings {
  const url = (env.SUPABASE_URL ?? '').trim()
  const publishableKey = (env.SUPABASE_PUBLISHABLE_KEY ?? '').trim()
  const secretKey = (env.SUPABASE_SECRET_KEY ?? '').trim()
  const missing = (
    [
      ['SUPABASE_URL', url],
      ['SUPABASE_PUBLISHABLE_KEY', publishableKey],
      ['SUPABASE_SECRET_KEY', secretKey],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name)
  if (missing.length > 0) throw new Error(`${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing.`)

  if (isSecretKey(publishableKey)) throw new Error('SUPABASE_PUBLISHABLE_KEY holds a secret key. Give it the publishable key (sb_publishable_...).')
  if (!isSecretKey(secretKey)) throw new Error('SUPABASE_SECRET_KEY is not a secret key of Supabase (it starts with sb_secret_).')
  let config
  try {
    config = loadConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey })
  } catch {
    throw new Error('SUPABASE_URL must be the address of the project, starting with https://')
  }
  return { url: config.supabaseUrl, publishableKey: config.supabasePublishableKey, secretKey }
}

// ---------------------------------------------------------------------------------------------
// Telling a refusal from a failure
// ---------------------------------------------------------------------------------------------

interface ApiError {
  code?: string
  status?: number | string
  statusCode?: number | string
  message?: string
}

const messageOf = (error: ApiError) => error.message ?? 'unknown error'

/**
 * An error of the tables is a refusal only when Postgres says "insufficient privilege" (42501), which
 * covers a missing grant, a policy and a function that is not executable. A missing table, an expired
 * token or a server that is not there are failures, and a check that took them for refusals would
 * pass a project that is not even set up.
 */
export function classifyDb(error: ApiError): Result {
  return error.code === '42501' ? { kind: 'refused', message: messageOf(error) } : { kind: 'error', message: messageOf(error) }
}

const STORAGE_REFUSALS = [401, 403, 404, 413, 415]

/** The same for Storage, which speaks in HTTP statuses and in sentences. A bucket that does not exist is a failure. */
export function classifyStorage(error: ApiError): Result {
  const message = messageOf(error)
  if (/bucket not found/i.test(message)) return { kind: 'error', message }
  const status = [Number(error.status), Number(error.statusCode)].some((code) => STORAGE_REFUSALS.includes(code))
  const said = /row-level security|mime type|exceeded the maximum|too large|payload|object not found|unauthori[sz]ed/i.test(message)
  return status || said ? { kind: 'refused', message } : { kind: 'error', message }
}

/** The same for the sign-in service: a refusal is one of the codes that it answers a forbidden request with. */
export function classifyAuth(error: ApiError, refusals: string[]): Result {
  return error.code !== undefined && refusals.includes(error.code) ? { kind: 'refused', message: messageOf(error) } : { kind: 'error', message: messageOf(error) }
}

// ---------------------------------------------------------------------------------------------
// The real project
// ---------------------------------------------------------------------------------------------

const HEARD_WITHIN_MS = 6_000
const TEMP_EMAIL = /^security-check-.*@example\.com$/

/**
 * The probe of a real project: temporary users are made with the secret key and each acts through a
 * client of their own. `fetch` stands in for the network in the tests.
 */
export function createSupabaseProbe(settings: Settings, options: { fetch?: typeof fetch } = {}): Probe {
  const mark = `security-check-${randomUUID().slice(0, 8)}`
  const clientOptions = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(options.fetch ? { global: { fetch: options.fetch } } : {}),
  }
  const send = options.fetch ?? fetch
  const service = createClient(settings.url, settings.secretKey, clientOptions)
  const clients = new Map<Who, SupabaseClient>()
  const ids = {} as Record<Member, string>
  let counter = 0
  // Set when the project could not be reached with the key: nothing was made, so there is nothing to clean.
  let untouched = false

  const clientFor = (who: Who): SupabaseClient => {
    const client = clients.get(who)
    if (!client) throw new Error(`there is no client for ${who}`)
    return client
  }

  async function makeUser(who: Member, role: 'admin' | 'employee'): Promise<void> {
    const email = `${mark}-${who}@example.com`
    const password = `Check-${randomUUID()}`
    const made = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role },
      user_metadata: { display_name: `${mark}-${who}` },
    })
    if (made.error || !made.data.user) throw new Error(`could not make the ${who}: ${made.error?.message ?? 'no user came back'}`)
    ids[who] = made.data.user.id
    const client = createClient(settings.url, settings.publishableKey, clientOptions)
    const signedIn = await client.auth.signInWithPassword({ email, password })
    if (signedIn.error) throw new Error(`could not sign in as the ${who}: ${signedIn.error.message}`)
    clients.set(who, client)
  }

  /** Writes a row as the owner of the project, which the policies do not apply to. */
  async function insertAsOwner(table: string, row: Row): Promise<void> {
    const { error } = await service.from(table).insert(row)
    if (error) throw new Error(`could not make a row of ${table}: ${error.message}`)
  }

  async function upload(who: Who, op: Extract<StorageOp, { op: 'upload' }>): Promise<Result> {
    const { error } = await clientFor(who).storage.from(BUCKET).upload(op.path, new Uint8Array(op.bytes), {
      contentType: op.type,
      upsert: op.overwrite === true,
    })
    return error ? classifyStorage(error as ApiError) : { kind: 'ok', rows: 1 }
  }

  return {
    async setup() {
      // The first thing asked of the project says whether the key works, in words the owner can act on.
      const reached = await service.auth.admin.listUsers({ page: 1, perPage: 1 })
      if (reached.error) {
        untouched = true
        const status = (reached.error as { status?: number }).status
        throw new Error(
          status === 401 || status === 403
            ? `the project did not accept the secret key (${reached.error.message}). Check that the whole key was pasted: it starts with sb_secret_.`
            : `could not reach the project (${reached.error.message}).`,
        )
      }

      // A run that was stopped half way leaves its users and rows behind: clear them first.
      const left = await sweep(service)
      if (left.length > 0) throw new Error(`what an earlier run left behind could not be deleted: ${left.join('; ')}`)

      clients.set('anon', createClient(settings.url, settings.publishableKey, clientOptions))
      await makeUser('admin', 'admin')
      await makeUser('employee', 'employee')
      await makeUser('colleague', 'employee')
      await makeUser('inactive', 'employee')
      const off = await service.from('profiles').update({ is_active: false }, { count: 'exact' }).eq('id', ids.inactive)
      if (off.error || off.count !== 1) throw new Error(`could not deactivate the member: ${off.error?.message ?? 'no row changed'}`)

      const newTask = async (by: Member, deleted = false): Promise<string> => {
        const id = randomUUID()
        await insertAsOwner('tasks', { id, created_by: ids[by], no_glassix: true, title: mark, ...(deleted ? { deleted_at: new Date().toISOString() } : {}) })
        return id
      }
      const task = await newTask('employee')
      const deletedTask = await newTask('admin', true)
      const newAttachment = async (by: Member): Promise<string> => {
        const id = randomUUID()
        await insertAsOwner('attachments', { id, task_id: task, storage_path: `${mark}/${id}.jpg`, kind: 'image', uploaded_by: ids[by] })
        return id
      }
      await newAttachment('employee')
      const fresh = (prefix: string) => `${mark}-${prefix}-${++counter}`

      return {
        ids,
        mark,
        task,
        deletedTask,
        newTask: (by) => newTask(by),
        newAttachment,
        async newFile(by) {
          const path = `${task}/${randomUUID()}.jpg`
          const made = await upload(by, { op: 'upload', path, type: 'image/jpeg', bytes: 64 })
          if (made.kind !== 'ok') throw new Error(`could not upload a file as the ${by}: ${describeResult(made)}`)
          return path
        },
        async newSetting(table) {
          const key = fresh(table)
          await insertAsOwner(table, table === 'statuses' ? { key, name_he: key, color: '#336699', sort: 999 } : { key, value: { check: true } })
          return key
        },
        fresh,
      }
    },

    cleanup: () => (untouched ? Promise.resolve([]) : sweep(service)),

    async db(who, op) {
      const client = clientFor(who)
      try {
        switch (op.op) {
          case 'select': {
            let query = client.from(op.table).select(op.columns ?? '*')
            if (op.match) query = query.match(op.match)
            const { data, error } = await query.limit(1000)
            return error ? classifyDb(error) : { kind: 'ok', rows: data.length, data: data as unknown as Row[] }
          }
          case 'insert': {
            const { error } = await client.from(op.table).insert(op.row)
            return error ? classifyDb(error) : { kind: 'ok', rows: 1 }
          }
          case 'upsert': {
            const { error } = await client.from(op.table).upsert(op.row, { onConflict: 'id' })
            return error ? classifyDb(error) : { kind: 'ok', rows: 1 }
          }
          case 'update': {
            const { error, count } = await client.from(op.table).update(op.patch, { count: 'exact' }).match(op.match)
            return error ? classifyDb(error) : { kind: 'ok', rows: count ?? 0 }
          }
          case 'delete': {
            const { error, count } = await client.from(op.table).delete({ count: 'exact' }).match(op.match)
            return error ? classifyDb(error) : { kind: 'ok', rows: count ?? 0 }
          }
          case 'rpc': {
            const { error } = await client.rpc(op.fn, op.args)
            return error ? classifyDb(error) : { kind: 'ok', rows: 1 }
          }
        }
      } catch (error) {
        return { kind: 'error', message: (error as Error).message }
      }
    },

    async storage(who, op) {
      try {
        const bucket = clientFor(who).storage.from(BUCKET)
        switch (op.op) {
          case 'upload':
            return await upload(who, op)
          case 'sign': {
            const { data, error } = await bucket.createSignedUrl(op.path, 60)
            if (error || !data) return classifyStorage((error ?? { message: 'no address came back' }) as ApiError)
            // An address is only worth something if the file comes with it.
            const response = await send(data.signedUrl)
            return response.ok ? { kind: 'ok', rows: 1 } : { kind: 'refused', message: `the file was not given (${response.status})` }
          }
          case 'public': {
            const response = await send(bucket.getPublicUrl(op.path).data.publicUrl)
            return response.ok ? { kind: 'ok', rows: 1 } : { kind: 'refused', message: `the file was not given (${response.status})` }
          }
          case 'remove': {
            const { data, error } = await bucket.remove([op.path])
            return error ? classifyStorage(error as ApiError) : { kind: 'ok', rows: data.length }
          }
        }
      } catch (error) {
        return { kind: 'error', message: (error as Error).message }
      }
    },

    async realtime(who, taskId) {
      const client = clientFor(who)
      let heard = false
      const channel = client
        .channel(`${mark}-${who}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `id=eq.${taskId}` }, () => {
          heard = true
        })
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('the live connection did not open')), 10_000)
          channel.subscribe((status, error) => {
            if (status === 'SUBSCRIBED') {
              clearTimeout(timer)
              resolve()
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              clearTimeout(timer)
              reject(error ?? new Error(`the live connection said ${status}`))
            }
          })
        })
      } catch (error) {
        await client.removeChannel(channel)
        // The employee must get in. A person who may not listen can be turned away at the door.
        const message = (error as Error).message
        return who === 'employee' ? { kind: 'error', message } : { kind: 'refused', message }
      }
      const changed = await service.from('tasks').update({ notes: `heard by ${who}` }).eq('id', taskId)
      if (changed.error) {
        await client.removeChannel(channel)
        return { kind: 'error', message: `could not change the task: ${changed.error.message}` }
      }
      const deadline = Date.now() + HEARD_WITHIN_MS
      while (!heard && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100))
      await client.removeChannel(channel)
      return heard ? { kind: 'ok', rows: 1 } : { kind: 'refused', message: `nothing arrived in ${HEARD_WITHIN_MS / 1000} seconds` }
    },

    async signUp() {
      const { error } = await clientFor('anon').auth.signUp({ email: `${mark}-signup@example.com`, password: `Check-${randomUUID()}` })
      // A user that was made after all is found and deleted by the cleanup, by its address.
      return error ? classifyAuth(error as ApiError, ['signup_disabled']) : { kind: 'ok', rows: 1 }
    },

    async weakPassword() {
      const { error } = await clientFor('employee').auth.updateUser({ password: '123456789' })
      return error ? classifyAuth(error as ApiError, ['weak_password']) : { kind: 'ok', rows: 1 }
    },
  }
}

/**
 * Deletes everything that a run of the check makes, this one's and an interrupted earlier one's: the
 * temporary users (by their address), the tasks and settings that carry the mark, and the files of
 * those tasks. Returns what it could not delete.
 */
async function sweep(service: SupabaseClient): Promise<string[]> {
  const left: string[] = []
  const attempt = async (what: string, step: () => PromiseLike<{ error: { message: string } | null }>) => {
    try {
      const { error } = await step()
      if (error) left.push(`${what}: ${error.message}`)
    } catch (error) {
      left.push(`${what}: ${(error as Error).message}`)
    }
  }

  // The temporary users, found by their address in the sign-in service.
  const userIds: string[] = []
  for (let page = 1; ; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) {
      left.push(`listing the users: ${error.message}`)
      break
    }
    for (const user of data.users) if (TEMP_EMAIL.test(user.email ?? '')) userIds.push(user.id)
    if (data.users.length < 1000) break
  }

  // Their tasks, and the tasks that carry the mark, with the files of each.
  const taskIds = new Set<string>()
  const byTitle = await service.from('tasks').select('id').like('title', 'security-check-%')
  if (byTitle.error) left.push(`finding the tasks: ${byTitle.error.message}`)
  for (const row of byTitle.data ?? []) taskIds.add(row.id as string)
  if (userIds.length > 0) {
    const byAuthor = await service.from('tasks').select('id').in('created_by', userIds)
    if (byAuthor.error) left.push(`finding the tasks of the users: ${byAuthor.error.message}`)
    for (const row of byAuthor.data ?? []) taskIds.add(row.id as string)
  }
  for (const id of taskIds) {
    const listed = await service.storage.from(BUCKET).list(id)
    const names = (listed.data ?? []).map((file) => `${id}/${file.name}`)
    if (names.length > 0) await attempt(`the files of task ${id}`, () => service.storage.from(BUCKET).remove(names))
  }

  for (const table of ['statuses', 'app_settings']) {
    await attempt(table, () => service.from(table).delete().like('key', 'security-check-%'))
  }
  if (taskIds.size > 0) await attempt('the tasks', () => service.from('tasks').delete().in('id', [...taskIds]))
  // A user who made a task cannot be deleted while the task is there, so the users come last.
  for (const id of userIds) await attempt(`the user ${id}`, () => service.auth.admin.deleteUser(id))
  return left
}

// ---------------------------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------------------------

/** Asks for a line on the terminal without showing what is typed or pasted. */
async function askHidden(question: string): Promise<string> {
  process.stdout.write(question)
  const stdin = process.stdin
  stdin.setRawMode?.(true)
  stdin.resume()
  stdin.setEncoding('utf8')
  return new Promise((resolve) => {
    let text = ''
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          stdin.setRawMode?.(false)
          stdin.pause()
          stdin.off('data', onData)
          process.stdout.write('\n')
          resolve(text)
          return
        }
        if (char === '\u0003') process.exit(130)
        if (char === '\u007f' || char === '\b') text = text.slice(0, -1)
        else text += char
      }
    }
    stdin.on('data', onData)
    // Without a terminal (input that ends at once) there is nothing to wait for.
    stdin.once('end', () => resolve(text))
  })
}

/**
 * Prints the lines and ends the process by letting it run out, with the exit code set. Ending it with
 * process.exit while a connection is closing crashes Node on Windows, and loses the exit code.
 */
function finish(lines: string[], code: number): void {
  process.exitCode = code
  process.stdout.write(`${lines.join('\n')}\n`)
  // A connection that is kept open must not keep the process for long.
  setTimeout(() => process.exit(code), 10_000).unref()
}

if (import.meta.main) {
  try {
    // The address and the publishable key are public and are in .env; the secret key is asked for.
    const vite = loadViteEnv(process.cwd())
    const env: Record<string, string | undefined> = {
      SUPABASE_URL: vite.VITE_SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY: vite.VITE_SUPABASE_PUBLISHABLE_KEY,
      ...process.env,
    }
    if (!env.SUPABASE_SECRET_KEY?.trim()) env.SUPABASE_SECRET_KEY = await askHidden('Secret key of the project (it is not shown): ')
    const settings = readSettings(env)

    console.log(`Checking the permissions of ${new URL(settings.url).host}. It makes temporary users and deletes them at the end.`)
    const probe = createSupabaseProbe(settings)
    process.once('SIGINT', () => {
      console.log('\nStopped: deleting what the check made...')
      void probe.cleanup().then((left) => {
        for (const item of left) console.log(`LEFT BEHIND: ${item} (delete it by hand)`)
        process.exit(130)
      })
    })
    const report = await runChecks(probe, createCells(), (f) => {
      if (f.verdict === 'failed') console.log(`FAIL  ${f.name}`)
    })
    finish(formatReport(report, [settings.secretKey, settings.publishableKey]), passed(report) ? 0 : 1)
  } catch (error) {
    console.error((error as Error).message)
    process.exitCode = 2
  }
}
