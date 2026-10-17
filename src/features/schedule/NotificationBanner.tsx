import { NOTIFICATION_MESSAGES, useReminders } from './remindersContext'

/**
 * What the device lets the app do about notifications, said on the Today screen: a question when the
 * person has not been asked, how to turn them on when they are blocked, that they cannot be shown at
 * all, and that they may come late when the device does not allow exact alarms. When all is well it
 * says nothing. A failure to plan them on the device is shown whatever the permission is.
 */
export function NotificationBanner() {
  const { permission, requestPermission, exactAlarms, openExactAlarmSettings, problem } = useReminders()
  const asking = permission === 'prompt'
  const blocked = permission === 'denied'
  const unsupported = permission === 'unsupported'
  const approximate = permission === 'granted' && exactAlarms === 'denied'
  if (!asking && !blocked && !unsupported && !approximate && !problem) return null

  return (
    <div className="notices">
      {asking && (
        <p className="notice">
          {NOTIFICATION_MESSAGES.prompt}
          <button type="button" className="btn primary" onClick={() => void requestPermission()}>
            הפעלת התראות
          </button>
        </p>
      )}
      {blocked && <p className="notice">{NOTIFICATION_MESSAGES.denied}</p>}
      {unsupported && <p className="notice">{NOTIFICATION_MESSAGES.unsupported}</p>}
      {approximate && (
        <p className="notice">
          {NOTIFICATION_MESSAGES.approximate}
          <button type="button" className="btn" onClick={() => openExactAlarmSettings()}>
            פתיחת ההגדרות
          </button>
        </p>
      )}
      {problem && (
        <p className="notice notice-problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  )
}
