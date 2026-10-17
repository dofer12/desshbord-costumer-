/// <reference types="vite/client" />

/** Injected by vite.config.ts from package.json. */
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  /** Present only in the Windows app (electron/preload.cts): what the page may ask of the app itself. */
  mokedDesktop?: {
    /** Shows the window of the app, which is hidden in the tray when it is closed. */
    showWindow(): void
  }
}
