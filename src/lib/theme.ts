import { deviceStorage } from './deviceStorage'

// The look of the app: the one that the device asks for (automatic), or light, or dark, as the person
// chose on this device. tokens.css has the colours of both and reads the choice from `data-theme` on the
// root element (no attribute is automatic); the colour of the bar of the browser or of the phone follows.

export type ThemeChoice = 'auto' | 'light' | 'dark'

export const THEME_CHOICES: readonly ThemeChoice[] = ['auto', 'light', 'dark']

export const THEME_LABEL: Record<ThemeChoice, string> = {
  auto: 'אוטומטי, לפי המכשיר',
  light: 'בהיר',
  dark: 'כהה',
}

const STORAGE_KEY = 'moked.theme'

/** The colour of the page in each theme (--bg of tokens.css): what the bar of the browser or of the phone is painted. */
const BAR_COLOR = { light: '#eef2f3', dark: '#0e171b' } as const

/** The choice of this device. Anything that is not a choice, or a storage that cannot be read, is automatic. */
export function readTheme(): ThemeChoice {
  try {
    const stored = deviceStorage()?.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'auto'
  } catch {
    return 'auto'
  }
}

/** Keeps the choice on this device. Automatic keeps nothing, so that the device decides again. A storage that cannot be written is not a failure. */
export function saveTheme(choice: ThemeChoice): void {
  try {
    const storage = deviceStorage()
    if (choice === 'auto') storage?.removeItem(STORAGE_KEY)
    else storage?.setItem(STORAGE_KEY, choice)
  } catch {
    // The choice holds for this visit and not for the next: not worth telling.
  }
}

/** Puts the choice on the page: the attribute that tokens.css reads, and the colour of the bar (the page may have one for each scheme). */
export function applyTheme(choice: ThemeChoice, doc: Document = document): void {
  const root = doc.documentElement
  if (choice === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', choice)
  for (const meta of doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const own = (meta.getAttribute('media') ?? '').includes('dark') ? 'dark' : 'light'
    meta.setAttribute('content', BAR_COLOR[choice === 'auto' ? own : choice])
  }
}
