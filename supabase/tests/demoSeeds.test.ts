// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { demoStatuses } from '../../src/features/demo/demoBackend'
import { FAKE_STATUSES } from '../../src/test/fakeTasksGateways'

// The demo carries its own copy of the 17 statuses, so that it can run with no server. These tests
// hold the copy against the statuses that the database really starts with.

const migration = readFileSync(join(import.meta.dirname, '..', 'migrations', '0002_core.sql'), 'utf8')

/** The rows of `insert into public.statuses (key, name_he, color, sort) values ...` in the migration. */
function seededStatuses() {
  const rows = [...migration.matchAll(/\('([^']+)', '([^']+)', '(#[0-9a-f]{6})', (\d+)\)/g)]
  return rows.map(([, key, name_he, color, sort]) => ({ key, name_he, color, sort: Number(sort), is_active: true }))
}

describe('the statuses of the demo', () => {
  it('are the statuses that the migration seeds, with the same names, colours and order', () => {
    expect(seededStatuses()).toHaveLength(17)
    expect(demoStatuses()).toEqual(seededStatuses())
  })

  it('include every status that the fakes of the tests use, with the same name and colour', () => {
    for (const status of FAKE_STATUSES) {
      expect(demoStatuses()).toContainEqual(status)
    }
  })
})
