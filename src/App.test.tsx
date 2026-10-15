import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AUTH_MESSAGES } from './features/auth/errors'
import { DANA, type FakeGateway } from './test/fakeGateway'
import { renderApp } from './test/renderApp'

/** The frame of the app. It is there only while somebody is signed in (the login screen has no tabs). */
const findSignedInApp = () => screen.findByRole('navigation', { name: 'ניווט ראשי' })

function signedInAsDana(fake: FakeGateway) {
  fake.getStoredUserId.mockResolvedValue(DANA.id)
}

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
    expect(screen.queryByRole('navigation', { name: 'ניווט ראשי' })).not.toBeInTheDocument()
  })

  it('sends a signed-in user from the home route to the tasks screen', async () => {
    renderApp({ path: '/', configure: signedInAsDana })
    await findSignedInApp()
    expect(screen.getByRole('link', { name: 'משימות' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { level: 2, name: 'משימות' })).toBeInTheDocument()
  })

  it('redirects unknown routes to the tasks screen', async () => {
    renderApp({ path: '/nope', configure: signedInAsDana })
    await findSignedInApp()
    expect(screen.getByRole('link', { name: 'משימות' })).toHaveAttribute('aria-current', 'page')
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
    await findSignedInApp()
  })

  it('returns to the login screen with a message when the server ends the session', async () => {
    const { fake } = renderApp({ configure: signedInAsDana })
    await findSignedInApp()

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

describe('the tasks of the signed-in user', () => {
  it('are loaded once the user is in, and listened to', async () => {
    const { backend } = renderApp({ configure: signedInAsDana })
    await findSignedInApp()
    await vi.waitFor(() => expect(backend.tasks.calls.loadInitial).toBe(1))
    expect(backend.tasks.subscribers).toBe(1)
  })

  it('are let go when the user signs out from the menu, and the login screen has no error', async () => {
    const { fake, backend } = renderApp({ configure: signedInAsDana })
    await findSignedInApp()
    await vi.waitFor(() => expect(backend.tasks.subscribers).toBe(1))

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: DANA.display_name }))
    await user.click(screen.getByRole('button', { name: 'התנתקות' }))

    expect(await screen.findByRole('button', { name: 'כניסה' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(fake.signOut).toHaveBeenCalledTimes(1)
    expect(backend.tasks.subscribers).toBe(0)
  })
})
