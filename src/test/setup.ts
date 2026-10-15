import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
  // jsdom has neither of these; a test that puts one in place does not leave it for the next.
  // (The tests that run in plain Node, with no window, have nothing to take away.)
  if (typeof window !== 'undefined') {
    Reflect.deleteProperty(window.navigator, 'clipboard')
    Reflect.deleteProperty(window, 'matchMedia')
  }
})
