import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Modal } from '../../ui/Modal'
import { useAuth } from '../auth/authContext'
import { CheckboxField, SelectField, TextAreaField, TextField } from './cardFields'
import { CopyButton } from './CopyButton'
import { dialHref, taskTitle } from './display'
import { fieldId } from './fieldId'
import { KIND_LABEL, PRIORITIES, PRIORITY_LABEL, TASK_KINDS, type Task } from './model'
import { changedFields, isDirty, mergeRemote, normalizedTask, toDraft, type Draft } from './taskForm'
import { useDirectory, useHistory, useTasks } from './tasksContext'
import { glassixUrl, validateTask, type TaskErrors } from './validation'

interface Props {
  /** The task to edit: the one in the list, or an empty new one. */
  task: Task
  isNew: boolean
  /** Called to leave the card, after saving or when the person gave up. */
  onClose(): void
}

const KIND_OPTIONS = TASK_KINDS.map((value) => ({ value, label: KIND_LABEL[value] }))
const PRIORITY_OPTIONS = PRIORITIES.map((value) => ({ value, label: PRIORITY_LABEL[value] }))
const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240]
const REMINDERS: Array<[number, string]> = [
  [0, 'בזמן המשימה'],
  [5, '5 דקות לפני'],
  [10, '10 דקות לפני'],
  [15, '15 דקות לפני'],
  [30, '30 דקות לפני'],
  [60, 'שעה לפני'],
  [120, 'שעתיים לפני'],
  [1440, 'יום לפני'],
]

/** The first field to put the focus on, for the first message in the order of the card. */
const FOCUS_ORDER: Array<[keyof TaskErrors, string]> = [
  ['title', 'title'],
  ['due', 'dueDate'],
  ['contact', 'customer_name'],
  ['glassix', 'glassix_conversation_id'],
  ['product', 'product_name'],
]

/** The choices of the lists of the card. A value that the task has but the list does not stays in it, so that the task shows what it is. */
function useDraftOptions(draft: Draft) {
  const statuses = useDirectory((state) => state.statuses)
  const profiles = useDirectory((state) => state.profiles)
  const shipMethods = useDirectory((state) => state.settings.ship_methods)
  const { task } = draft

  return useMemo(() => {
    const assignee = [
      { value: '', label: 'ללא שיוך' },
      ...profiles
        .filter((person) => person.is_active || person.id === task.assignee_id)
        .map((person) => ({ value: person.id, label: person.display_name + (person.is_active ? '' : ' (לא פעיל)') })),
    ]
    if (task.assignee_id !== null && !assignee.some((option) => option.value === task.assignee_id)) {
      assignee.push({ value: task.assignee_id, label: 'משתמש לא ידוע' })
    }

    const status = statuses.filter((s) => s.is_active || s.key === task.status_key).map((s) => ({ value: s.key, label: s.name_he }))
    if (!status.some((option) => option.value === task.status_key)) status.push({ value: task.status_key, label: task.status_key })

    const minutes = [...new Set([...DURATIONS, task.duration_min])].sort((a, b) => a - b)
    const duration = minutes.map((n) => ({ value: String(n), label: `${n} דקות` }))

    const known = new Map(REMINDERS)
    if (task.remind_min !== null && !known.has(task.remind_min)) known.set(task.remind_min, `${task.remind_min} דקות לפני`)
    const reminder = [{ value: '', label: 'ללא תזכורת' }, ...[...known].sort((a, b) => a[0] - b[0]).map(([n, label]) => ({ value: String(n), label }))]

    const methods = [...new Set([...shipMethods, ...(task.ship_method ? [task.ship_method] : [])])]
    const ship = [{ value: '', label: 'לא נבחרה' }, ...methods.map((method) => ({ value: method, label: method }))]

    return { assignee, status, duration, reminder, ship }
  }, [profiles, statuses, shipMethods, task.assignee_id, task.status_key, task.duration_min, task.remind_min, task.ship_method])
}

