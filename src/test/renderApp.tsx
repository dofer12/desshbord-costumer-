import { render } from '@testing-library/react'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router'
import { App } from '../App'
import { AuthProvider } from '../features/auth/AuthProvider'
import { createAuthStore } from '../features/auth/authStore'
import { BackendContext } from '../features/tasks/backend'
import { createFakeBackend, type FakeBackend } from './fakeBackend'
import { createFakeGateway, type FakeGateway } from './fakeGateway'

interface RenderOptions {
  /** Initial route, default "/". */
  path?: string
  /** Adjust the fake backend of the login before the store starts. */
  configure?: (fake: FakeGateway) => void
  /** Adjust the fake backend of the tasks before the app starts. */
  configureBackend?: (fake: FakeBackend) => void
  /** Set to false to leave the store in its initial "loading" state. */
  init?: boolean
  /**
   * Renders under a router that can hold a navigation back and be told to go back (as the app runs), and
   * returns it. The others are the router of the tests, which cannot: the app has to cope with both.
   */
  dataRouter?: boolean
}

/** Renders the whole app against a fake backend. `ready` resolves when start-up has settled. */
export function renderApp(options: RenderOptions = {}) {
  const fake = createFakeGateway()
  options.configure?.(fake)
  const backend = createFakeBackend()
  options.configureBackend?.(backend)
  const store = createAuthStore(fake.gateway)
  const ready = options.init === false ? Promise.resolve() : store.getState().init()
  const router = options.dataRouter
    ? createMemoryRouter([{ path: '*', element: <App serverHost="test.supabase.co" /> }], { initialEntries: [options.path ?? '/'] })
    : undefined
  render(
    <AuthProvider store={store}>
      <BackendContext value={backend.backend}>
        {router ? (
          <RouterProvider router={router} />
        ) : (
          <MemoryRouter initialEntries={[options.path ?? '/']}>
            <App serverHost="test.supabase.co" />
          </MemoryRouter>
        )}
      </BackendContext>
    </AuthProvider>,
  )
  return { fake, store, ready, backend, router }
}
