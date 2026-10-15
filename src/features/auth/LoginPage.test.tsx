import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { DANA, type FakeGateway } from '../../test/fakeGateway'
import { renderApp } from '../../test/renderApp'
import { AUTH_MESSAGES } from './errors'

/** The frame of the app: it is there only once somebody is signed in. */
const findSignedInApp = () => screen.findByRole('navigation', { name: 'ניווט ראשי' })

async function openLogin(configure?: (fake: FakeGateway) => void) {
  const app = renderApp({ path: '/login', configure })
  await app.ready
  await screen.findByRole('button', { name: 'כניסה' })
  return { ...app, user: userEvent.setup() }
}

describe('LoginPage', () => {
  it('shows the Hebrew login form', async () => {
    await openLogin()
    expect(screen.getByRole('heading', { name: 'יומן משימות מוקד' })).toBeInTheDocument()
    expect(screen.getByLabelText('אימייל')).toBeInTheDocument()
    expect(screen.getByLabelText('סיסמה')).toBeInTheDocument()
  })

  it('configures the fields for phone keyboards and password managers', async () => {
    await openLogin()
    const email = screen.getByLabelText('אימייל')
    expect(email).toHaveAttribute('type', 'email')
    expect(email).toHaveAttribute('autocomplete', 'username')
    expect(email).toHaveAttribute('inputmode', 'email')
    expect(email).toHaveAttribute('autocapitalize', 'none')
    expect(email).toHaveAttribute('autocorrect', 'off')
    expect(email).toHaveAttribute('dir', 'ltr')
    const password = screen.getByLabelText('סיסמה')
    expect(password).toHaveAttribute('type', 'password')
    expect(password).toHaveAttribute('autocomplete', 'current-password')
    expect(password).toHaveAttribute('dir', 'ltr')
  })

  it('asks for both fields, focuses the first, and does not call the server', async () => {
    const { fake, user } = await openLogin()
    await user.click(screen.getByRole('button', { name: 'כניסה' }))
    expect(screen.getByText('הזינו כתובת אימייל.')).toBeInTheDocument()
    expect(screen.getByText('הזינו סיסמה.')).toBeInTheDocument()
    expect(screen.getByLabelText('אימייל')).toHaveFocus()
    expect(screen.getByLabelText('אימייל')).toBeInvalid()
    expect(fake.signIn).not.toHaveBeenCalled()
  })

  it('rejects an email that is not shaped like one', async () => {
    const { fake, user } = await openLogin()
    await user.type(screen.getByLabelText('אימייל'), 'dana')
    await user.type(screen.getByLabelText('סיסמה'), 'secret')
    await user.click(screen.getByRole('button', { name: 'כניסה' }))
    expect(screen.getByText('כתובת האימייל אינה תקינה.')).toBeInTheDocument()
    expect(fake.signIn).not.toHaveBeenCalled()
  })

  it('signs in with a normalised email when Enter is pressed, then shows the app', async () => {
    const { fake, user } = await openLogin()
    await user.type(screen.getByLabelText('אימייל'), '  Dana@Example.com ')
    await user.type(screen.getByLabelText('סיסמה'), 'secret{Enter}')
    expect(await findSignedInApp()).toBeInTheDocument()
    expect(fake.signIn).toHaveBeenCalledWith('dana@example.com', 'secret')
  })

  it('shows the server error and keeps the form usable', async () => {
    const { user } = await openLogin((fake) => fake.signIn.mockRejectedValue({ code: 'invalid_credentials' }))
    await user.type(screen.getByLabelText('אימייל'), 'dana@example.com')
    await user.type(screen.getByLabelText('סיסמה'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'כניסה' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.invalidCredentials)
    expect(screen.getByRole('button', { name: 'כניסה' })).toBeEnabled()
    expect(screen.getByLabelText('אימייל')).toHaveValue('dana@example.com')
  })

  it('disables the button while signing in and sends a single request for a double click', async () => {
    let release: (id: string) => void = () => {}
    const { fake, user } = await openLogin((f) =>
      f.signIn.mockImplementation(() => new Promise<string>((resolve) => (release = resolve))),
    )
    await user.type(screen.getByLabelText('אימייל'), 'dana@example.com')
    await user.type(screen.getByLabelText('סיסמה'), 'secret')
    await user.dblClick(screen.getByRole('button', { name: 'כניסה' }))
    expect(await screen.findByRole('button', { name: 'מתחבר…' })).toBeDisabled()

    release(DANA.id)
    await findSignedInApp()
    expect(fake.signIn).toHaveBeenCalledTimes(1)
  })

  it('sends a visitor with a stored session straight into the app', async () => {
    renderApp({ path: '/login', configure: (fake) => fake.getStoredUserId.mockResolvedValue(DANA.id) })
    expect(await findSignedInApp()).toBeInTheDocument()
  })
})
