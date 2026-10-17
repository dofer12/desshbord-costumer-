import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { Link, Outlet, useNavigate } from 'react-router'
import { CALENDAR_THREE_DAYS_QUERY, CALENDAR_WEEK_QUERY, useMediaQuery } from '../../lib/useMediaQuery'
import { useNow } from '../../lib/useNow'
import { useAuth } from '../auth/authContext'
import { statusTextColor, taskTitle, UNKNOWN_STATUS_COLOR } from '../tasks/display'
import { isOverdue } from '../tasks/selectors'
import { useDirectory, useTasks } from '../tasks/tasksContext'
import { dayHeader, dayName, formatMinutes, HOUR_PX, layoutRange, rangeStart, rangeTitle, shiftAnchor, slotToDue, type PlacedItem } from './calendar'
import { dayKey, minuteOfDay, type DayKey } from './time'

/** The hour that a new task is put at from the button of a day, which is for the keyboard. */
const KEYBOARD_START_MINUTE = 9 * 60

/** A custom property of the style, which the stylesheet turns into a position. */
type Custom = CSSProperties & Record<`--${string}`, string | number>

function Block({ item, fromHour, color, now, onOpen }: { item: PlacedItem; fromHour: number; color: string; now: Date; onOpen(id: string): void }) {
  const { task } = item
  const customer = task.customer_name.trim()
  const classes = ['cal-item', isOverdue(task, now) ? 'is-late' : '', task.done_at !== null ? 'is-done' : ''].filter(Boolean).join(' ')
  const style: Custom = {
    '--top': `${((item.start - fromHour * 60) / 60) * HOUR_PX}px`,
    '--height': `${((item.end - item.start) / 60) * HOUR_PX}px`,
    '--column': item.column,
    '--columns': item.columns,
    background: color,
    color: statusTextColor(color),
  }
  const clock = formatMinutes(item.start)
  return (
    <button type="button" className={classes} style={style} aria-label={`${clock} ${taskTitle(task)}${customer ? `, ${customer}` : ''}`} onClick={() => onOpen(task.id)}>
      <span className="cal-item-time">{clock}</span>
      <span className="cal-item-title">{taskTitle(task)}</span>
      {customer && <span className="cal-item-customer">{customer}</span>}
    </button>
  )
}

/**
 * The calendar of the tasks: a week on a laptop, three days on a tablet, a day on a phone. Each task
 * is a block at the height of its time, beside the ones that it overlaps. A click on an empty place
 * opens a new task at that time, and the card of a task opens over the calendar.
 */
