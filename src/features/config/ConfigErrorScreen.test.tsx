import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConfigErrorScreen } from './ConfigErrorScreen'

describe('ConfigErrorScreen', () => {
  it('says the app is not configured, shows what is missing, and points to the guide', () => {
    render(<ConfigErrorScreen message="חסרה כתובת השרת (VITE_SUPABASE_URL)." />)
    expect(screen.getByRole('heading', { name: 'האפליקציה עדיין לא הוגדרה' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('VITE_SUPABASE_URL')
    expect(screen.getByText('docs/setup-he.md')).toBeInTheDocument()
  })
})
