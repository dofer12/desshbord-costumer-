// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createDb } from './helpers/pg'
import { createPgliteProbe } from './helpers/pgliteProbe'
import {
  classifyAuth,
  classifyDb,
  classifyStorage,
  createCells,
  formatReport,
  judge,
  passed,
  readSettings,
  runChecks,
  type Cell,
  type Finding,
  type Probe,
  type Report,
  type Result,
  type World,
} from './security-check'

// The live check of the permissions (security-check.ts) is a list of cells, each of which tries one
// thing as one kind of person and says what it must come to. These tests pin how a result is judged,
// how a run is reported and cleaned up, and that the cells really catch a mistake: the whole list runs
// against the migrations (the faults file breaks them in turn).

const ok = (rows: number): Result => ({ kind: 'ok', rows })
const refused: Result = { kind: 'refused', message: 'permission denied' }
const failure: Result = { kind: 'error', message: 'boom' }

describe('judge', () => {
  const table: Array<[Parameters<typeof judge>[0], string, Result, boolean]> = [
    ['allowed', 'went through on a row', ok(1), true],
    ['allowed', 'went through on three rows', ok(3), true],
    ['allowed', 'went through on no row', ok(0), false],
    ['allowed', 'was refused', refused, false],
    ['allowed', 'failed', failure, false],
    ['nothing', 'went through on no row', ok(0), true],
    ['nothing', 'went through on a row', ok(1), false],
    ['nothing', 'was refused', refused, false],
    ['nothing', 'failed', failure, false],
    ['refused', 'was refused', refused, true],
    ['refused', 'went through on no row', ok(0), false],
    ['refused', 'went through on a row', ok(1), false],
    ['refused', 'failed', failure, false],
    ['blocked', 'was refused', refused, true],
    ['blocked', 'went through on no row', ok(0), true],
    ['blocked', 'went through on a row', ok(2), false],
    ['blocked', 'failed', failure, false],
  ]
  it.each(table)('%s, when it %s', (expectation, _what, result, good) => {
    expect(judge(expectation, result) === null).toBe(good)
  })

  it('never takes a failure for a refusal, nor an empty table for a rule', () => {
    expect(judge('refused', failure)).not.toBeNull()
    expect(judge('allowed', ok(0))).not.toBeNull()
  })

  it('says what was expected and what happened', () => {
    expect(judge('refused', ok(1))).toBe('expected the server to refuse it, but it went through (1 row)')
    expect(judge('allowed', ok(0))).toBe('expected it to go through, on at least one row, but it went through (0 rows)')
    expect(judge('nothing', refused)).toBe('expected it to go through and touch no row, but it was refused (permission denied)')
    expect(judge('blocked', failure)).toBe('expected it to be refused or to touch no row, but it failed (boom)')
    expect(judge('allowed', { kind: 'skipped', why: 'later' })).toBe('expected it to go through, on at least one row, but it was skipped (later)')
  })

})

