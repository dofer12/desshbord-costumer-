import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router'
import { App } from './App'
import { AuthProvider } from './features/auth/AuthProvider'
import { createAuthStore, type AuthStore } from './features/auth/authStore'
import { createSupabaseGateway } from './features/auth/supabaseGateway'
import { ConfigErrorScreen } from './features/config/ConfigErrorScreen'
import { DemoBanner } from './features/demo/DemoBanner'
import { createDemoBackend, createDemoDirectory } from './features/demo/demoBackend'
import { createDemoGateway } from './features/demo/demoGateway'
import { createMemoryNotifier, type Notifier } from './features/schedule/notifier'
import { NotifierContext } from './features/schedule/remindersContext'
import { BackendContext, type Backend } from './features/tasks/backend'
import { createSupabaseBackend } from './features/tasks/supabaseBackend'
import { ConfigError, loadConfig } from './lib/config'
import { createSupabaseClient } from './lib/supabase'
import './styles/fonts'
import './styles/tokens.css'
import './styles/base.css'

const root = createRoot(document.getElementById('root')!)

function mount(store: AuthStore, backend: Backend, serverHost: string, demo?: { notifier: Notifier }) {
  void store.getState().init()
  // A router that can hold a navigation back (a data router), so that the card of a task can ask before
  // the Back button throws away what was typed in it (LeaveGuard). The routes of the app are inside the one route.
  const router = createHashRouter([
    {
      path: '*',
      element: (
        <>
          {demo && <DemoBanner />}
          <App serverHost={serverHost} />
        </>
      ),
    },
  ])
  root.render(
    <StrictMode>
      <AuthProvider store={store}>
        <BackendContext value={backend}>
          <NotifierContext value={demo?.notifier ?? null}>
            <RouterProvider router={router} />
          </NotifierContext>
        </BackendContext>
      </AuthProvider>
    </StrictMode>,
  )
}

if (import.meta.env.MODE === 'demo') {
  // Only a build made with `--mode demo` gets here (npm run demo, npm run electron:demo). Every
  // other mode folds this test away, so the demo gateway and its sample data never reach a release:
  // demoBuild.test.ts.
  document.documentElement.classList.add('demo-mode')
  // The demo has no permission to ask for and nothing to show on a phone: its reminders are the ones on the screen.
  // The person who signs in and the people of the team are one directory, so a name changed on the profile is seen by the administrator's screens.
  const people = createDemoDirectory()
  mount(createAuthStore(createDemoGateway(people)), createDemoBackend(undefined, people), 'הדגמה', { notifier: createMemoryNotifier('granted') })
} else {
  try {
    const config = loadConfig(import.meta.env)
    const client = createSupabaseClient(config)
    mount(createAuthStore(createSupabaseGateway(client)), createSupabaseBackend(client), new URL(config.supabaseUrl).host)
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err
    root.render(
      <StrictMode>
        <ConfigErrorScreen message={err.message} />
      </StrictMode>,
    )
  }
}