export function CalendarPage() {
  const me = useAuth((state) => state.profile?.id ?? '')
  const byId = useTasks((state) => state.tasks)
  const status = useTasks((state) => state.status)
  const error = useTasks((state) => state.error)
  const load = useTasks((state) => state.load)
  const statuses = useDirectory((state) => state.statuses)
  const profiles = useDirectory((state) => state.profiles)
  const navigate = useNavigate()
  const now = useNow()
  const wide = useMediaQuery(CALENDAR_WEEK_QUERY)
  const middle = useMediaQuery(CALENDAR_THREE_DAYS_QUERY)
  const days = wide ? 7 : middle ? 3 : 1
  // Until the person moves, the calendar is at today, whichever day that is as the hours go by.
  const [moved, setMoved] = useState<DayKey | null>(null)
  const [assignee, setAssignee] = useState('me')
  const scroller = useRef<HTMLDivElement>(null)
  const scrolled = useRef(false)

  const today = dayKey(now)
  const anchor = moved ?? today
  const start = rangeStart(anchor, days)
  const all = useMemo(() => Object.values(byId), [byId])
  const layout = useMemo(() => layoutRange(all, start, days, { assignee, meId: me }), [all, start, days, assignee, me])
  const colorOf = useMemo(() => new Map(statuses.map((s) => [s.key, s.color])), [statuses])
  const hours = Array.from({ length: layout.toHour - layout.fromHour }, (_, i) => layout.fromHour + i)
  const nowMinute = minuteOfDay(now)
  // The line is drawn on the column of today, if today is in the range, and while the time is inside the hours that are shown.
  const showNow = nowMinute >= layout.fromHour * 60 && nowMinute <= layout.toHour * 60
  const empty = layout.days.every((day) => day.items.length === 0)
  const loading = status === 'idle' || status === 'loading'

  // The first view is scrolled to an hour above the line of now, so that the part of the day that matters is in sight.
  useLayoutEffect(() => {
    if (scrolled.current || !scroller.current) return
    scrolled.current = true
    scroller.current.scrollTop = Math.max(0, ((nowMinute - layout.fromHour * 60) / 60) * HOUR_PX - HOUR_PX)
  })

  const openCard = (id: string) => void navigate(`/calendar/${id}`)
  const openNew = (due: string) => void navigate(`/calendar/new?due=${encodeURIComponent(due)}`)

  function clickColumn(event: MouseEvent<HTMLDivElement>, key: DayKey) {
    // A click on a task is the task's own.
    if ((event.target as HTMLElement).closest('.cal-item')) return
    const offset = event.clientY - event.currentTarget.getBoundingClientRect().top
    openNew(slotToDue(key, layout.fromHour * 60 + (offset / HOUR_PX) * 60))
  }

  const gridStyle: Custom = { '--cal-days': days, '--hours': hours.length, '--hour-h': `${HOUR_PX}px` }

  return (
    <section className="calendar-page" aria-labelledby="calendar-heading">
      <header className="page-head">
        <h2 id="calendar-heading">יומן</h2>
        <Link to="/calendar/new" className="btn primary">
          משימה חדשה
        </Link>
      </header>

      <div className="cal-toolbar">
        <div className="cal-nav" role="group" aria-label="ניווט בין תאריכים">
          <button type="button" className="btn" onClick={() => setMoved(shiftAnchor(anchor, days, -1))}>
            הקודם
          </button>
          <button type="button" className="btn" onClick={() => setMoved(null)}>
            היום
          </button>
          <button type="button" className="btn" onClick={() => setMoved(shiftAnchor(anchor, days, 1))}>
            הבא
          </button>
        </div>
        <p className="cal-title" aria-live="polite">
          {rangeTitle(start, days)}
        </p>
        <label className="cal-filter">
          שיוך
          <select value={assignee} onChange={(event) => setAssignee(event.target.value)}>
            <option value="me">המשימות שלי</option>
            <option value="all">כולם</option>
            <option value="none">ללא שיוך</option>
            {profiles
              .filter((person) => person.is_active)
              .map((person) => (
                <option key={person.id} value={person.id}>
                  {person.display_name}
                </option>
              ))}
          </select>
        </label>
      </div>

      {status === 'ready' && error && (
        <p role="alert" className="alert">
          {error}
          <button type="button" className="btn" onClick={() => void load()}>
            נסו שוב
          </button>
        </p>
      )}

      {loading ? (
        <p role="status" className="state">
          טוען משימות…
        </p>
      ) : status === 'error' ? (
        <div role="alert" className="alert state">
          <p>{error}</p>
          <button type="button" className="btn" onClick={() => void load()}>
            נסו שוב
          </button>
        </div>
      ) : (
        <>
          <div className="cal-scroll" role="region" aria-label="לוח המשימות" ref={scroller}>
            <div className="cal-grid" style={gridStyle}>
              <div className="cal-corner" aria-hidden="true" />
              {layout.days.map((day) => (
                <div key={day.key} className={day.key === today ? 'cal-head is-today' : 'cal-head'} aria-current={day.key === today ? 'date' : undefined}>
                  {dayHeader(day.key)}
                  <button type="button" className="cal-day-new" onClick={() => openNew(slotToDue(day.key, KEYBOARD_START_MINUTE))}>
                    משימה חדשה ב{dayName(day.key)}
                  </button>
                </div>
              ))}
              <ul className="cal-hours" aria-label="שעות היום" aria-hidden="true">
                {hours.map((hour) => (
                  <li key={hour}>{formatMinutes(hour * 60)}</li>
                ))}
              </ul>
              {layout.days.map((day) => (
                <div
                  key={day.key}
                  role="group"
                  aria-label={dayName(day.key)}
                  className={day.key === today ? 'cal-col is-today' : 'cal-col'}
                  onClick={(event) => clickColumn(event, day.key)}
                >
                  {day.items.map((item) => (
                    <Block
                      key={item.task.id}
                      item={item}
                      fromHour={layout.fromHour}
                      color={colorOf.get(item.task.status_key) ?? UNKNOWN_STATUS_COLOR}
                      now={now}
                      onOpen={openCard}
                    />
                  ))}
                  {showNow && day.key === today && (
                    <div role="separator" aria-label="עכשיו" className="cal-now" style={{ '--top': `${((nowMinute - layout.fromHour * 60) / 60) * HOUR_PX}px` } as Custom} />
                  )}
                </div>
              ))}
            </div>
          </div>
          {empty && <p className="state">אין משימות בטווח הזה. אפשר ללחוץ על מקום ביומן כדי להוסיף משימה.</p>}
        </>
      )}

      <Outlet />
    </section>
  )
}
