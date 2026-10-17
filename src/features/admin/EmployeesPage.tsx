import { useRef, useState } from 'react'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { useAuth } from '../auth/authContext'
import type { Profile, Role } from '../auth/types'
import { useBackend } from '../tasks/backend'
import { useDirectory } from '../tasks/tasksContext'
import { EmployeeRow } from './EmployeeRow'
import { adminMessage, type UserOutcome } from './gateways'
import { NewEmployeeDialog } from './NewEmployeeDialog'
import { TempPasswordDialog } from './TempPasswordDialog'

/** The temporary password that a dialog is showing, and the person whose session it was made in. */
interface Secret {
  kind: 'created' | 'reset'
  person: string
  password: string
  owner: string
}

interface Question {
  kind: 'reset' | 'block'
  person: Profile
}

const alphabet = new Intl.Collator('he')

/** Active people first, and each group in the order of the alphabet. */
function ordered(profiles: Profile[]): Profile[] {
  return [...profiles].sort((a, b) => Number(b.is_active) - Number(a.is_active) || alphabet.compare(a.display_name, b.display_name))
}

/**
 * The team: who is in it, and how a person gets in, changes role, is renamed, is blocked, or gets a new
 * temporary password. Every change is a request to the administrator function, which has the last word;
 * the screen says what it answered, and brings the list up to date from the answer.
 */
export function EmployeesPage() {
  const users = useBackend().admin.users
  const me = useAuth((state) => state.profile)
  const profiles = useDirectory((state) => state.profiles)
  const status = useDirectory((state) => state.status)
  const loadError = useDirectory((state) => state.error)
  const load = useDirectory((state) => state.load)

  const [creating, setCreating] = useState(false)
  const [question, setQuestion] = useState<Question | null>(null)
  const [secret, setSecret] = useState<Secret | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Set at once, where a state would wait for the next render: a second click in the same moment must not send a second request. */
  const running = useRef(false)

  /** A temporary password made in the session of somebody else is never shown. */
  const shownSecret = secret && secret.owner === me?.id ? secret : null

  /**
   * Sends one request, and only one at a time. Resolves with what the function answered, or with null when
   * another request is still on its way. The list is brought up to date from the answer, whatever it was
   * (unless the server could not be reached), so that a screen that was out of date is put right.
   */
  async function act(call: () => Promise<UserOutcome>): Promise<UserOutcome | null> {
    if (running.current) return null
    running.current = true
    setBusy(true)
    setNotice(null)
    try {
      // The gateways answer with a value for every way that a request can fail; a call that throws anyway is a failure too.
      let outcome: UserOutcome
      try {
        outcome = await call()
      } catch {
        outcome = { ok: false, code: 'failed' }
      }
      if (outcome.ok || outcome.code !== 'network') void load()
      return outcome
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  /** Sends a request whose answer is a person who changed. Says what went wrong, and resolves whether it worked. */
  async function change(call: () => Promise<UserOutcome>): Promise<boolean> {
    const outcome = await act(call)
    if (outcome === null) return false
    if (!outcome.ok) {
      setNotice(adminMessage(outcome))
      return false
    }
    return true
  }

  async function reset(person: Profile) {
    const outcome = await act(() => users.resetPassword(person.id))
    if (outcome === null) return
    setQuestion(null)
    if (!outcome.ok) {
      setNotice(adminMessage(outcome))
    } else if (outcome.tempPassword && me) {
      setSecret({ kind: 'reset', person: outcome.user.display_name, password: outcome.tempPassword, owner: me.id })
    } else {
      // The function said yes and sent no password: there is nothing to hand over, and the person is told so.
      setNotice(adminMessage({ ok: false, code: 'failed' }))
    }
  }

  async function block(person: Profile) {
    await change(() => users.setActive(person.id, false))
    // The question is closed whether it worked or not, so that what went wrong is seen on the page.
    setQuestion(null)
  }

  async function createEmployee(input: { email: string; display_name: string; role: Role }) {
    return act(() => users.create(input))
  }

  function created(outcome: Extract<UserOutcome, { ok: true }>) {
    setCreating(false)
    if (outcome.tempPassword && me) {
      setSecret({ kind: 'created', person: outcome.user.display_name, password: outcome.tempPassword, owner: me.id })
    } else {
      setNotice(adminMessage({ ok: false, code: 'failed' }))
    }
  }

  const activeAdmins = profiles.filter((p) => p.role === 'admin' && p.is_active)

  return (
    <section className="admin-section" aria-labelledby="employees-heading">
      <header className="page-head">
        <h3 id="employees-heading">עובדים</h3>
        <button type="button" className="btn primary" disabled={busy} onClick={() => setCreating(true)}>
          עובד חדש
        </button>
      </header>

      {notice && (
        <p role="alert" className="alert">
          {notice}
        </p>
      )}
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
        <ul className="people" aria-label="רשימת העובדים">
          {ordered(profiles).map((person) => (
            <EmployeeRow
              key={person.id}
              person={person}
              isMe={person.id === me?.id}
              onlyActiveAdmin={activeAdmins.length === 1 && activeAdmins[0].id === person.id}
              busy={busy}
              editing={editing === person.id}
              onEdit={() => setEditing(person.id)}
              onStopEditing={() => setEditing(null)}
              onRename={(name) => change(() => users.rename(person.id, name))}
              onSetRole={(role) => void change(() => users.setRole(person.id, role))}
              onAskReset={() => setQuestion({ kind: 'reset', person })}
              onAskBlock={() => setQuestion({ kind: 'block', person })}
              onUnblock={() => void change(() => users.setActive(person.id, true))}
            />
          ))}
        </ul>
      )}

      {creating && <NewEmployeeDialog create={createEmployee} onCreated={created} onCancel={() => setCreating(false)} />}

      {question?.kind === 'reset' && (
        <ConfirmDialog
          title="איפוס סיסמה"
          confirmLabel="איפוס"
          busy={busy}
          onConfirm={() => void reset(question.person)}
          onCancel={() => setQuestion(null)}
        >
          <p>לאפס את הסיסמה של {question.person.display_name}?</p>
          <p className="sub">תיווצר לו סיסמה זמנית חדשה, והוא ינותק מכל המכשירים.</p>
        </ConfirmDialog>
      )}

      {question?.kind === 'block' && (
        <ConfirmDialog
          title="חסימת עובד"
          confirmLabel="חסימה"
          danger
          busy={busy}
          onConfirm={() => void block(question.person)}
          onCancel={() => setQuestion(null)}
        >
          <p>לחסום את {question.person.display_name}?</p>
          <p className="sub">הוא ינותק מכל המכשירים ולא יוכל להיכנס עד שתשחררו אותו. המשימות שלו נשארות כמות שהן.</p>
        </ConfirmDialog>
      )}

      {shownSecret && <TempPasswordDialog kind={shownSecret.kind} person={shownSecret.person} password={shownSecret.password} onClose={() => setSecret(null)} />}
    </section>
  )
}
