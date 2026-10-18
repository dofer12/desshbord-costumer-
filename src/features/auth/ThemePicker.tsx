import { useId, useState } from 'react'
import { applyTheme, readTheme, saveTheme, THEME_CHOICES, THEME_LABEL, type ThemeChoice } from '../../lib/theme'

/** The look of the app on this device: automatic, light or dark. The choice is kept on the device and is applied at once. */
export function ThemePicker() {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme)
  const group = useId()

  function choose(next: ThemeChoice) {
    setChoice(next)
    saveTheme(next)
    applyTheme(next)
  }

  return (
    <fieldset className="theme-picker">
      <legend className="visually-hidden">מראה האפליקציה</legend>
      {THEME_CHOICES.map((value) => (
        <label key={value} className="theme-option">
          <input type="radio" name={group} value={value} checked={choice === value} onChange={() => choose(value)} />
          <span>{THEME_LABEL[value]}</span>
        </label>
      ))}
    </fieldset>
  )
}