describe('telling a refusal from a failure', () => {
  it('takes only "insufficient privilege" of a table for a refusal', () => {
    expect(classifyDb({ code: '42501', message: 'new row violates row-level security policy' })).toEqual({
      kind: 'refused',
      message: 'new row violates row-level security policy',
    })
    // A table that is not there, a token that ran out and a server that is not there are failures.
    expect(classifyDb({ code: 'PGRST205', message: 'Could not find the table', status: 404 }).kind).toBe('error')
    expect(classifyDb({ code: 'PGRST303', message: 'JWT expired', status: 401 }).kind).toBe('error')
    expect(classifyDb({ code: '23503', message: 'foreign key violation' }).kind).toBe('error')
    expect(classifyDb({ message: 'TypeError: fetch failed' })).toEqual({ kind: 'error', message: 'TypeError: fetch failed' })
    expect(classifyDb({})).toEqual({ kind: 'error', message: 'unknown error' })
  })

  it('takes the statuses and the sentences of Storage that mean "no" for a refusal', () => {
    for (const error of [
      { status: 403, message: 'new row violates row-level security policy' },
      { status: 400, statusCode: '403', message: 'Unauthorized' },
      { status: 404, message: 'Object not found' },
      { status: 413, message: 'The object exceeded the maximum allowed size' },
      { statusCode: '415', message: 'mime type text/plain is not supported' },
      { status: 400, message: 'new row violates row-level security policy' },
      { status: 401, message: 'JWT' },
    ]) {
      expect(classifyStorage(error).kind, JSON.stringify(error)).toBe('refused')
    }
  })

  it('takes a bucket that is not there, a server that fails and a network that fails for failures', () => {
    expect(classifyStorage({ status: 404, statusCode: '404', message: 'Bucket not found' }).kind).toBe('error')
    expect(classifyStorage({ status: 500, message: 'Internal Server Error' }).kind).toBe('error')
    expect(classifyStorage({ message: 'TypeError: fetch failed' }).kind).toBe('error')
  })

  it('takes only the named codes of the sign-in service for a refusal', () => {
    expect(classifyAuth({ code: 'signup_disabled', message: 'Signups not allowed' }, ['signup_disabled']).kind).toBe('refused')
    expect(classifyAuth({ code: 'weak_password', message: 'Password should be at least 10 characters' }, ['weak_password']).kind).toBe('refused')
    expect(classifyAuth({ code: 'over_email_send_rate_limit', message: 'rate limit' }, ['signup_disabled']).kind).toBe('error')
    expect(classifyAuth({ message: 'no code' }, ['signup_disabled']).kind).toBe('error')
  })
})

describe('the settings', () => {
  const publishable = 'sb_publishable_abcdefghijklmnop'
  const secret = 'sb_secret_abcdefghijklmnop'
  const good = { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_PUBLISHABLE_KEY: publishable, SUPABASE_SECRET_KEY: secret }

  it('reads the address and both keys, trimmed, with the address as an origin', () => {
    expect(readSettings({ ...good, SUPABASE_URL: ' https://abc.supabase.co/ ', SUPABASE_SECRET_KEY: ` ${secret}\n` })).toEqual({
      url: 'https://abc.supabase.co',
      publishableKey: publishable,
      secretKey: secret,
    })
  })

  it('accepts the secret key of the older kind, a token of the role service_role', () => {
    const token = `e30.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`
    expect(readSettings({ ...good, SUPABASE_SECRET_KEY: token }).secretKey).toBe(token)
  })

  it('names what is missing', () => {
    expect(() => readSettings({ ...good, SUPABASE_URL: undefined })).toThrow('SUPABASE_URL is missing.')
    expect(() => readSettings({ ...good, SUPABASE_URL: '   ' })).toThrow('SUPABASE_URL is missing.')
    expect(() => readSettings({ ...good, SUPABASE_PUBLISHABLE_KEY: '' })).toThrow('SUPABASE_PUBLISHABLE_KEY is missing.')
    expect(() => readSettings({ ...good, SUPABASE_SECRET_KEY: '  ' })).toThrow('SUPABASE_SECRET_KEY is missing.')
    expect(() => readSettings({})).toThrow('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY are missing.')
  })

  it('refuses keys that were put in the wrong place, and an address that is not https', () => {
    expect(() => readSettings({ ...good, SUPABASE_PUBLISHABLE_KEY: secret })).toThrow('SUPABASE_PUBLISHABLE_KEY holds a secret key')
    expect(() => readSettings({ ...good, SUPABASE_SECRET_KEY: publishable })).toThrow('SUPABASE_SECRET_KEY is not a secret key')
    expect(() => readSettings({ ...good, SUPABASE_URL: 'http://abc.supabase.co' })).toThrow('https://')
    expect(() => readSettings({ ...good, SUPABASE_URL: 'abc' })).toThrow('https://')
  })

  it('never puts a key in a message', () => {
    const wrong = [
      { ...good, SUPABASE_PUBLISHABLE_KEY: secret },
      { ...good, SUPABASE_SECRET_KEY: publishable },
      { ...good, SUPABASE_URL: 'http://abc.supabase.co' },
      { ...good, SUPABASE_URL: undefined },
    ]
    for (const env of wrong) {
      let message = ''
      try {
        readSettings(env)
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).not.toBe('')
      expect(message).not.toContain(secret)
      expect(message).not.toContain(publishable)
    }
  })
})

