import { useState } from 'react'
import { checkForUpdate, RELEASES_PAGE, type UpdateResult } from '../../lib/updateCheck'

/** The version of this build, and a button that asks whether a newer one is published. */
export function UpdateCheck() {
  const [state, setState] = useState<'idle' | 'checking' | UpdateResult>('idle')

  async function check() {
    setState('checking')
    setState(await checkForUpdate(__APP_VERSION__))
  }

  const answer = typeof state === 'string' ? null : state
  return (
    <div className="update-check">
      <p>
        גרסה <span className="num">{__APP_VERSION__}</span>
      </p>
      <div>
        <button type="button" className="btn" disabled={state === 'checking'} onClick={() => void check()}>
          {state === 'checking' ? 'בודק…' : 'בדיקת עדכון'}
        </button>
      </div>
      {answer && (
        <p role="status" className={answer.kind === 'failed' ? 'field-error' : 'sub'}>
          {answer.kind === 'newer' && (
            <>
              יש גרסה חדשה: <span className="num">{answer.version}</span>.{' '}
              <a href={RELEASES_PAGE} target="_blank" rel="noopener noreferrer">
                לעמוד ההורדות
              </a>
              . באנדרואיד מורידים את קובץ ה-APK ומתקינים אותו מעל הגרסה הקיימת, ובמחשב מריצים את המתקין. באתר מרעננים את הדף.
            </>
          )}
          {answer.kind === 'same' && 'יש לכם את הגרסה האחרונה.'}
          {answer.kind === 'older' && 'הגרסה שלכם חדשה יותר מהאחרונה שפורסמה.'}
          {answer.kind === 'none' && 'עדיין לא פורסמה גרסה.'}
          {answer.kind === 'failed' && 'לא הצלחנו לבדוק עכשיו. בדקו את החיבור לאינטרנט ונסו שוב.'}
        </p>
      )}
    </div>
  )
}
