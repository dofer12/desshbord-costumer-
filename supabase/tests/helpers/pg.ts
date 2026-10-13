import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'migrations')

/** The few pieces of Supabase that the migrations depend on, stubbed for PGlite. */
const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema public to anon, authenticated;
`

/**
 * A fresh in-memory Postgres with the Supabase stub and every migration applied.
 * `seed` runs before the migrations, to model data that existed beforehand.
 */
export async function createDb(seed?: (db: PGlite) => Promise<void>): Promise<PGlite> {
  const db = new PGlite()
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
