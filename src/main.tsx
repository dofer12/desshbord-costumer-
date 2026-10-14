import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import { App } from './App'
import { AuthProvider } from './features/auth/AuthProvider'
import { createAuthStore, type AuthStore } from './features/auth/authStore'
import { createSupabaseGateway } from './features/auth/supabaseGateway'
import { ConfigErrorScreen } from './features/config/ConfigErrorScreen'
import { DemoBanner } from './features/demo/DemoBanner'
import { createDemoGateway } from './features/demo/demoGateway'
import { ConfigError, loadConfig } from './lib/config'
import { createSupabaseClient } from './lib/supabase'
import './styles/fonts'
import './styles/tokens.css'
import './styles/base.css'

const root = createRoot(document.getElementById('root')!)

function mount(store: AuthStore, serverHost: string, demo = false) {
  void store.getState().init()
  root.render(
    <StrictMode>
      <AuthProvider store={store}>
        <HashRouter>
          {demo && <DemoBanner />}
          <App serverHost={serverHost} />
        </HashRouter>
      </AuthProvider>
    </StrictMode>,
  )
}

if (import.meta.env.MODE === 'demo') {
  // Only a build made with `--mode demo` gets here (npm run demo, npm run electron:demo). Every
  // other mode folds this test away, so the demo gateway never reaches a release: demoBuild.test.ts.
  document.documentElement.classList.add('demo-mode')
  mount(createAuthStore(createDemoGateway()), 'הדגמה', true)
} else {
  try {
    const config = loadConfig(import.meta.env)
    mount(createAuthStore(createSupabaseGateway(createSupabaseClient(config))), new URL(config.supabaseUrl).host)
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err
    root.render(
      <StrictMode>
        <ConfigErrorScreen message={err.message} />
      </StrictMode>,
    )
  }
}
