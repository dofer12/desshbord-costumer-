import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DemoBanner } from './DemoBanner'

describe('DemoBanner', () => {
  it('says plainly that this is a demo with no server behind it', () => {
    render(<DemoBanner />)
    const note = screen.getByRole('note')
    expect(note).toHaveTextContent('מצב הדגמה')
    expect(note).toHaveTextContent('לא מחוברת לשרת')
  })
})
