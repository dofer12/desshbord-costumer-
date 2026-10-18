import { useId, useRef, useState, type ChangeEvent } from 'react'
import { useAuth } from '../auth/authContext'
import { useBackend } from '../tasks/backend'
import { useDirectory, useTasks } from '../tasks/tasksContext'
import { decodeCsvBytes, parseCsv } from './csv'
import type { ImportOutcome } from './gateways'
import { isKnown } from './importKeys'
import { isBackupHeader, readBackup, type ImportItem, type ImportProblem } from './legacyFormat'
import { mapHeaders, MAX_ORDERS, ORDER_FIELD_LABEL, readOrders } from './ordersImport'
import { toAdminWriteMessage } from './writeErrors'

/** A file bigger than this is refused: it is far more than a team's tasks, and the browser would have to hold it twice. */
const MAX_FILE_BYTES = 20 * 1024 * 1024
/** How much of a text is looked at to tell that a file is not text: a NUL byte is never in a CSV. */
const SNIFF_BYTES = 8192
const SHOWN_PROBLEMS = 5
const SHOWN_FAILURES = 20

type Kind = 'orders' | 'backup'

const WRONG_FOR_ORDERS = 'הקובץ הזה נראה כקובץ גיבוי של המערכת. כדי לשחזר אותו השתמשו בחלק "שחזור מגיבוי".'
const WRONG_FOR_BACKUP = 'הקובץ הזה אינו קובץ גיבוי של המערכת. הזמנות מייבאים בחלק "הזמנות מ-CSV".'

/** What the person is shown after a file is read: what a click will import, and what is to be said about it. */
interface Preview {
  /** The items that the tasks do not have yet. */
  fresh: ImportItem[]
  lines: string[]
  problems: ImportProblem[]
  unmatchedHandlers: string[]
}

const tasksWord = (count: number) => (count === 1 ? 'משימה אחת' : `${count} משימות`)
const ordersWord = (count: number) => (count === 1 ? 'הזמנה אחת' : `${count} הזמנות`)

interface SectionProps {
  kind: Kind
  title: string
  intro: string
}

