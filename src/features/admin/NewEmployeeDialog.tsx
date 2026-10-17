import { useId, useRef, useState, type FormEvent } from 'react'
import { Modal } from '../../ui/Modal'
import { checkEmail, normalizeEmail } from '../auth/credentials'
import { checkDisplayName } from '../auth/profileForm'
import { ROLE_LABEL } from '../auth/roles'
import type { Role } from '../auth/types'
import { adminMessage, type UserOutcome } from './gateways'

type Created = Extract<UserOutcome, { ok: true }>

interface Props {
  /** Makes the employee. Resolves with null when another request is still on its way, and the form waits. */
  create(input: { email: string; display_name: string; role: Role }): Promise<UserOutcome | null>
  onCreated(outcome: Created): void
  onCancel(): void
}

/** The form of a new employee: a name, an e-mail and a role. What the function says against it is said here, with the form kept. */
export function NewEmployeeDialog({ create, onCreated, onCancel }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('employee')
  const [problems, setProblems] = useState<{ name?: string; email?: string }>({})
  /** The field that the function named as the wrong one. */
  const [refused, setRefused] = useState<'name' | 'email' | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const headingId = useId()
  const nameId = useId()
  const emailId = useId()
  const roleId = useId()
  const nameErrorId = useId()
  const emailErrorId = useId()

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setFailure(null)
    setRefused(null)
    const found = { name: checkDisplayName(name) ?? undefined, email: checkEmail(email) ?? undefined }
    setProblems(found)
    if (found.name || found.email) {
      const field = found.name ? nameRef : emailRef
      field.current?.focus()
      return
    }
    setBusy(true)
    const outcome = await create({ email: normalizeEmail(email), display_name: name.trim(), role })
    setBusy(false)
    if (outcome === null) return
    if (outcome.ok) {
      onCreated(outcome)
      return
    }
    setFailure(adminMessage(outcome))
    setRefused(outcome.field === 'email' ? 'email' : outcome.field === 'display_name' ? 'name' : null)
  }

  const nameWrong = problems.name ?? (refused === 'name' ? failure : null)
  const emailWrong = problems.email ?? (refused === 'email' ? failure : null)

  return (
    <Modal
      labelledBy={headingId}
      compact
      onClose={() => {
        if (!busy) onCancel()
      }}
    >
      <form className="confirm new-employee" onSubmit={(e) => void onSubmit(e)} noValidate>
        <h2 id={headingId}>עובד חדש</h2>

        {failure && (
          <p role="alert" className="alert">
            {failure}
          </p>
        )}

        <div className="field">
          <label htmlFor={nameId}>שם</label>
          <input
            id={nameId}
            ref={nameRef}
            type="text"
            autoComplete="off"
            data-autofocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={nameWrong ? true : undefined}
            aria-describedby={problems.name ? nameErrorId : undefined}
          />
          {problems.name && (
            <p id={nameErrorId} className="field-error">
              {problems.name}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor={emailId}>אימייל</label>
          <input
            id={emailId}
            ref={emailRef}
            type="email"
            dir="ltr"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={emailWrong ? true : undefined}
            aria-describedby={problems.email ? emailErrorId : undefined}
          />
          {problems.email && (
            <p id={emailErrorId} className="field-error">
              {problems.email}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor={roleId}>תפקיד</label>
          <select id={roleId} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="employee">{ROLE_LABEL.employee}</option>
            <option value="admin">{ROLE_LABEL.admin}</option>
          </select>
        </div>

        <div className="confirm-actions">
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'מבצע…' : 'יצירה'}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            ביטול
          </button>
        </div>
      </form>
    </Modal>
  )
}