/** The card of a task: a window on a laptop and the whole screen on a phone. */
export function TaskCard({ task, isNew, onClose }: Props) {
  const form = useId()
  const titleId = `${form}-heading`
  const me = useAuth((state) => state.profile?.id ?? '')
  const create = useTasks((state) => state.create)
  const update = useTasks((state) => state.update)
  const markDone = useTasks((state) => state.markDone)
  const softDelete = useTasks((state) => state.softDelete)
  const profiles = useDirectory((state) => state.profiles)
  const glassixTemplate = useDirectory((state) => state.settings.glassix_url_template)
  const history = useHistory()

  const [base, setBase] = useState(task)
  const [draft, setDraft] = useState(() => toDraft(task))
  const [openedAt] = useState(task.updated_at)
  const [attempted, setAttempted] = useState(false)
  const [asking, setAsking] = useState<'discard' | 'delete' | null>(null)
  const [updatedBy, setUpdatedBy] = useState<string | null>(null)
  const safeAnswer = useRef<HTMLButtonElement>(null)
  const options = useDraftOptions(draft)

  // A new version of the task came from the server: show it in the fields that were not touched.
  if (task !== base) {
    setBase(task)
    setDraft(mergeRemote(draft, base, task))
  }

  // And say who made it, from the history, unless it was the person themselves.
  useEffect(() => {
    if (isNew || task.updated_at === openedAt) return
    let current = true
    history(task.id).then(
      (events) => {
        if (!current) return
        if (events.length === 0 || events[0].actor_id === me) setUpdatedBy(null)
        else if (events[0].actor_id === null) setUpdatedBy('המערכת')
        else setUpdatedBy(profiles.find((person) => person.id === events[0].actor_id)?.display_name ?? 'משתמש אחר')
      },
      () => {
        if (current) setUpdatedBy(null)
      },
    )
    return () => {
      current = false
    }
  }, [history, isNew, me, openedAt, profiles, task.id, task.updated_at])

  useEffect(() => {
    if (asking) safeAnswer.current?.focus()
  }, [asking])

  const errors = useMemo<TaskErrors>(() => (attempted ? validateTask(draft.task, draft) : {}), [attempted, draft])

  function change(patch: Partial<Task>) {
    setDraft((was) => ({ ...was, task: { ...was.task, ...patch } }))
  }

  /** Checks the card, and queues what changed. Says whether it could. */
  function save(): boolean {
    setAttempted(true)
    const found = validateTask(draft.task, draft)
    const first = FOCUS_ORDER.find(([key]) => found[key])
    if (first) {
      document.getElementById(fieldId(form, first[1]))?.focus()
      return false
    }
    if (isNew) {
      create(normalizedTask(draft))
    } else {
      // The store leaves a patch with nothing in it alone.
      update(base.id, changedFields(base, draft))
    }
    return true
  }

  function requestClose() {
    if (asking) setAsking(null)
    else if (isDirty(base, draft)) setAsking('discard')
    else onClose()
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (save()) onClose()
  }

  const phone = draft.task.customer_phone.trim()
  const dial = dialHref(phone)
  const glassix = draft.task.glassix_conversation_id.trim()
  const conversation = glassixUrl(glassixTemplate, glassix)
  const copy = (value: string, label: string) => (value.trim() ? <CopyButton value={value.trim()} label={label}>העתקה</CopyButton> : null)
  const text = (name: string, label: string, field: keyof Task, extra: { type?: 'tel'; ltr?: boolean; error?: string; actions?: ReactNode; autofocus?: boolean } = {}) => (
    <TextField
      form={form}
      name={name}
      label={label}
      value={draft.task[field] as string}
      onChange={(value) => change({ [field]: value })}
      {...extra}
    />
  )

  return (
    <Modal labelledBy={titleId} onClose={requestClose}>
      <form className="task-card-form" onSubmit={onSubmit} noValidate>
        <header className="card-head">
          <h2 id={titleId}>{isNew ? 'משימה חדשה' : taskTitle(base)}</h2>
          <button type="button" className="icon-btn" aria-label="סגירה" onClick={requestClose}>
            <span aria-hidden="true">×</span>
          </button>
        </header>

        {updatedBy && (
          <p role="status" className="card-note">
            עודכן על ידי {updatedBy}
          </p>
        )}

        <section className="card-section" aria-labelledby={`${form}-h-task`}>
          <h3 id={`${form}-h-task`}>המשימה</h3>
          {text('title', 'כותרת', 'title', { error: errors.title, autofocus: true })}
          <div className="field-grid">
            <SelectField form={form} name="kind" label="סוג" value={draft.task.kind} options={KIND_OPTIONS} onChange={(kind) => change({ kind: kind as Task['kind'] })} />
            <SelectField
              form={form}
              name="assignee_id"
              label="שיוך"
              value={draft.task.assignee_id ?? ''}
              options={options.assignee}
              onChange={(value) => change({ assignee_id: value || null })}
            />
            <SelectField
              form={form}
              name="priority"
              label="עדיפות"
              value={draft.task.priority}
              options={PRIORITY_OPTIONS}
              onChange={(priority) => change({ priority: priority as Task['priority'] })}
            />
            <SelectField form={form} name="status_key" label="סטטוס" value={draft.task.status_key} options={options.status} onChange={(value) => change({ status_key: value })} />
            <TextField form={form} name="dueDate" label="תאריך" type="date" value={draft.dueDate} error={errors.due} onChange={(dueDate) => setDraft((was) => ({ ...was, dueDate }))} />
            <TextField form={form} name="dueTime" label="שעה" type="time" value={draft.dueTime} onChange={(dueTime) => setDraft((was) => ({ ...was, dueTime }))} />
            <SelectField
              form={form}
              name="duration_min"
              label="משך"
              value={String(draft.task.duration_min)}
              options={options.duration}
              onChange={(value) => change({ duration_min: Number(value) })}
            />
            <SelectField
              form={form}
              name="remind_min"
              label="תזכורת"
              value={draft.task.remind_min === null ? '' : String(draft.task.remind_min)}
              options={options.reminder}
              onChange={(value) => change({ remind_min: value === '' ? null : Number(value) })}
            />
          </div>
          <TextAreaField form={form} name="notes" label="הערות" value={draft.task.notes} onChange={(notes) => change({ notes })} />
        </section>

        <section className="card-section" aria-labelledby={`${form}-h-customer`}>
          <h3 id={`${form}-h-customer`}>לקוח והתקשרות</h3>
          <div className="field-grid">
            {text('customer_name', 'שם לקוח', 'customer_name', { error: errors.contact })}
            {text('customer_phone', 'טלפון', 'customer_phone', {
              type: 'tel',
              ltr: true,
              actions: (
                <>
                  {copy(draft.task.customer_phone, 'טלפון')}
                  {dial && (
                    <a className="btn" href={dial} aria-label={`חיוג אל ${phone}`}>
                      חיוג
                    </a>
                  )}
                </>
              ),
            })}
            {text('order_number', 'מספר הזמנה', 'order_number', { ltr: true, actions: copy(draft.task.order_number, 'מספר הזמנה') })}
            {text('service_call_number', 'מספר קריאת שירות', 'service_call_number', { ltr: true })}
          </div>
          {text('glassix_conversation_id', 'מזהה שיחת Glassix', 'glassix_conversation_id', {
            ltr: true,
            error: errors.glassix,
            actions: (
              <>
                {copy(draft.task.glassix_conversation_id, 'מזהה Glassix')}
                {conversation && (
                  <a className="btn" href={conversation} target="_blank" rel="noopener noreferrer">
                    פתח שיחה
                  </a>
                )}
              </>
            ),
          })}
          <CheckboxField form={form} name="no_glassix" label="אין שיחה ב-Glassix" checked={draft.task.no_glassix} onChange={(no_glassix) => change({ no_glassix })} />
        </section>

        {draft.task.kind !== 'general' && (
          <section className="card-section" aria-labelledby={`${form}-h-kind`}>
            <h3 id={`${form}-h-kind`}>לפי סוג</h3>
            {draft.task.kind === 'delivery' ? (
              <>
                {text('cargo_number', 'מספר Cargo', 'cargo_number', { ltr: true, actions: copy(draft.task.cargo_number, 'מספר Cargo') })}
                <CheckboxField form={form} name="sent_to_cargo" label="נשלח ל-CARGO" checked={draft.task.sent_to_cargo} onChange={(sent_to_cargo) => change({ sent_to_cargo })} />
              </>
            ) : (
              <div className="field-grid">
                {text('product_name', 'שם מוצר', 'product_name', { error: errors.product })}
                {text('product_sku', 'מק״ט', 'product_sku', { ltr: true })}
              </div>
            )}
          </section>
        )}

        <details className="card-section card-details">
          <summary>פרטי הזמנה</summary>
          <div className="field-grid">
            <SelectField form={form} name="ship_method" label="שיטת משלוח" value={draft.task.ship_method} options={options.ship} onChange={(ship_method) => change({ ship_method })} />
            {text('ship_status', 'סטטוס משלוח', 'ship_status')}
            {text('order_date', 'תאריך הזמנה', 'order_date')}
            {text('billing', 'חיוב', 'billing')}
          </div>
          <TextAreaField form={form} name="ship_to" label="כתובת למשלוח" rows={2} value={draft.task.ship_to} onChange={(ship_to) => change({ ship_to })} />
        </details>

        {asking === 'delete' ? (
          <footer className="card-actions" role="alert">
            <p>למחוק את המשימה?</p>
            <button type="button" className="btn danger" onClick={() => {
              softDelete(base.id, true)
              onClose()
            }}>
              כן, למחוק
            </button>
            <button type="button" className="btn" ref={safeAnswer} onClick={() => setAsking(null)}>
              לא, להשאיר
            </button>
          </footer>
        ) : asking === 'discard' ? (
          <footer className="card-actions" role="alert">
            <p>יש שינויים שלא נשמרו.</p>
            <button type="button" className="btn danger" onClick={onClose}>
              סגירה בלי שמירה
            </button>
            <button type="button" className="btn" ref={safeAnswer} onClick={() => setAsking(null)}>
              חזרה לעריכה
            </button>
          </footer>
        ) : (
          <footer className="card-actions">
            <button type="submit" className="btn primary">
              שמירה
            </button>
            <button type="button" className="btn" onClick={requestClose}>
              ביטול
            </button>
            {!isNew && (
              <>
                <button
                  type="button"
                  className="btn push"
                  onClick={() => {
                    if (!save()) return
                    markDone(base.id, base.done_at === null)
                    onClose()
                  }}
                >
                  {base.done_at === null ? 'בוצע' : 'סימון כלא בוצע'}
                </button>
                <button type="button" className="btn danger" onClick={() => setAsking('delete')}>
                  מחק משימה
                </button>
              </>
            )}
          </footer>
        )}
      </form>
    </Modal>
  )
}
