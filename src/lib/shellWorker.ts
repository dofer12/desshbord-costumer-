import { Capacitor } from '@capacitor/core'

/**
 * Registers the service worker that keeps the shell of the web app (public/sw.js), so that the site opens
 * fast, can be installed from the browser, and shows its own message when there is no network. It is for the
 * site only: not for the Android app or the Windows app (they carry their own files), not for the demo, and
 * not for development, where an old copy of a file would hide the change that was just made.
 */
export function registerShellWorker(options: { development?: boolean; demo?: boolean } = {}): void {
  const development = options.development ?? import.meta.env.DEV
  const demo = options.demo ?? import.meta.env.MODE === 'demo'
  if (development || demo) return
  if (!('serviceWorker' in navigator) || globalThis.location?.protocol !== 'https:' || Capacitor.isNativePlatform()) return
  // After the page has loaded, so that the worker never competes with the first screen for the network.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // A browser that refuses (a private window, a policy) just keeps working without it.
    })
  })
}
