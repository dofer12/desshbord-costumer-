// @vitest-environment node
import { build } from 'vite'
import { describe, expect, it } from 'vitest'

/** The demo profile's address: it appears in a bundle only when the demo gateway is in it. */
const DEMO_MARKER = 'demo@moked.invalid'

interface BuiltChunk {
  code?: string
}
interface BuiltBundle {
  output: BuiltChunk[]
}

/** Builds the app in memory and says whether the demo gateway ended up in what it would publish. */
async function bundleHasDemo(mode: string): Promise<boolean> {
  const result = (await build({ mode, logLevel: 'silent', build: { write: false } })) as BuiltBundle | BuiltBundle[]
  return [result].flat().some((bundle) => bundle.output.some((chunk) => (chunk.code ?? '').includes(DEMO_MARKER)))
}

// A demo build opens without a server and without a user. It must never be possible to ship one,
// so this runs the real production build and looks inside what it would publish.
describe('demo mode in a build', () => {
  it('is left out of a production build, which is what every release is made with', async () => {
    expect(await bundleHasDemo('production')).toBe(false)
  }, 60_000)

  it('is part of a build made with --mode demo', async () => {
    expect(await bundleHasDemo('demo')).toBe(true)
  }, 60_000)
})