/** A probe that answers the same to everything, and writes down what it was asked to do. */
function scripted(over: Partial<Probe> = {}) {
  const calls: string[] = []
  const world = { ids: {}, mark: 'm', task: 't', deletedTask: 'd' } as unknown as World
  const probe: Probe = {
    setup: async () => {
      calls.push('setup')
      return world
    },
    cleanup: async () => {
      calls.push('cleanup')
      return []
    },
    db: async () => ok(1),
    storage: async () => ok(1),
    realtime: async () => ok(1),
    signUp: async () => refused,
    weakPassword: async () => refused,
    ...over,
  }
  return { probe, calls }
}

const cell = (name: string, result: Result | (() => Promise<Result>), expect: Cell['expect'] = 'allowed', calls?: string[]): Cell => ({
  name,
  expect,
  run: async () => {
    calls?.push(name)
    return typeof result === 'function' ? result() : result
  },
})

describe('runChecks', () => {
  it('tries the cells in order, and cleans up after the last', async () => {
    const { probe, calls } = scripted()
    const report = await runChecks(probe, [cell('a', ok(1), 'allowed', calls), cell('b', refused, 'refused', calls)])
    expect(calls).toEqual(['setup', 'a', 'b', 'cleanup'])
    expect(report.findings).toEqual([
      { name: 'a', verdict: 'passed' },
      { name: 'b', verdict: 'passed' },
    ])
    expect(report.setupError).toBeUndefined()
    expect(report.leftBehind).toEqual([])
    expect(passed(report)).toBe(true)
  })

  it('fails a cell that did not come to what it expects, and says why', async () => {
    const { probe } = scripted()
    const report = await runChecks(probe, [cell('delete', ok(1), 'refused')])
    expect(report.findings).toEqual([{ name: 'delete', verdict: 'failed', detail: 'expected the server to refuse it, but it went through (1 row)' }])
    expect(passed(report)).toBe(false)
  })

  it('fails a cell that throws, and goes on with the next', async () => {
    const { probe, calls } = scripted()
    const report = await runChecks(probe, [
      cell('a', async () => {
        throw new Error('no client')
      }),
      cell('b', ok(1), 'allowed', calls),
    ])
    expect(report.findings).toEqual([
      { name: 'a', verdict: 'failed', detail: 'the check itself failed: no client' },
      { name: 'b', verdict: 'passed' },
    ])
    expect(calls).toEqual(['setup', 'b', 'cleanup'])
  })

  it('counts a skipped cell as neither a pass nor a failure', async () => {
    const { probe } = scripted()
    const report = await runChecks(probe, [cell('a', ok(1)), cell('sign-up', { kind: 'skipped', why: 'not here' }, 'refused')])
    expect(report.findings[1]).toEqual({ name: 'sign-up', verdict: 'skipped', detail: 'not here' })
    expect(passed(report)).toBe(true)
  })

  it('does not pass a run in which nothing passed', async () => {
    const { probe } = scripted()
    expect(passed(await runChecks(probe, []))).toBe(false)
    expect(passed(await runChecks(probe, [cell('a', { kind: 'skipped', why: 'x' })]))).toBe(false)
  })

  it('tries no cell when the setup fails, still cleans up, and does not pass', async () => {
    const { probe, calls } = scripted({
      setup: async () => {
        calls.push('setup')
        throw new Error('could not make the administrator')
      },
    })
    const report = await runChecks(probe, [cell('a', ok(1), 'allowed', calls)])
    expect(calls).toEqual(['setup', 'cleanup'])
    expect(report.findings).toEqual([])
    expect(report.setupError).toBe('could not make the administrator')
    expect(passed(report)).toBe(false)
  })

  it('does not pass a run that left something behind, or whose cleanup failed', async () => {
    const left = await runChecks(scripted({ cleanup: async () => ['the user abc: not allowed'] }).probe, [cell('a', ok(1))])
    expect(left.findings).toEqual([{ name: 'a', verdict: 'passed' }])
    expect(left.leftBehind).toEqual(['the user abc: not allowed'])
    expect(passed(left)).toBe(false)

    const broken = await runChecks(
      scripted({
        cleanup: async () => {
          throw new Error('offline')
        },
      }).probe,
      [cell('a', ok(1))],
    )
    expect(broken.leftBehind).toEqual(['the cleanup itself failed: offline'])
    expect(passed(broken)).toBe(false)
  })

  it('never passes a report whose setup failed, whatever else it holds', () => {
    expect(passed({ findings: [{ name: 'a', verdict: 'passed' }], setupError: 'could not make the administrator', leftBehind: [] })).toBe(false)
  })

  it('reports each cell as it is done', async () => {
    const seen: Finding[] = []
    await runChecks(scripted().probe, [cell('a', ok(1)), cell('b', ok(0))], (finding) => seen.push(finding))
    expect(seen.map((f) => `${f.name}:${f.verdict}`)).toEqual(['a:passed', 'b:failed'])
  })
})

