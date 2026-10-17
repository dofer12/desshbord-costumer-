import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { checkDisplayName } from '../auth/profileForm'
import { ROLE_LABEL } from '../auth/roles'
import type { Profile, Role } from '../auth/types'

interface RenameFormProps {
  /** The name that is there now, which the edit starts from. */
  initial: string
  busy: boolean
  /** Saves the name. Resolves true when it worked, so that the edit can end. */
  onSave(name: string): Promise<boolean>
  onCancel(): void
}

/** The name of a person, being edited in their row. It starts from the name that is there, with the cursor in it. */
function RenameForm({ initial, busy, onSave, onCancel }: RenameFormProps) {
  const [draft, setDraft] = useState(initial)
  const [problem, setProblem] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const problemId = useId()

  useEffect(() => input.current?.focus(), [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const found = checkDisplayName(draft)
    setProblem(found)
    if (found) {
      input.current?.focus()
      return
    }
    await onSave(draft.trim())
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && !busy) {
      event.stopPropagation()
      onCancel()
    }
  }

  return (
    <form className="person-rename" onSubmit={(e) => void submit(e)} onKeyDown={onKeyDown} noValidate>
      <label className="visually-hidden" htmlFor={inputId}>
        שם חדש
      </label>
      <input
        id={inputId}
        ref={input}
        type="text"
        autoComplete="off"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? problemId : undefined}
      />
      <button type="submit" className="btn primary" disabled={busy}>
        שמירה
      </button>
      <button type="button" className="btn" disabled={busy} onClick={onCancel}>
        ביטול
      </button>
      {problem && (
        <p id={problemId} className="field-error">
          {problem}
        </p>
      )}
    </form>
  )
}

interface Props {
  person: Profile
  /** The row of the person who is looking: they cannot block themselves or reset their own password here. */
  isMe: boolean
  /** The only active administrator: they cannot be blocked or made an employee. */
  onlyActiveAdmin: boolean
  /** A request is on its way: nothing else is sent until it is answered. */
  busy: boolean
  /** The name of this person is being edited. */
  editing: boolean
  onEdit(): void
  onStopEditing(): void
  /** Saves the name. Resolves true when it worked. */
  onRename(name: string): Promise<boolean>
  onSetRole(role: Role): void
  onAskReset(): void
  onAskBlock(): void
  onUnblock(): void
}

/** One person of the team: who they are, what they are, and what an administrator can do about it. */
export function EmployeeRow({ person, isMe, onlyActiveAdmin, busy, editing, onEdit, onStopEditing, onRename, onSetRole, onAskReset, onAskBlock, onUnblock }: Props) {
  const editButton = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(false)
  const noteId = useId()
  const name = person.display_name

  // When the edit ends the cursor goes back to the button that began it, unless the person has already moved on to something else.
  useEffect(() => {
    if (wasEditing.current && !editing && (document.activeElement === document.body || document.activeElement === null)) {
      editButton.current?.focus()
    }
    wasEditing.current = editing
  }, [editing])

  return (
    <li className={person.is_active ? 'person' : 'person person-off'}>
      <div className="person-id">
        <strong className="person-name">{name}</strong>
        {isMe && <span className="tag tag-me">אתם</span>}
        <span className="person-email num">{person.email}</span>
      </div>

      <div className="person-tags">
        <span className="tag">{ROLE_LABEL[person.role]}</span>
        <span className={person.is_active ? 'tag tag-on' : 'tag tag-off'}>{person.is_active ? 'פעיל' : 'מושבת'}</span>
        {person.must_change_password && <span className="tag tag-warn">ממתין להחלפת סיסמה</span>}
      </div>

      {editing && (
        <RenameForm
          initial={name}
          busy={busy}
          onSave={async (next) => {
            const worked = await onRename(next)
            if (worked) onStopEditing()
            return worked
          }}
          onCancel={onStopEditing}
        />
      )}

      <div className="person-actions">
        <button type="button" ref={editButton} className="btn" aria-label={`שינוי שם: ${name}`} disabled={busy} onClick={onEdit}>
          שינוי שם
        </button>
        {person.role === 'employee' ? (
          <button type="button" className="btn" aria-label={`הפיכה למנהל: ${name}`} disabled={busy} onClick={() => onSetRole('admin')}>
            הפיכה למנהל
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            aria-label={`הפיכה לעובד: ${name}`}
            aria-describedby={onlyActiveAdmin ? noteId : undefined}
            disabled={busy || onlyActiveAdmin}
            onClick={() => onSetRole('employee')}
          >
            הפיכה לעובד
          </button>
        )}
        {!isMe && (
          <button type="button" className="btn" aria-label={`איפוס סיסמה: ${name}`} disabled={busy} onClick={onAskReset}>
            איפוס סיסמה
          </button>
        )}
        {!isMe &&
          (person.is_active ? (
            <button
              type="button"
              className="btn danger"
              aria-label={`חסימה: ${name}`}
              aria-describedby={onlyActiveAdmin ? noteId : undefined}
              disabled={busy || onlyActiveAdmin}
              onClick={onAskBlock}
            >
              חסימה
            </button>
          ) : (
            <button type="button" className="btn" aria-label={`שחרור: ${name}`} disabled={busy} onClick={onUnblock}>
              שחרור
            </button>
          ))}
      </div>

      {onlyActiveAdmin && (
        <p id={noteId} className="sub person-note">
          זה המנהל הפעיל היחיד, ולכן אי אפשר להפוך אותו לעובד או לחסום אותו. הגדירו קודם מנהל נוסף.
        </p>
      )}
      {isMe && (
        <p className="sub person-note">
          לשינוי הסיסמה שלך השתמשו <Link to="/profile">בפרופיל</Link>.
        </p>
      )}
    </li>
  )
}
