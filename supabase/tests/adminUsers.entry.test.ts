// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The entry of the function runs under Deno, which is not installed here, so it cannot be run by a test.
// What can be pinned is what it is made of: the facts about it that a mistake in an edit would break, and
// that matter for the secret key that it holds. The deployed function is what the live check (Task 13) runs.

const FUNCTION_DIR = join(import.meta.dirname, '..', 'functions', 'admin-users')
const source = (file: string) => readFileSync(join(FUNCTION_DIR, file), 'utf8')
const files = readdirSync(FUNCTION_DIR).filter((f) => f.endsWith('.ts'))

describe('the entry of the function', () => {
  const entry = source('index.ts')

  it('serves the handler, once', () => {
    expect(entry.match(/Deno\.serve\(/g)).toHaveLength(1)
    expect(entry).toMatch(/createHandler\(/)
    expect(entry).toMatch(/from '\.\/handler\.ts'/)
    expect(entry).toMatch(/from '\.\/supabaseDeps\.ts'/)
  })

  it('makes its client from the address of the project and the secret key of its environment, with no session of its own', () => {
    expect(entry).toMatch(/Deno\.env\.get\('SUPABASE_URL'\)/)
    expect(entry).toMatch(/readSecretKey\(\(name\) => Deno\.env\.get\(name\)\)/)
    expect(entry).toMatch(/persistSession: false/)
    expect(entry).toMatch(/autoRefreshToken: false/)
    // It makes the services for each request, so that what is wrong with the environment shows as that request's failure.
    expect(entry).toMatch(/makeDeps\(\)/)
  })

  it('uses the CORS headers of the library, which are kept to what the library sends', () => {
    expect(entry).toMatch(/import \{ corsHeaders \} from '@supabase\/supabase-js\/cors'/)
    expect(entry).toMatch(/cors: corsHeaders/)
  })

  it('writes to the log only what the rules wrote, with the name of the function', () => {
    expect(entry).toMatch(/log: \(line\) => console\.log\(JSON\.stringify\(\{ fn: 'admin-users', \.\.\.line \}\)\)/)
    expect(entry.match(/console\./g)).toHaveLength(1)
  })

  it('reads no other name of the environment than the address of the project', () => {
    expect(entry.match(/Deno\.env\.get\(/g)).toHaveLength(2)
    expect([...entry.matchAll(/Deno\.env\.get\('([A-Z_]+)'\)/g)].map((m) => m[1])).toEqual(['SUPABASE_URL'])
  })

  it('is given the libraries by name, from the file deno.json beside it, in the version of the one that the app uses', () => {
    const map = JSON.parse(source('deno.json')) as { imports: Record<string, string> }
    expect(map.imports).toEqual({
      '@supabase/supabase-js': 'npm:@supabase/supabase-js@2',
      '@supabase/supabase-js/cors': 'npm:@supabase/supabase-js@2/cors',
    })
    const app = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8')) as { devDependencies: Record<string, string> }
    expect(app.devDependencies['@supabase/supabase-js']).toMatch(/^\^?2\./)
  })
})

describe('the files of the function', () => {
  it('hold no key, no token and no address of a project', () => {
    for (const file of [...files, 'deno.json']) {
      const text = source(file)
      expect(text, file).not.toMatch(/sb_secret_|sb_publishable_/)
      expect(text, file).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/)
      expect(text, file).not.toMatch(/https:\/\/[a-z0-9]{20}\.supabase\.co/)
    }
  })

  it('import nothing from the app, and only the one library from outside', () => {
    for (const file of files) {
      const imports = [...source(file).matchAll(/^import (?:type )?[^'"]*from '([^']+)'/gm)].map((m) => m[1])
      for (const from of imports) {
        expect(from, `${file} imports ${from}`).toMatch(/^(\.\/[A-Za-z]+\.ts|@supabase\/supabase-js(\/cors)?)$/)
      }
    }
  })

  it('have the rules written with no import at all and no API of Deno or Node, so that they run anywhere', () => {
    const logic = source('logic.ts')
    expect(logic).not.toMatch(/^import /m)
    expect(logic).not.toMatch(/\bDeno\b|\bprocess\b|\brequire\(|\bcrypto\b|\bconsole\b|\bsetTimeout\b|\bfetch\(/)
  })

  it('log nothing but a fixed word when they fail, in the HTTP layer', () => {
    const handler = source('handler.ts')
    expect(handler.match(/console\./g)).toHaveLength(1)
    expect(handler).toMatch(/console\.error\('admin-users: failed'\)/)
  })
})
