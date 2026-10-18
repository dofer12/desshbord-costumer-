import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

/**
 * The Content-Security-Policy of the page: what it may load and where it may connect. Scripts and everything
 * else come from the page itself; connections go to the project (https, and the live connection over wss)
 * and to the list of releases (the check for an update); pictures also come from the project (the pictures
 * of the tasks are signed addresses of its storage), from data: and from blob: (a picture that was just taken).
 * Styles may be inline, since the screens position things with the style attribute. No objects, no frames.
 * `supabaseUrl` is the address of the project that the build is for; without it the page connects to nothing else.
 */
export function contentSecurityPolicy(supabaseUrl: string | undefined): string {
  let project: URL | null = null
  try {
    project = supabaseUrl ? new URL(supabaseUrl) : null
  } catch {
    project = null
  }
  const connect = ["'self'", ...(project ? [project.origin, `wss://${project.host}`] : []), 'https://api.github.com']
  const images = ["'self'", 'data:', 'blob:', ...(project ? [project.origin] : [])]
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${images.join(' ')}`,
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}

/** Writes the policy into the page of every build (not into the page of the dev server, which needs inline scripts to reload). */
function securityPolicy(mode: string): Plugin {
  return {
    name: 'moked-content-security-policy',
    apply: 'build',
    transformIndexHtml() {
      const env = loadEnv(mode, process.cwd(), 'VITE_')
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy(env.VITE_SUPABASE_URL) },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // Relative asset paths so the same build runs on a web server, inside the
  // Android WebView (https://localhost) and from file:// in Electron.
  base: './',
  plugins: [react(), securityPolicy(mode)],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'supabase/tests/**/*.test.ts', 'scripts/**/*.test.ts', 'electron/**/*.test.ts'],
    // Every database test starts its own Postgres (WebAssembly), which on a busy machine can take
    // longer than Vitest's default limits of 5 s for a test and 10 s for a hook.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
}))
