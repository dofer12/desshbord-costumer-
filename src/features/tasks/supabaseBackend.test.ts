import 'fake-indexeddb/auto'
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { createSupabaseBackend } from './supabaseBackend'

function backend() {
  const client = createClient('https://probe.supabase.co', 'sb_publishable_test', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return createSupabaseBackend(client)
}

describe('the backend of the real app', () => {
  it('has the three gateways', () => {
    const b = backend()
    expect(Object.keys(b.tasks).sort()).toEqual(['loadHistory', 'loadInitial', 'search', 'subscribe', 'upsert'])
    expect(Object.keys(b.directory).sort()).toEqual(['load', 'subscribe'])
    expect(Object.keys(b.attachments).sort()).toEqual(['add', 'list', 'remove', 'signedUrl'])
  })

  it('keeps the waiting changes of each person apart, and the same for the same person on a restart', async () => {
    const b = backend()
    const entry = { id: 'task-1', patch: { title: 'x' }, queuedAt: 1, attempts: 0 }
    await b.outbox('dana').save([entry])
    expect(await b.outbox('avi').load()).toEqual([])
    expect(await backend().outbox('dana').load()).toEqual([entry])
  })
})