function ImportSection({ kind, title, intro }: SectionProps) {
  const api = useBackend().admin.tasks
  const me = useAuth((state) => state.profile)
  const statuses = useDirectory((state) => state.statuses)
  const profiles = useDirectory((state) => state.profiles)
  const loadTasks = useTasks((state) => state.load)

  const [preview, setPreview] = useState<Preview | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pasted, setPasted] = useState('')
  const [reading, setReading] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [report, setReport] = useState<ImportOutcome | null>(null)
  /** Numbers the readings, so that the late answer of an old one is dropped. */
  const turn = useRef(0)
  /** Set at once, where a state would wait for the next render: a second click in the same moment must not start a second import. */
  const running = useRef(false)

  const fileId = useId()
  const pasteId = useId()
  const headingId = useId()
  const busy = reading || progress !== null

  function refuse(text: string) {
    turn.current++
    setPreview(null)
    setReport(null)
    setReading(false)
    setMessage(text)
  }

  /** Reads the text of a file, or what was pasted, and says what importing it would do. */
  async function readSource(text: string) {
    if (!me) return
    const mine = ++turn.current
    setMessage(null)
    setReport(null)
    setPreview(null)
    setReading(true)
    try {
      const rows = parseCsv(text)
      if (rows.length === 0) return setMessage('הקובץ ריק: אין בו שורות.')
      const header = rows[0]
      if (kind === 'orders' && isBackupHeader(header)) return setMessage(WRONG_FOR_ORDERS)
      if (kind === 'backup' && !isBackupHeader(header)) {
        const orders = mapHeaders(header)
        return setMessage('order' in orders || 'name' in orders ? WRONG_FOR_BACKUP : 'זה לא קובץ גיבוי של המערכת: בשורת הכותרות חסרות העמודות "מזהה" ו"משימה".')
      }

      const known = await api.existingKeys()
      if (mine !== turn.current) return
      const context = { statuses, profiles, now: new Date(), adminId: me.id }

      if (kind === 'orders') {
        const result = readOrders(rows, { ...context, existingOrders: known.orderNumbers, defaultRemindMin: me.default_remind_min })
        if ('error' in result) return setMessage(result.error)
        setPreview({
          fresh: result.items,
          problems: result.problems,
          unmatchedHandlers: result.unmatchedHandlers,
          lines: [
            `זוהו העמודות: ${result.fields.map((field) => ORDER_FIELD_LABEL[field]).join(', ')}.`,
            `${ordersWord(result.items.length)} חדשות לייבוא${result.duplicates ? `, ${result.duplicates} דולגו כי מספר ההזמנה כבר קיים` : ''}.`,
            ...(result.extra
              ? [`הייבוא מוגבל ל-${MAX_ORDERS} בכל פעם, ונותרו ${result.extra}. אחרי הייבוא בחרו את הקובץ שוב: מה שכבר יובא יידלג.`]
              : []),
            'כל הזמנה נכנסת כמשימה פתוחה, בלי שיחת Glassix, ובלי מועד טיפול אלא אם יש בקובץ עמודת "מועד טיפול".',
          ],
        })
      } else {
        const result = readBackup(rows, context)
        if ('error' in result) return setMessage(result.error)
        const fresh = result.items.filter((item) => !isKnown(item, known))
        const existing = result.items.length - fresh.length
        setPreview({
          fresh,
          problems: result.problems,
          unmatchedHandlers: result.unmatchedHandlers,
          lines: [
            `בקובץ ${tasksWord(result.items.length + result.skippedDeleted)}: ${fresh.length} חדשות, ${existing} כבר קיימות במערכת${
              result.skippedDeleted ? `, ${result.skippedDeleted} מסומנות כמחוקות ולא ישוחזרו` : ''
            }${result.problems.length ? `, ${result.problems.length} עם בעיה` : ''}.`,
            'שחזור מוסיף רק משימות שחסרות, ולא משנה משימות קיימות.',
          ],
        })
      }
    } catch (err) {
      if (mine === turn.current) setMessage(toAdminWriteMessage(err))
    } finally {
      if (mine === turn.current) setReading(false)
    }
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    // So that the same file can be chosen again.
    input.value = ''
    if (!file) return
    if (file.size === 0) return refuse('הקובץ ריק.')
    if (file.size > MAX_FILE_BYTES) return refuse('הקובץ גדול מדי: עד 20MB.')
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await file.arrayBuffer())
    } catch {
      return refuse('לא הצלחנו לקרוא את הקובץ.')
    }
    if (bytes.subarray(0, SNIFF_BYTES).includes(0)) return refuse('זה לא קובץ טקסט: בחרו קובץ CSV.')
    await readSource(decodeCsvBytes(bytes))
  }

  async function checkPasted() {
    if (pasted.length > MAX_FILE_BYTES) return refuse('הטקסט גדול מדי: עד 20MB.')
    await readSource(pasted)
  }

  async function run() {
    if (!preview || preview.fresh.length === 0 || running.current) return
    running.current = true
    const items = preview.fresh
    setMessage(null)
    setReport(null)
    setProgress({ done: 0, total: items.length })
    try {
      const outcome = await api.importMany(items, (done, total) => setProgress({ done, total }))
      setReport(outcome)
      // The preview is of a file that is now (partly) in: to see what is left, the file is chosen again.
      setPreview(null)
      setPasted('')
      void loadTasks()
    } catch (err) {
      setMessage(toAdminWriteMessage(err))
    } finally {
      running.current = false
      setProgress(null)
    }
  }

  return (
    <section className="import-section" aria-labelledby={headingId}>
      <h4 id={headingId}>{title}</h4>
      <p className="sub">{intro}</p>

      <div className="field">
        <label htmlFor={fileId}>קובץ CSV</label>
        <input id={fileId} type="file" accept=".csv,.tsv,.txt,text/csv" disabled={busy} onChange={(event) => void chooseFile(event)} />
      </div>

      <div className="field">
        <label htmlFor={pasteId}>או הדבקה של טקסט</label>
        <textarea id={pasteId} rows={4} dir="rtl" value={pasted} disabled={busy} onChange={(event) => setPasted(event.target.value)} />
        <div>
          <button type="button" className="btn" disabled={busy || pasted.trim() === ''} onClick={() => void checkPasted()}>
            בדיקת הטקסט
          </button>
        </div>
      </div>

      {reading && (
        <p className="sub" role="status">
          קורא את הקובץ…
        </p>
      )}

      {message && (
        <p role="alert" className="alert">
          {message}
        </p>
      )}

      {preview && (
        <div className="import-preview">
          {preview.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
          {preview.unmatchedHandlers.length > 0 && (
            <p className="sub">
              השמות האלה ב"בטיפול של" אינם בצוות, והמשימות ישמרו אותם כטקסט: {preview.unmatchedHandlers.join(', ')}.
            </p>
          )}
          {preview.problems.length > 0 && (
            <div>
              <p className="sub">דברים שלא היו ברורים בקובץ (נבחר ערך ברירת מחדל):</p>
              <ul className="import-problems">
                {preview.problems.slice(0, SHOWN_PROBLEMS).map((problem) => (
                  <li key={`${problem.row}-${problem.message}`}>
                    שורה {problem.row}: {problem.message}
                  </li>
                ))}
              </ul>
              {preview.problems.length > SHOWN_PROBLEMS && <p className="sub">ועוד {preview.problems.length - SHOWN_PROBLEMS}.</p>}
            </div>
          )}
          {preview.fresh.length === 0 && <p className="sub">אין בקובץ שום דבר חדש לייבוא.</p>}
        </div>
      )}

      {progress && (
        <p className="sub" role="status">
          מייבא {progress.done} מתוך {progress.total}…
        </p>
      )}

      {report && (
        <div className="import-report" role="status">
          <p>
            נוספו {tasksWord(report.added)}
            {report.already ? `, ${report.already} דולגו כי הן כבר קיימות` : ''}
            {report.failed.length ? `, ${report.failed.length} נכשלו` : ''}.
          </p>
          {report.failed.length > 0 && (
            <div>
              <p className="field-error">הפריטים האלה לא נשמרו. כשהתקלה תיפתר בחרו את הקובץ שוב: מה שכבר נשמר יידלג והשאר ייכנסו.</p>
              <ul className="import-problems">
                {report.failed.slice(0, SHOWN_FAILURES).map((failure, index) => (
                  <li key={`${failure.key}-${index}`}>
                    {failure.key}: {failure.message}
                  </li>
                ))}
              </ul>
              {report.failed.length > SHOWN_FAILURES && <p className="sub">ועוד {report.failed.length - SHOWN_FAILURES}.</p>}
            </div>
          )}
        </div>
      )}

      <div>
        <button type="button" className="btn primary" disabled={busy || !preview || preview.fresh.length === 0} onClick={() => void run()}>
          {preview && preview.fresh.length > 0 ? `ייבוא ${tasksWord(preview.fresh.length)}` : 'ייבוא'}
        </button>
      </div>
    </section>
  )
}

/**
 * The import: a file of orders from the order system, and the restore of a backup (one of this system, or a
 * file of the old app). Each file is read first and the screen says what it would do; nothing is written until
 * the button is pressed. Whatever the tasks have already is left as it is, so a file can be imported twice.
 */
export function ImportPage() {
  return (
    <section className="admin-section" aria-labelledby="import-heading">
      <header className="page-head">
        <h3 id="import-heading">ייבוא</h3>
      </header>
      <ImportSection
        kind="orders"
        title="הזמנות מ-CSV"
        intro="קובץ הזמנות שמיוצא ממערכת ההזמנות או מגיליון. כל הזמנה חדשה נכנסת כמשימה פתוחה, והזמנה שמספרה כבר קיים מדולגת."
      />
      <ImportSection
        kind="backup"
        title="שחזור מגיבוי"
        intro="קובץ גיבוי של המערכת או של האפליקציה הישנה. שחזור מוסיף רק משימות שחסרות ולא משנה משימות קיימות, ולכן אפשר להריץ אותו שוב ושוב."
      />
    </section>
  )
}
