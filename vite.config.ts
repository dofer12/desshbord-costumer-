import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths so the same build runs on a web server, inside the
  // Android WebView (https://localhost) and from file:// in Electron.
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'supabase/tests/**/*.test.ts', 'scripts/**/*.test.ts'],
    // Every database test starts its own Postgres (WebAssembly), which on a busy machine can take
    // longer than Vitest's default limits of 5 s for a test and 10 s for a hook.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
