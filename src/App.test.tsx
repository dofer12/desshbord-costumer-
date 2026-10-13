import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AUTH_MESSAGES } from './features/auth/errors'
import { DANA } from './test/fakeGateway'
import { renderApp } from './test/renderApp'

describe('App routing', () => {
  it('shows a loading screen until start-up has settled', () => {
    renderApp({ init: false })
    expect(screen.getByRole('status')).toHaveTextContent('טוען…')
    expect(screen.queryByLabelText('אימייל')).not.toBeInTheDocument()
  })

  it('sends a signed-out visitor from the home route to the login screen', async () => {
    const { ready } = renderApp({ path: '/' })
    await ready
    expect(await screen.findByRole('button', { name: 'כניסה' })).toBeInTheDocument()
  })

  it('redirects unknown routes to the home screen', async () => {
    renderApp({ path: '/nope', configure: (fake) => fake.getStoredUserId.mockResolvedValue(DANA.id) })
    expect(await screen.findByRole('heading', { name: 'שלום, דנה' })).toBeInTheDocument()
  })

  it('keeps the stored session when the server cannot be reached, and recovers on retry', async () => {
    const { fake } = renderApp({
      configure: (f) => {
        f.getStoredUserId.mockResolvedValue(DANA.id)
        f.fetchProfile.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      },
    })
    expect(await screen.findByRole('heading', { name: 'אין חיבור לשרת' })).toBeInTheDocument()
    expect(screen.queryByLabelText('אימייל')).not.toBeInTheDocument()
    expect(fake.signOut).not.toHaveBeenCalled()

    await userEvent.setup().click(screen.getByRole('button', { name: 'נסו שוב' }))
    expect(await screen.findByRole('heading', { name: 'שלום, דנה' })).toBeInTheDocument()
  })

  it('returns to the login screen with a message when the server ends the session', async () => {
    const { fake } = renderApp({ configure: (f) => f.getStoredUserId.mockResolvedValue(DANA.id) })
    await screen.findByRole('heading', { name: 'שלום, דנה' })

    act(() => fake.endSessionFromServer())

    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.sessionEnded)
    expect(screen.getByRole('button', { name: 'כניסה' })).toBeInTheDocument()
  })

  it('explains why a stored session without an active profile was dropped', async () => {
    renderApp({
      configure: (f) => {
        f.getStoredUserId.mockResolvedValue(DANA.id)
        f.fetchProfile.mockResolvedValue({ ...DANA, is_active: false })
      },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.notMember)
  })
})
