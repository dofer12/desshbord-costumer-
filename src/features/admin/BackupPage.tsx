import { useEffect, useMemo, useRef, useState } from 'react'
import { chooseFileSaver, type FileSaver, type SaveResult } from '../../lib/fileSaver'
import { useBackend } from '../tasks/backend'
import type { Task } from '../tasks/model'
import { useDirectory } from '../tasks/tasksContext'
import { backupFileName } from './backupRules'
import { toCsv } from './csv'
import { formatWall, tasksToBackupRows } from './legacyFormat'
import { toAdminWriteMessage } from './writeErrors'

const tasksWord = (count: number) => (count === 1 ? 'משימה אחת' : `${count} משימות`)

/**
 * The backup: every task of the system, done and deleted ones too, in one CSV file that opens in Excel and in
 * Google Sheets and that the import reads back. The screen says when the last one was made. The moment of a
 * backup is written (the reminder of the administrators stops) only after the file was handed over: a person who
 * closes the share sheet has not made a backup, and a file that could not be saved is not one.
 */
export function BackupPage({ saver: given }: { saver?: FileSaver }) {
  const api = useBackend().admin
  const statuses = useDirectory((state) => state.statuses)
  const profiles = useDirectory((state) => state.profiles)
  const lastBackup = useDirectory((state) => state.settings.last_backup_at)
  const loadDirectory = useDirectory((state) => state.load)
  const saver = useMemo(() => given ?? chooseFileSaver(), [given])

  const [total, setTotal] = useState<number | null>(null)
  const [loaded, setLoaded] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  /** Set at once, where a state would wait for the next render: a second click in the same moment must not start a second backup. */
  const running = useRef(false)
  const busy = loaded !== null

  // How many tasks there are, for the line under the heading. It is not worth a message when it cannot be read.
  useEffect(() => {
    let current = true
    api.tasks.count().then(
      (count) => {
        if (current) setTotal(count)
      },
      () => undefined,
    )
    return () => {
      current = false
    }
  }, [api])

  async function download() {
    if (running.current) return
    running.current = true
    setNotice(null)
    setDone(null)
    setLoaded(0)
    try {
      let tasks: Task[]
      try {
        tasks = await api.tasks.loadAll(setLoaded)
      } catch (err) {
        setNotice(`הגיבוי לא נוצר. ${toAdminWriteMessage(err)}`)
        return
      }
      setTotal(tasks.length)

      const now = new Date()
      const content = toCsv(tasksToBackupRows(tasks, profiles, statuses))
      let result: SaveResult
      try {
        result = await saver.save({ name: backupFileName(now), mime: 'text/csv', content })
      } catch {
        setNotice('לא הצלחנו לשמור את הקובץ במכשיר, ולכן הגיבוי לא נחשב. נסו שוב.')
        return
      }
      if (result === 'cancelled') {
        setNotice('השמירה בוטלה, ולכן הגיבוי לא נחשב. אפשר ללחוץ שוב.')
        return
      }

      // The file is in the hands of the person: now it counts.
      try {
        await api.settings.save({ last_backup_at: now.toISOString() })
        void loadDirectory()
        setDone(`הגיבוי נשמר: ${tasksWord(tasks.length)}.`)
      } catch (err) {
        setNotice(`הקובץ נשמר, אבל לא הצלחנו לרשום שהגיבוי נעשה, והתזכורת תמשיך להופיע. ${toAdminWriteMessage(err)}`)
      }
    } finally {
      running.current = false
      setLoaded(null)
    }
  }

  const last = lastBackup === null ? '' : formatWall(lastBackup)
  return (
    <section className="admin-section" aria-labelledby="backup-heading">
      <header className="page-head">
        <h3 id="backup-heading">גיבוי</h3>
      </header>

      <div className="backup-box">
        <p>{last ? `הגיבוי האחרון נעשה ב-${last}.` : 'עוד לא נעשה גיבוי.'}</p>
        <p className="sub">{total === null ? '' : `במערכת יש ${tasksWord(total)}, כולל משימות שהושלמו ומשימות שנמחקו.`}</p>
        <div>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void download()}>
            {busy ? 'מכין את הגיבוי…' : 'הורדת גיבוי'}
          </button>
        </div>
        {loaded !== null && (
          <p className="sub" role="status">
            נקראו {loaded} משימות…
          </p>
        )}
        {notice && (
          <p role="alert" className="alert">
            {notice}
          </p>
        )}
        {done && (
          <p role="status" className="saved-note">
            {done}
          </p>
        )}
      </div>

      <p className="sub backup-hint">
        הקובץ נפתח ב-Excel וב-Google Sheets, ואפשר לשחזר ממנו בעמוד "ייבוא". בטלפון נפתח חלון השיתוף: שלחו את הקובץ לדרייב או לדואר, כדי שיישמר גם מחוץ למכשיר.
        שחזור מוסיף רק משימות שחסרות. כדי לשנות משימה קיימת השתמשו באפליקציה.
      </p>
    </section>
  )
}
