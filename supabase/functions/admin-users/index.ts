// The entry of the Edge Function admin-users, for Deno (Supabase Edge Functions). It is the only file
// that reads the environment of the function: the address of the project and, through readSecretKey, its
// secret key. Everything else is in the files beside it, and those are tested: logic.ts (the rules),
// handler.ts (the HTTP layer) and supabaseDeps.ts (the services over the Supabase client).
//
// The function is deployed with verify_jwt on, which is the default: the platform checks the token before
// the function runs, and the rules check it again, with the profile of whoever it belongs to.

import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '@supabase/supabase-js/cors'
import { createHandler } from './handler.ts'
import { createSupabaseDeps, readSecretKey } from './supabaseDeps.ts'

// Deno is there at run time. The Node project that type-checks this file has no types for it.
declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (request: Request) => Response | Promise<Response>): unknown
}

Deno.serve(
  createHandler({
    cors: corsHeaders,
    makeDeps() {
      const url = Deno.env.get('SUPABASE_URL')
      if (!url) throw new Error('The function has no project address.')
      // A client with no session of its own: it acts as the project, with the secret key, for this one request.
      const admin = createClient(url, readSecretKey((name) => Deno.env.get(name)), {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
      return createSupabaseDeps(admin, {
        randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
        log: (line) => console.log(JSON.stringify({ fn: 'admin-users', ...line })),
      })
    },
  }),
)
