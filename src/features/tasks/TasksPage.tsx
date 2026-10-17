import { useMemo, useState, type FormEvent } from 'react'
import { Link, Outlet } from 'react-router'
import { useMediaQuery, WIDE_SCREEN_QUERY } from '../../lib/useMediaQuery'
import { useNow } from '../../lib/useNow'
import { useAuth } from '../auth/authContext'
import { toHebrewLoadError } from './errors'
import { Filters } from './Filters'
import { Pager } from './Pager'
import { normalizeQuery } from './search'
import { MY_OPEN_TASKS, filterTasks, paginate, sortByChoice, statusCounts, type SortChoice, type TaskFilter } from './selectors'
import { StatusChips } from './StatusChips'
import { TaskCards } from './TaskCards'
import { TaskTable } from './TaskTable'
import { useDirectory, useTasks } from './tasksContext'

const EVERYTHING: TaskFilter = { statusKey: null, assignee: 'all', shipMethod: null, state: 'all', text: '' }

const tasksWord = (n: number) => (n === 1 ? 'משימה אחת' : `${n} משימות`)

/** The results of a search on the server: the ids that it found, and the text that it was asked for. */
interface Found {
  query: string
  ids: string[]
}

export function TasksPage() {
  const me = useAuth((state) => state.profile?.id ?? '')
  const byId = useTasks((state) => state.tasks)
  const status = useTasks((state) => state.status)
  const error = useTasks((state) => state.error)
  const load = useTasks((state) => state.load)
  const markDone = useTasks((state) => state.markDone)
  const searchOnServer = useTasks((state) => state.search)
  const statuses = useDirectory((state) => state.statuses)
  const profiles = useDirectory((state) => state.profiles)
  const shipMethodsOfSettings = useDirectory((state) => state.settings.ship_methods)
  const now = useNow()
  const wide = useMediaQuery(WIDE_SCREEN_QUERY)

  const [filter, setFilter] = useState<TaskFilter>(MY_OPEN_TASKS)
  const [sort, setSort] = useState<SortChoice>('due-asc')
  const [page, setPage] = useState(1)
  const [found, setFound] = useState<Found | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const query = normalizeQuery(filter.text)
  // Results of a search are about the text that was searched; once the text is another, they are not shown.
  const showingFound = found !== null && found.query === query

  const all = useMemo(() => Object.values(byId), [byId])
  const shown = useMemo(() => {
    if (showingFound) return found.ids.flatMap((id) => (byId[id] && byId[id].deleted_at === null ? [byId[id]] : []))
    return filterTasks(all, filter, me)
  }, [showingFound, found, byId, all, filter, me])
  const counts = useMemo(() => statusCounts(filterTasks(all, { ...filter, statusKey: null }, me)), [all, filter, me])
  const total = useMemo(() => Object.values(counts).reduce((sum, n) => sum + n, 0), [counts])
  const view = useMemo(() => paginate(sortByChoice(shown, sort), page), [shown, sort, page])

  const statusByKey = useMemo(() => new Map(statuses.map((s) => [s.key, s])), [statuses])
  const peopleById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles])
  const shipMethods = useMemo(() => {
    const used = all.map((task) => task.ship_method).filter((method) => method !== '' && !shipMethodsOfSettings.includes(method))
    return [...shipMethodsOfSettings, ...new Set(used)]
  }, [all, shipMethodsOfSettings])

  function change(next: TaskFilter) {
    setFilter(next)
    setPage(1)
    setSearchError(null)
  }

  async function searchEverywhere(event: FormEvent) {
    event.preventDefault()
    if (!query || searching) return
    setSearching(true)
    setSearchError(null)
    try {
      const rows = await searchOnServer(query)
      setFound({ query, ids: rows.map((row) => row.id) })
      setPage(1)
    } catch (err) {
      setSearchError(toHebrewLoadError(err))
    } finally {
      setSearching(false)
    }
  }

  function leaveSearch() {
    setFound(null)
    change({ ...filter, text: '' })
  }

  const List = wide ? TaskTable : TaskCards
  const loading = status === 'idle' || status === 'loading'

  return (
    <section className="tasks-page" aria-labelledby="tasks-heading">
      <header className="page-head">
        <h2 id="tasks-heading">משימות</h2>
        <Link to="/tasks/new" className="btn primary">
          משימה חדשה
        </Link>
      </header>

      <form className="search" role="search" aria-label="חיפוש משימות" onSubmit={(event) => void searchEverywhere(event)}>
        <input
          type="search"
          aria-label="חיפוש"
          placeholder="שם, טלפון, מספר הזמנה, Glassix…"
          value={filter.text}
          onChange={(event) => change({ ...filter, text: event.target.value })}
        />
        <button type="submit" className="btn" disabled={!query || searching}>
          {searching ? 'מחפש…' : 'חפש בכל המשימות'}
        </button>
      </form>
      {searchError && (
        <p role="alert" className="alert">
          {searchError}
        </p>
      )}

      {showingFound ? (
        <p className="found-bar" role="status">
          תוצאות חיפוש בכל המשימות: {found.query}
          <button type="button" className="btn" onClick={leaveSearch}>
            חזרה לרשימה
          </button>
        </p>
      ) : (
        <StatusChips
          statuses={statuses}
          counts={counts}
          total={total}
          selected={filter.statusKey}
          onSelect={(statusKey) => change({ ...filter, statusKey })}
        />
      )}

      <Filters
        filter={filter}
        onChange={change}
        sort={sort}
        onSort={(next) => {
          setSort(next)
          setPage(1)
        }}
        people={profiles.filter((person) => person.id !== me)}
        shipMethods={shipMethods}
        disabled={showingFound}
      />

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
      ) : all.length === 0 && !showingFound ? (
        <p className="state">עוד אין משימות. אפשר להתחיל עם ״משימה חדשה״.</p>
      ) : shown.length === 0 ? (
        <div className="state">
          <p>{showingFound ? 'לא נמצאו משימות שמתאימות לחיפוש.' : 'אין משימות שמתאימות לסינון.'}</p>
          {!showingFound && (
            <button type="button" className="btn" onClick={() => change(EVERYTHING)}>
              הציגו את כל המשימות
            </button>
          )}
        </div>
      ) : (
        <>
          <p className="result-count" role="status">
            {tasksWord(view.total)}
          </p>
          <List tasks={view.items} statuses={statusByKey} people={peopleById} now={now} onToggleDone={markDone} />
          <Pager page={view.page} pageCount={view.pageCount} onPage={setPage} />
        </>
      )}

      <Outlet />
    </section>
  )
}
