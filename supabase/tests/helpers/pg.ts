import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach } from 'vitest'

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'migrations')

/** The few pieces of Supabase that the migrations depend on, stubbed for PGlite. */
const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
-- The role of the secret key, which the Edge Functions use.
create role service_role nologin;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- Only what the migrations use of GoTrue's table of sessions: whose it is.
create table auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema public to anon, authenticated;
-- Column defaults such as auth.uid() run as the calling role, which therefore needs the schema.
grant usage on schema auth to anon, authenticated;

-- Supabase hands every new table, function and sequence in public to the two API roles, and a
-- migration takes away what the app must not have. The stub does the same, so that a revoke
-- which was forgotten shows up in the tests.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;

-- The parts of Supabase Storage that a file bucket and its policies use.
create schema storage;
grant usage on schema storage to anon, authenticated;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets (id),
  name text not null,
  owner_id text,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;
grant all on table storage.objects to anon, authenticated;

-- The publication that Supabase Realtime reads. It starts empty.
create publication supabase_realtime;
`

// Every test starts its own Postgres, which is a WebAssembly instance of some size. They are closed
// after each test, so that a long run does not keep hundreds of them alive.
const open: PGlite[] = []
afterEach(async () => {
  await Promise.all(open.splice(0).map((db) => db.close().catch(() => undefined)))
})

/**
 * A fresh in-memory Postgres with the Supabase stub and every migration applied.
 * `seed` runs before the migrations, to model data that existed beforehand.
 */
export async function createDb(seed?: (db: PGlite) => Promise<void>): Promise<PGlite> {
  const db = new PGlite()
  open.push(db)
  await db.exec(SUPABASE_STUB)
  await seed?.(db)
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  for (const f of files) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  }
  return db
}

export type Actor = { id: string } | 'anon'

/** Runs `fn` with the connection acting as the given Supabase role, then restores superuser. */
export async function as<T>(db: PGlite, actor: Actor, fn: () => Promise<T>): Promise<T> {
  const sub = actor === 'anon' ? '' : actor.id
  const role = actor === 'anon' ? 'anon' : 'authenticated'
  await db.exec(`set role ${role}`)
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub])
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
  }
}

export async function addUser(
  db: PGlite,
  email: string,
  opts: { meta?: Record<string, unknown>; appMeta?: Record<string, unknown> } = {},
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data, raw_app_meta_data)
     values ($1, $2::jsonb, $3::jsonb) returning id`,
    [email, JSON.stringify(opts.meta ?? {}), JSON.stringify(opts.appMeta ?? {})],
  )
  return r.rows[0].id
}
