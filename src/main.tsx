import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import { App } from './App'
import { AuthProvider } from './features/auth/AuthProvider'
import { createAuthStore } from './features/auth/authStore'
import { createSupabaseGateway } from './features/auth/supabaseGateway'
import { ConfigErrorScreen } from './features/config/ConfigErrorScreen'
import { ConfigError, loadConfig } from './lib/config'
import { createSupabaseClient } from './lib/supabase'
import './styles/fonts'
import './styles/tokens.css'
import './styles/base.css'

const root = createRoot(document.getElementById('root')!)

try {
  const config = loadConfig(import.meta.env)
  const store = createAuthStore(createSupabaseGateway(createSupabaseClient(config)))
  void store.getState().init()
  root.render(
    <StrictMode>
      <AuthProvider store={store}>
        <HashRouter>
          <App serverHost={new URL(config.supabaseUrl).host} />
        </HashRouter>
      </AuthProvider>
    </StrictMode>,
  )
} catch (err) {
  if (!(err instanceof ConfigError)) throw err
  root.render(
    <StrictMode>
      <ConfigErrorScreen message={err.message} />
    </StrictMode>,
  )
}
