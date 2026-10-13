import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

// Proves the test toolchain (Vitest, jsdom, Testing Library, jest-dom) is wired up.
describe('toolchain', () => {
  it('renders Hebrew text into jsdom and finds it again', () => {
    render(<p dir="rtl">שלום</p>)
    expect(screen.getByText('שלום')).toBeInTheDocument()
  })
})
