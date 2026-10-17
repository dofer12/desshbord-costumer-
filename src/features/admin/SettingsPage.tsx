import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { useBackend } from '../tasks/backend'
import type { Settings } from '../tasks/gateways'
import { DEFAULT_SHIP_METHODS } from '../tasks/model'
import { useDirectory } from '../tasks/tasksContext'
import { glassixUrl, MAX_SHIP_METHODS, MAX_SHIP_METHOD_LENGTH, validateGlassixTemplate, validateShipMethods } from '../tasks/validation'
import { classifyWriteFailure, toAdminWriteMessage } from './writeErrors'

/** A shipping method in the form, with an id of its own so that it keeps its place in the page when the list is moved. */
interface Method {
  id: number
  text: string
}

let lastMethodId = 0
const methodsOf = (names: readonly string[]): Method[] => names.map((text) => ({ id: ++lastMethodId, text }))
const namesOf = (methods: Method[]) => methods.map((method) => method.text.trim())
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((name, index) => name === b[index])

/** Where the cursor goes when the list has changed: a button of the row (or the name, when there is none such), once the row is where it goes. */
interface Refocus {
  id: number
  action: 'up' | 'down' | 'name'
}

function SettingsForm({ settings }: { settings: Settings }) {
  const api = useBackend().admin.settings
  const load = useDirectory((state) => state.load)

  const savedTemplate = settings.glassix_url_template
  const savedMethods = settings.ship_methods

  const [template, setTemplate] = useState(savedTemplate)
  const [methods, setMethods] = useState<Method[]>(() => methodsOf(savedMethods))
  const [seenTemplate, setSeenTemplate] = useState(savedTemplate)
  const [seenMethods, setSeenMethods] = useState(savedMethods)
  const [justAdded, setJustAdded] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  /** Set at once, where a state would wait for the next render: a second click in the same moment must not send a second request. */
  const running = useRef(false)
  const list = useRef<HTMLUListElement>(null)
  const refocus = useRef<Refocus | null>(null)

  const templateId = useId()
  const templateHintId = useId()
  const templateErrorId = useId()
  const methodsErrorId = useId()

  // What the server has is what the form shows, for each of the two settings that the person has not changed:
  // what an administrator saved from another device, or what was saved a moment ago, replaces it.
  if (savedTemplate !== seenTemplate) {
    setSeenTemplate(savedTemplate)
    if (template.trim() === seenTemplate) setTemplate(savedTemplate)
  }
  if (!sameList(savedMethods, seenMethods)) {
    setSeenMethods(savedMethods)
    if (sameList(namesOf(methods), seenMethods)) setMethods(methodsOf(savedMethods))
  }

  // After a move or a removal the cursor stays where the person was, once the row is in its new place.
  useLayoutEffect(() => {
    const want = refocus.current
    if (!want) return
    refocus.current = null
    const row = list.current?.querySelector<HTMLElement>(`[data-method="${want.id}"]`)
    const button = (action: string) => row?.querySelector<HTMLButtonElement>(`button[data-action="${action}"]:not(:disabled)`)
    const other = want.action === 'up' ? 'down' : 'up'
    ;(want.action === 'name' ? row?.querySelector('input') : (button(want.action) ?? button(other) ?? row?.querySelector('input')))?.focus()
  }, [methods])

  const names = namesOf(methods)
  const templateError = validateGlassixTemplate(template)
  const methodsError = validateShipMethods(names)
  const templateDirty = template.trim() !== savedTemplate
  const methodsDirty = !sameList(names, savedMethods)
  const canSave = (templateDirty || methodsDirty) && templateError === null && methodsError === null && !busy
  const example = templateError === null ? glassixUrl(template, '123') : null

  function edited() {
    setDone(false)
    setNotice(null)
  }

  function rename(id: number, text: string) {
    edited()
    setMethods((current) => current.map((method) => (method.id === id ? { ...method, text } : method)))
  }

  function move(index: number, direction: 'up' | 'down') {
    const to = direction === 'up' ? index - 1 : index + 1
    edited()
    refocus.current = { id: methods[index].id, action: direction }
    setMethods((current) => {
      const next = [...current]
      ;[next[index], next[to]] = [next[to], next[index]]
      return next
    })
  }

  function remove(index: number) {
    if (methods.length === 1) return
    edited()
    // The cursor goes to the entry that takes the place of the one that is gone.
    refocus.current = { id: methods[index === methods.length - 1 ? index - 1 : index + 1].id, action: 'name' }
    setMethods((current) => current.filter((_, at) => at !== index))
  }

  function add() {
    if (methods.length >= MAX_SHIP_METHODS) return
    edited()
    const [made] = methodsOf([''])
    setJustAdded(made.id)
    setMethods((current) => [...current, made])
  }

  function restoreDefaults() {
    edited()
    setJustAdded(null)
    setMethods(methodsOf(DEFAULT_SHIP_METHODS))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSave || running.current) return
    running.current = true
    setBusy(true)
    setNotice(null)
    setDone(false)
    const patch: Partial<Settings> = {}
    if (templateDirty) patch.glassix_url_template = template.trim()
    if (methodsDirty) patch.ship_methods = names
    try {
      await api.save(patch)
      // What was typed is what was saved, without the spaces around it.
      setTemplate((current) => current.trim())
      setMethods((current) => current.map((method) => ({ ...method, text: method.text.trim() })))
      setDone(true)
      void load()
    } catch (err) {
      setNotice(toAdminWriteMessage(err))
      if (classifyWriteFailure(err) !== 'network') void load()
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  return (
    <form className="settings-form" onSubmit={(event) => void submit(event)} noValidate>
      <div className="field">
        <label htmlFor={templateId}>כתובת שיחה ב-Glassix</label>
        <input
          id={templateId}
          type="text"
          inputMode="url"
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://app.glassix.com/conversations/{id}"
          value={template}
          readOnly={busy}
          onChange={(event) => {
            edited()
            setTemplate(event.target.value)
          }}
          aria-invalid={templateError ? true : undefined}
          aria-describedby={templateError ? `${templateHintId} ${templateErrorId}` : templateHintId}
        />
        <p id={templateHintId} className="sub">
          כתבו כתובת של שיחה ב-Glassix, ובמקום המזהה כתבו {'{id}'}. כך הכפתור "פתח שיחה" בכרטיס המשימה פותח את השיחה של המשימה. אם תשאירו ריק, הכפתור לא יופיע.
        </p>
        {templateError && (
          <p id={templateErrorId} className="field-error">
            {templateError}
          </p>
        )}
        {example && (
          <p className="sub">
            תצוגה מקדימה, עם מזהה לדוגמה:{' '}
            <a href={example} target="_blank" rel="noopener noreferrer" dir="ltr" className="num">
              {example}
            </a>
          </p>
        )}
      </div>

      <fieldset aria-describedby={methodsError ? methodsErrorId : undefined}>
        <legend>שיטות משלוח</legend>
        <p className="sub">הרשימה שממנה בוחרים בכרטיס המשימה. משימה שכבר נשמרה עם שיטה שהוסרה ממשיכה להציג אותה.</p>
        <ul className="method-list" aria-label="רשימת שיטות המשלוח" ref={list}>
          {methods.map((method, index) => {
            const name = method.text.trim()
            return (
              <li key={method.id} className="method-row" data-method={method.id}>
                <input
                  type="text"
                  autoComplete="off"
                  autoFocus={method.id === justAdded}
                  aria-label={`שם שיטת משלוח ${index + 1}`}
                  maxLength={MAX_SHIP_METHOD_LENGTH * 2}
                  value={method.text}
                  readOnly={busy}
                  onChange={(event) => rename(method.id, event.target.value)}
                />
                <div className="method-actions">
                  <button type="button" className="btn" data-action="up" aria-label={`הזזה למעלה: ${name}`} disabled={busy || index === 0} onClick={() => move(index, 'up')}>
                    <span aria-hidden="true">↑</span>
                  </button>
                  <button type="button" className="btn" data-action="down" aria-label={`הזזה למטה: ${name}`} disabled={busy || index === methods.length - 1} onClick={() => move(index, 'down')}>
                    <span aria-hidden="true">↓</span>
                  </button>
                  <button type="button" className="btn" aria-label={`הסרה: ${name}`} disabled={busy || methods.length === 1} onClick={() => remove(index)}>
                    הסרה
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
        {methodsError && (
          <p id={methodsErrorId} className="field-error">
            {methodsError}
          </p>
        )}
        <div className="method-tools">
          <button type="button" className="btn" disabled={busy || methods.length >= MAX_SHIP_METHODS} onClick={add}>
            הוספת שיטה
          </button>
          <button type="button" className="btn" disabled={busy} onClick={restoreDefaults}>
            שחזור ברירת מחדל
          </button>
        </div>
      </fieldset>

      {notice && (
        <p role="alert" className="alert">
          {notice}
        </p>
      )}

      <div className="settings-actions">
        <button type="submit" className="btn primary" disabled={!canSave}>
          {busy ? 'שומר…' : 'שמירה'}
        </button>
        {done && (
          <p role="status" className="saved-note">
            נשמר
          </p>
        )}
      </div>
    </form>
  )
}

/**
 * The settings of the team: the address of a Glassix conversation (the "פתח שיחה" button of the card) and the
 * list of the shipping methods. One form, one save; what is wrong is said under the field and the button
 * waits until it is put right. Saved to the database by the app itself: only an administrator may.
 */
export function SettingsPage() {
  const settings = useDirectory((state) => state.settings)
  const status = useDirectory((state) => state.status)
  const loadError = useDirectory((state) => state.error)
  const load = useDirectory((state) => state.load)

  return (
    <section className="admin-section" aria-labelledby="settings-heading">
      <header className="page-head">
        <h3 id="settings-heading">הגדרות</h3>
      </header>

      {loadError && (
        <p role="alert" className="alert">
          {loadError}{' '}
          <button type="button" className="btn" onClick={() => void load()}>
            נסו שוב
          </button>
        </p>
      )}

      {status === 'loading' || status === 'idle' ? (
        <p className="sub" role="status">
          טוען…
        </p>
      ) : status === 'error' ? null : (
        <SettingsForm settings={settings} />
      )}
    </section>
  )
}
