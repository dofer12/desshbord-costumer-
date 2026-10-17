import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import { createAuthStore } from '../auth/authStore'
import { createFakeGateway, DANA, OWNER } from '../../test/fakeGateway'
import type { Profile } from '../auth/types'
import { RequireAdmin } from './RequireAdmin'

// The door of the Admin area. It reads the role from the profile that the app holds, so a person whose
// role changes while the app is open is let in, or sent out, as soon as the app reads the profile again.

async function setup(profile: Profile) {
  const gateway = createFakeGateway()
  gateway.getStoredUserId.mockResolvedValue(profile.id)
  gateway.fetchProfile.mockResolvedValue(profile)
  const store = createAuthStore(gateway.gateway)
  await store.getState().init()
  render(
    <AuthProvider store={store}>
      <MemoryRouter initialEntries={['/admin/people']}>
        <Routes>
          <Route element={<RequireAdmin />}>
            <Route path="admin/people" element={<p>the page of the people</p>} />
          </Route>
          <Route path="today" element={<p>the page of today</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
  return { gateway, store }
}

describe('RequireAdmin', () => {
  it('lets an administrator through', async () => {
    await setup(OWNER)
    expect(screen.getByText('the page of the people')).toBeInTheDocument()
  })

  it('sends an employee to Today, and shows them nothing of the page', async () => {
    await setup(DANA)
    expect(screen.getByText('the page of today')).toBeInTheDocument()
    expect(screen.queryByText('the page of the people')).not.toBeInTheDocument()
  })

  it('sends an administrator away as soon as their role is an employee\'s', async () => {
    const { store } = await setup(OWNER)
    expect(screen.getByText('the page of the people')).toBeInTheDocument()
    act(() => store.setState({ profile: { ...OWNER, role: 'employee' } }))
    expect(screen.getByText('the page of today')).toBeInTheDocument()
    expect(screen.queryByText('the page of the people')).not.toBeInTheDocument()
  })

  it('does not take an unknown role for an administrator', async () => {
    await setup({ ...OWNER, role: 'superuser' } as unknown as Profile)
    expect(screen.getByText('the page of today')).toBeInTheDocument()
  })

  it('does not let anybody through when there is no profile', async () => {
    const { store } = await setup(OWNER)
    act(() => store.setState({ profile: null }))
    expect(screen.getByText('the page of today')).toBeInTheDocument()
  })
})
