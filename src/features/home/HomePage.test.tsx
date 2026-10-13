import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { DANA, OWNER } from '../../test/fakeGateway'
import { renderApp } from '../../test/renderApp'

describe('HomePage', () => {
  it('greets the user and shows the role, app version and server', async () => {
    renderApp({ configure: (fake) => fake.getStoredUserId.mockResolvedValue(DANA.id) })
    expect(await screen.findByRole('heading', { name: 'שלום, דנה' })).toBeInTheDocument()
    expect(screen.getByText('תפקיד: עובד')).toBeInTheDocument()
    expect(screen.getByText('test.supabase.co')).toBeInTheDocument()
    expect(screen.getByText(__APP_VERSION__)).toBeInTheDocument()
  })

  it('labels an admin as a manager', async () => {
    renderApp({
      configure: (fake) => {
        fake.getStoredUserId.mockResolvedValue(OWNER.id)
        fake.fetchProfile.mockResolvedValue(OWNER)
      },
    })
    expect(await screen.findByText('תפקיד: מנהל')).toBeInTheDocument()
  })

  it('signs out and returns to the login screen without an error message', async () => {
    const { fake } = renderApp({ configure: (f) => f.getStoredUserId.mockResolvedValue(DANA.id) })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'התנתקות' }))
    expect(await screen.findByRole('button', { name: 'כניסה' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(fake.signOut).toHaveBeenCalledTimes(1)
  })
})