describe('formatReport', () => {
  const report: Report = {
    findings: [
      { name: 'tasks · read as a visitor', verdict: 'passed' },
      { name: 'tasks · delete as the employee', verdict: 'failed', detail: 'expected the server to refuse it, but it went through (1 row)' },
      { name: 'auth · nobody can make a user for themselves', verdict: 'skipped', detail: 'not here' },
    ],
    leftBehind: ['the user 123: offline'],
  }

  it('lists what failed, what was skipped and what was left behind, and counts', () => {
    expect(formatReport(report)).toEqual([
      'FAIL  tasks · delete as the employee\n      expected the server to refuse it, but it went through (1 row)',
      'skip  auth · nobody can make a user for themselves\n      not here',
      'LEFT BEHIND: the user 123: offline (delete it by hand)',
      '',
      '1 passed, 1 failed, 1 skipped.',
      'THE CHECK FAILED: do not let other people use the app until this is fixed.',
    ])
  })

  it('says so plainly when everything passed', () => {
    const lines = formatReport({ findings: [{ name: 'a', verdict: 'passed' }], leftBehind: [] })
    expect(lines).toEqual(['', '1 passed, 0 failed, 0 skipped.', 'ALL CHECKS PASSED.'])
  })

  it('says that the setup failed', () => {
    const lines = formatReport({ findings: [], setupError: 'could not make the administrator', leftBehind: [] })
    expect(lines[0]).toBe('SETUP FAILED: could not make the administrator')
    expect(lines.at(-1)).toContain('THE CHECK FAILED')
  })

  it('hides a key that an error message happens to hold', () => {
    const secret = 'sb_secret_abcdefghijklmnop'
    const lines = formatReport(
      {
        findings: [{ name: 'a', verdict: 'failed', detail: `the request with ${secret} failed` }],
        setupError: `could not sign in with ${secret}`,
        leftBehind: [`the user: ${secret}`],
      },
      [secret],
    ).join('\n')
    expect(lines).not.toContain(secret)
    expect(lines).toContain('the request with *** failed')
    expect(lines).toContain('could not sign in with ***')
    expect(lines).toContain('the user: ***')
  })
})

