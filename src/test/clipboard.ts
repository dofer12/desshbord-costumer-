import { vi, type Mock } from 'vitest'

/**
 * Puts a clipboard in place that remembers what was written, or refuses to. Call it after
 * `userEvent.setup()`, which puts a clipboard of its own in place and would replace this one.
 */
export function stubClipboard(behavior: 'works' | 'refuses' = 'works'): Mock<(text: string) => Promise<void>> {
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => {
    if (behavior === 'refuses') throw new DOMException('Not allowed', 'NotAllowedError')
  })
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}
