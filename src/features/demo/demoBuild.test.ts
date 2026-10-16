// @vitest-environment node
import { build } from 'vite'
import { describe, expect, it } from 'vitest'

/**
 * Texts that appear in a bundle only when the demo is in it: the address of the demo profile (the
 * demo gateway), the name of the first sample customer and the id of the sample picture (the demo
 * backend). Keep them in step with demoGateway.ts and demoBackend.ts.
 */
const DEMO_MARKERS = ['demo@moked.invalid', 'לקוח לדוגמה א׳', 'demo-pickup-photo']

interface BuiltChunk {
  code?: string
}
interface BuiltBundle {
  output: BuiltChunk[]
}

/** Builds the app in memory and lists which parts of the demo ended up in what it would publish. */
async function demoPartsIn(mode: string): Promise<string[]> {
  const result = (await build({ mode, logLevel: 'silent', build: { write: false } })) as BuiltBundle | BuiltBundle[]
  const code = [result].flat().flatMap((bundle) => bundle.output.map((chunk) => chunk.code ?? ''))
  return DEMO_MARKERS.filter((marker) => code.some((chunk) => chunk.includes(marker)))
}

// A demo build opens without a server and without a user. It must never be possible to ship one,
// so this runs the real production build and looks inside what it would publish.
describe('demo mode in a build', () => {
  it('is left out of a production build, which is what every release is made with', async () => {
    expect(await demoPartsIn('production')).toEqual([])
  }, 60_000)

  it('is part of a build made with --mode demo, the gateway and the sample data both', async () => {
    expect(await demoPartsIn('demo')).toEqual(DEMO_MARKERS)
  }, 60_000)
})