describe('the cells', () => {
  const cells = createCells()
  const names = cells.map((c) => c.name)

  it('have a name each, so that a failure points at one thing', () => {
    expect(new Set(names).size).toBe(names.length)
  })

  it('read every table as every kind of person', () => {
    for (const table of ['tasks', 'attachments', 'task_events', 'profiles', 'statuses', 'app_settings']) {
      for (const who of ['the administrator', 'the employee', 'a colleague', 'a deactivated member', 'a visitor']) {
        expect(names, `${table} as ${who}`).toContain(`${table} · read as ${who}`)
      }
    }
  })

  it('try the writes to every table, the bucket, the live connection and the settings of the sign-in', () => {
    for (const area of ['tasks', 'task_events', 'attachments', 'statuses', 'app_settings', 'storage', 'realtime', 'auth', 'profiles']) {
      expect(names.filter((n) => n.startsWith(`${area} ·`)).length, area).toBeGreaterThanOrEqual(2)
    }
  })

  it('pin what every cell must come to, so that a check is never relaxed by accident', () => {
    expect(cells.map((c) => `${c.expect.padEnd(7)} ${c.name}`)).toMatchInlineSnapshot(`
      [
        "allowed tasks · read as the administrator",
        "allowed tasks · read as the employee",
        "allowed tasks · read as a colleague",
        "nothing tasks · read as a deactivated member",
        "refused tasks · read as a visitor",
        "allowed attachments · read as the administrator",
        "allowed attachments · read as the employee",
        "allowed attachments · read as a colleague",
        "nothing attachments · read as a deactivated member",
        "refused attachments · read as a visitor",
        "allowed task_events · read as the administrator",
        "allowed task_events · read as the employee",
        "allowed task_events · read as a colleague",
        "nothing task_events · read as a deactivated member",
        "refused task_events · read as a visitor",
        "allowed profiles · read as the administrator",
        "allowed profiles · read as the employee",
        "allowed profiles · read as a colleague",
        "nothing profiles · read as a deactivated member",
        "refused profiles · read as a visitor",
        "allowed statuses · read as the administrator",
        "allowed statuses · read as the employee",
        "allowed statuses · read as a colleague",
        "nothing statuses · read as a deactivated member",
        "refused statuses · read as a visitor",
        "allowed app_settings · read as the administrator",
        "allowed app_settings · read as the employee",
        "allowed app_settings · read as a colleague",
        "nothing app_settings · read as a deactivated member",
        "refused app_settings · read as a visitor",
        "allowed tasks · create as the employee under their own name",
        "refused tasks · create as the employee under the name of the administrator",
        "allowed tasks · create as the employee without an author takes the caller",
        "refused tasks · create as a deactivated member",
        "refused tasks · create as a visitor",
        "allowed tasks · edit as the employee",
        "allowed tasks · edit as a colleague",
        "allowed tasks · edit a deleted task as a colleague",
        "nothing tasks · edit as a deactivated member",
        "refused tasks · edit as a visitor",
        "allowed tasks · the author cannot be changed by an edit",
        "allowed tasks · the same change sent twice is the same change",
        "refused tasks · send a change as a deactivated member",
        "refused tasks · delete as the administrator",
        "refused tasks · delete as the employee",
        "refused tasks · delete as a colleague",
        "refused tasks · delete as a deactivated member",
        "refused tasks · delete as a visitor",
        "refused task_events · write as the administrator",
        "refused task_events · change as the administrator",
        "refused task_events · delete as the administrator",
        "refused task_events · write as the employee",
        "refused task_events · change as the employee",
        "refused task_events · delete as the employee",
        "allowed attachments · add as the employee under their own name",
        "refused attachments · add as the employee under the name of somebody else",
        "refused attachments · add as the employee under no name",
        "refused attachments · add as a deactivated member",
        "refused attachments · add as a visitor",
        "refused attachments · change as the employee",
        "allowed attachments · delete as whoever added it",
        "nothing attachments · delete as a colleague who did not add it",
        "allowed attachments · delete as the administrator, whoever added it",
        "nothing attachments · delete as a deactivated member",
        "refused attachments · delete as a visitor",
        "allowed statuses · add as the administrator",
        "refused statuses · add as the employee",
        "refused statuses · add as a visitor",
        "nothing statuses · change as the employee",
        "nothing statuses · delete as the employee",
        "allowed statuses · change as the administrator",
        "allowed statuses · delete as the administrator",
        "allowed app_settings · add as the administrator",
        "refused app_settings · add as the employee",
        "refused app_settings · add as a visitor",
        "nothing app_settings · change as the employee",
        "nothing app_settings · delete as the employee",
        "allowed app_settings · change as the administrator",
        "allowed app_settings · delete as the administrator",
        "allowed storage · upload a JPEG as the employee",
        "blocked storage · upload a JPEG as a deactivated member",
        "blocked storage · upload a JPEG as a visitor",
        "blocked storage · upload what is not a JPEG",
        "blocked storage · upload a file of more than 5 MB",
        "blocked storage · overwrite a file",
        "allowed storage · open a file as the employee",
        "allowed storage · open a file as a colleague",
        "allowed storage · open a file as the administrator",
        "blocked storage · open a file as a deactivated member",
        "blocked storage · open a file as a visitor",
        "blocked storage · a file cannot be opened by a public address",
        "allowed storage · delete a file as whoever uploaded it",
        "blocked storage · delete a file as a colleague who did not upload it",
        "allowed storage · delete a file as the administrator",
        "blocked storage · delete a file as a deactivated member",
        "blocked storage · delete a file as a visitor",
        "allowed realtime · a change of a task reaches the employee",
        "blocked realtime · a change of a task does not reach a deactivated member",
        "blocked realtime · a change of a task does not reach a visitor",
        "refused auth · nobody can make a user for themselves",
        "refused auth · a password of 9 characters is refused",
        "allowed profiles · a member changes their own name and reminder through the function",
        "refused profiles · a deactivated member cannot change their name through the function",
        "refused profiles · a visitor cannot change a name through the function",
        "allowed profiles · a member clears their own must-change-password mark",
        "refused profiles · a visitor cannot clear the mark",
        "refused profiles · a member cannot make a profile",
        "refused profiles · an administrator cannot delete a profile",
        "refused profiles · an employee cannot make themselves an administrator",
        "refused profiles · an administrator cannot change the role of a colleague directly",
        "blocked profiles · a deactivated member cannot switch themselves on",
      ]
    `)
  })

  it('put the cells that change who is who last, and the one that switches a member on at the very end', () => {
    const firstProfileWrite = names.findIndex((n) => n.startsWith('profiles · a member changes'))
    expect(names.slice(firstProfileWrite).every((n) => n.startsWith('profiles ·'))).toBe(true)
    expect(names.at(-1)).toBe('profiles · a deactivated member cannot switch themselves on')
  })
})

describe('against the migrations', () => {
  it('passes the database as it is, with every cell tried and only the settings of the sign-in left out', async () => {
    const db = await createDb()
    const report = await runChecks(createPgliteProbe(db))

    expect(report.setupError).toBeUndefined()
    expect(report.leftBehind).toEqual([])
    expect(report.findings.filter((f) => f.verdict === 'failed')).toEqual([])
    expect(report.findings.filter((f) => f.verdict === 'skipped').map((f) => f.name)).toEqual([
      'auth · nobody can make a user for themselves',
      'auth · a password of 9 characters is refused',
    ])
    expect(report.findings.map((f) => f.name)).toEqual(createCells().map((c) => c.name))
    expect(passed(report)).toBe(true)
    expect(formatReport(report).at(-1)).toBe('ALL CHECKS PASSED.')
  })

  it('does not pass, and tries nothing, when the database is not set up', async () => {
    const db = await createDb()
    await db.exec('drop table public.tasks cascade')
    const report = await runChecks(createPgliteProbe(db))
    expect(report.setupError).toMatch(/tasks/)
    expect(report.findings).toEqual([])
    expect(passed(report)).toBe(false)
  })
})
