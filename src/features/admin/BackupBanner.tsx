import { Link } from 'react-router'
import { useNow } from '../../lib/useNow'
import { useAuth } from '../auth/authContext'
import { useDirectory, useTasks } from '../tasks/tasksContext'
import { backupDue } from './backupRules'

/**
 * The reminder to make a backup, above the pages of an administrator: when there are tasks and there is no
 * backup, or the last one is seven days old. It goes as soon as a backup is made. Employees never see it.
 */
export function BackupBanner() {
  const isAdmin = useAuth((state) => state.profile?.role === 'admin')
  const ready = useDirectory((state) => state.status === 'ready')
  const settings = useDirectory((state) => state.settings)
  const taskCount = useTasks((state) => Object.keys(state.tasks).length)
  const now = useNow()
  if (!isAdmin || !ready || !backupDue(settings, taskCount, now)) return null
  return (
    <p className="banner" role="status">
      {settings.last_backup_at === null ? 'עוד לא נעשה גיבוי של המשימות.' : 'עברו שבעה ימים או יותר מהגיבוי האחרון.'}{' '}
      <Link to="/admin/backup">לעמוד הגיבוי</Link>
    </p>
  )
}
