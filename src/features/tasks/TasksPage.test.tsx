import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { stubClipboard } from '../../test/clipboard'
import { createFakeBackend } from '../../test/fakeBackend'
import { createFakeGateway, DANA, OWNER } from '../../test/fakeGateway'
import type { FakeBackend } from '../../test/fakeBackend'
import { AuthProvider } from '../auth/AuthProvider'
import { createAuthStore } from '../auth/authStore'
import { createDirectoryStore } from './directoryStore'
import { TasksContext } from './tasksContext'
import { TasksPage } from './TasksPage'
import { createTasksStore } from './tasksStore'
import { networkError } from '../../test/fakeTasksGateways'
import { stubViewport } from '../../test/matchMedia'
import { renderApp } from '../../test/renderApp'
import { newTask, type Task } from './model'

const HOUR = 3_600_000
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString()

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    ...newTask(OWNER.id, id),
    no_glassix: true,
    title: `משימה ${id}`,
    assignee_id: DANA.id,
    created_at: '2026-10-01T08:00:00.000Z',
    updated_at: '2026-10-01T08:00:00.000Z',
    ...patch,
  }
}

interface Options {
  viewport?: 'wide' | 'narrow'
  path?: string
  backend?: (fake: FakeBackend) => void
}

/** The whole app at the tasks screen, signed in as Dana, over a pretend server that holds these tasks. */
function openTasks(tasks: Task[], options: Options = {}) {
  const viewport = stubViewport(options.viewport ?? 'wide')
  const user = userEvent.setup()
  const app = renderApp({
    path: options.path ?? '/tasks',
    configure: (fake) => fake.getStoredUserId.mockResolvedValue(DANA.id),
    configureBackend: (fake) => {
      for (const t of tasks) fake.tasks.rows.set(t.id, t)
      options.backend?.(fake)
    },
  })
  return { ...app, user, viewport }
}

const findList = () => screen.findByRole('table', { name: 'רשימת משימות' })
const titles = () =>
  screen
    .queryAllByRole('checkbox')
    .map((box) => box.getAttribute('aria-label') ?? '')
    .filter((label) => label.startsWith('בוצע: '))
    .map((label) => label.replace('בוצע: ', ''))
const search = () => screen.getByRole('searchbox', { name: 'חיפוש' })

describe('the rows', () => {
  it('come from the store, with the status in its colour and the words in Hebrew', async () => {
    openTasks([task('a', { title: 'לחזור ללקוח', status_key: 'cargo', customer_name: 'רונית כהן' })])
    const table = await findList()
    const row = within(table).getByRole('checkbox', { name: 'בוצע: לחזור ללקוח' }).closest('tr')!
    expect(within(row).getByRole('link', { name: 'לחזור ללקוח' })).toHaveAttribute('href', '/tasks/a')
    expect(within(row).getByText('Send to CARGO')).toHaveStyle({ background: '#1e88c9' })
    expect(within(row).getByText('רונית כהן')).toBeInTheDocument()
    expect(within(row).getByText('דנה')).toBeInTheDocument()
  })

  it('never include a task that was deleted', async () => {
    const { backend } = openTasks([task('a')])
    await findList()
    act(() => backend.tasks.pushRemote(task('b', { deleted_at: ago(HOUR) })))
    act(() => backend.tasks.pushRemote(task('c')))
    await waitFor(() => expect(titles()).toEqual(['משימה a', 'משימה c']))
  })

  it('show a task that another device saved', async () => {
    const { backend } = openTasks([task('a')])
    await findList()
    act(() => backend.tasks.pushRemote(task('b', { title: 'מהמחשב של דנה' })))
    expect(await screen.findByRole('link', { name: 'מהמחשב של דנה' })).toBeInTheDocument()
  })

  it('say that a task is late', async () => {
    openTasks([task('a', { due_at: ago(5 * HOUR) }), task('b', { due_at: ahead(5 * HOUR) })])
    await findList()
    expect(screen.getAllByText('באיחור')).toHaveLength(1)
  })
})

describe('the screen', () => {
  it('has a title, a link to a new task, and the number of the tasks', async () => {
    openTasks([task('a'), task('b')])
    await findList()
    expect(screen.getByRole('heading', { level: 2, name: 'משימות' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'משימה חדשה' })).toHaveAttribute('href', '/tasks/new')
    expect(screen.getByText('2 משימות')).toBeInTheDocument()
  })

  it('says "one task" for one', async () => {
    openTasks([task('a')])
    await findList()
    expect(screen.getByText('משימה אחת')).toBeInTheDocument()
  })

  it('shows a table on a wide screen and cards on a narrow one, and follows when the screen changes', async () => {
    const { viewport } = openTasks([task('a')], { viewport: 'wide' })
    await findList()
    expect(screen.queryByRole('list', { name: 'רשימת משימות' })).not.toBeInTheDocument()
    act(() => viewport.set(() => false))
    expect(await screen.findByRole('list', { name: 'רשימת משימות' })).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('opens the card of a task beside the list, which stays where it is', async () => {
    openTasks([task('a')], { path: '/tasks/a' })
    await findList()
    expect(await screen.findByRole('dialog', { name: 'משימה a' })).toBeInTheDocument()
    expect(titles()).toEqual(['משימה a'])
  })

  it('opens the card of a task when its title is clicked', async () => {
    const { user } = openTasks([task('a')])
    await user.click(await screen.findByRole('link', { name: 'משימה a' }))
    expect(await screen.findByRole('dialog', { name: 'משימה a' })).toBeInTheDocument()
  })

  it('opens a new task when the button is clicked, and keeps the filters of the list behind it', async () => {
    const { user } = openTasks([task('a'), task('b', { assignee_id: OWNER.id })])
    await findList()
    await user.selectOptions(screen.getByRole('combobox', { name: 'שיוך' }), 'all')
    await user.click(screen.getByRole('link', { name: 'משימה חדשה' }))
    expect(await screen.findByRole('dialog', { name: 'משימה חדשה' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'שיוך' })).toHaveValue('all')
    expect(titles()).toEqual(['משימה a', 'משימה b'])
  })
})

describe('the filter by person', () => {
  const tasks = [
    task('mine', { assignee_id: DANA.id }),
    task('his', { assignee_id: OWNER.id }),
    task('nobody', { assignee_id: null }),
  ]

  it('shows only my tasks at first', async () => {
    openTasks(tasks)
    await findList()
    expect(titles()).toEqual(['משימה mine'])
    expect(screen.getByRole('combobox', { name: 'שיוך' })).toHaveValue('me')
  })

  it('lists the others by name, and not the person who is signed in a second time', async () => {
    openTasks(tasks)
    await findList()
    const options = within(screen.getByRole('combobox', { name: 'שיוך' })).getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual(['המשימות שלי', 'כולם', 'ללא שיוך', 'הבעלים'])
  })

  it('shows everybody\'s tasks with "כולם", one person\'s with the name, and nobody\'s with "ללא שיוך"', async () => {
    const { user } = openTasks(tasks)
    await findList()
    const choose = screen.getByRole('combobox', { name: 'שיוך' })
    await user.selectOptions(choose, 'all')
    expect(titles()).toEqual(['משימה his', 'משימה mine', 'משימה nobody'])
    await user.selectOptions(choose, OWNER.id)
    expect(titles()).toEqual(['משימה his'])
    await user.selectOptions(choose, 'none')
    expect(titles()).toEqual(['משימה nobody'])
  })
})

describe('the status chips', () => {
  const tasks = [
    task('a', { status_key: 'processing' }),
    task('b', { status_key: 'processing' }),
    task('c', { status_key: 'cargo' }),
    task('d', { status_key: 'cargo', assignee_id: OWNER.id }),
  ]

  it('count the tasks of each status among the ones that the other filters let through', async () => {
    const { user } = openTasks(tasks)
    await findList()
    expect(screen.getByRole('button', { name: 'הכול, 3 משימות' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'בטיפול, 2 משימות' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send to CARGO, משימה אחת' })).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'שיוך' }), 'all')
    expect(screen.getByRole('button', { name: 'Send to CARGO, 2 משימות' })).toBeInTheDocument()
  })

  it('filter the list when pressed, and let go when pressed again', async () => {
    const { user } = openTasks(tasks)
    await findList()
    await user.click(screen.getByRole('button', { name: /^Send to CARGO/ }))
    expect(titles()).toEqual(['משימה c'])
    expect(screen.getByRole('button', { name: /^Send to CARGO/ })).toHaveAttribute('aria-pressed', 'true')
    // The counts of the other chips do not shrink to nothing because one chip is chosen.
    expect(screen.getByRole('button', { name: 'בטיפול, 2 משימות' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Send to CARGO/ }))
    expect(titles()).toEqual(['משימה a', 'משימה b', 'משימה c'])
  })
})

describe('the filters of state and shipping method', () => {
  const tasks = [
    task('open', { ship_method: 'CARGO' }),
    task('done', { done_at: ago(HOUR), ship_method: 'איסוף עצמי' }),
    task('other', { ship_method: 'איסוף עצמי' }),
  ]

  it('show the open tasks first, the done ones on request, and both with "הכול"', async () => {
    const { user } = openTasks(tasks)
    await findList()
    expect(titles()).toEqual(['משימה open', 'משימה other'])
    await user.click(screen.getByRole('button', { name: 'בוצעו' }))
    expect(titles()).toEqual(['משימה done'])
    await user.click(screen.getByRole('button', { name: 'הכול' }))
    expect(titles()).toEqual(['משימה open', 'משימה other', 'משימה done'])
  })

  it('offer the methods of the settings, once each, and a method that only a task has', async () => {
    openTasks([...tasks, task('odd', { ship_method: 'שליח פרטי' }), task('also', { ship_method: 'שליח פרטי' })])
    await findList()
    const options = within(screen.getByRole('combobox', { name: 'שיטת משלוח' })).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['כל השיטות', 'איסוף עצמי', 'משלוח עד הבית', 'נקודת איסוף', 'CARGO', 'שליח פרטי'])
  })

  it('filter by shipping method, with the methods of the settings', async () => {
    const { user } = openTasks(tasks)
    await findList()
    await user.selectOptions(screen.getByRole('combobox', { name: 'שיטת משלוח' }), 'איסוף עצמי')
    expect(titles()).toEqual(['משימה other'])
  })
})

describe('the sort control', () => {
  it('orders the list, the nearest due date first at the start', async () => {
    const { user } = openTasks([
      task('c', { title: 'ג', due_at: ahead(3 * HOUR), updated_at: '2026-10-03T00:00:00.000Z' }),
      task('a', { title: 'א', due_at: ahead(9 * HOUR), updated_at: '2026-10-01T00:00:00.000Z' }),
      task('b', { title: 'ב', due_at: ahead(6 * HOUR), updated_at: '2026-10-02T00:00:00.000Z' }),
    ])
    await findList()
    expect(titles()).toEqual(['ג', 'ב', 'א'])
    await user.selectOptions(screen.getByRole('combobox', { name: 'מיון' }), 'title-asc')
    expect(titles()).toEqual(['א', 'ב', 'ג'])
    await user.selectOptions(screen.getByRole('combobox', { name: 'מיון' }), 'updated-desc')
    expect(titles()).toEqual(['ג', 'ב', 'א'])
    await user.selectOptions(screen.getByRole('combobox', { name: 'מיון' }), 'due-desc')
    expect(titles()).toEqual(['א', 'ב', 'ג'])
  })
})

describe('the search box', () => {
  const tasks = [
    task('a', { title: 'חשבונית ללקוח', customer_phone: '050-123-4567' }),
    task('b', { title: 'החזרת מוצר', order_number: '10442' }),
    task('c', { title: 'תיאום משלוח', glassix_conversation_id: 'gx-77' }),
  ]

  it('is a search form with a name', async () => {
    openTasks(tasks)
    await findList()
    expect(screen.getByRole('search', { name: 'חיפוש משימות' })).toBeInTheDocument()
  })

  it('filters while the person types, in the fields that the search on the server looks in', async () => {
    const { user } = openTasks(tasks)
    await findList()
    await user.selectOptions(screen.getByRole('combobox', { name: 'שיוך' }), 'all')
    await user.type(search(), 'חשבונית')
    expect(titles()).toEqual(['חשבונית ללקוח'])
    await user.clear(search())
    await user.type(search(), '0501234')
    expect(titles()).toEqual(['חשבונית ללקוח'])
    await user.clear(search())
    await user.type(search(), '10442')
    expect(titles()).toEqual(['החזרת מוצר'])
    await user.clear(search())
    await user.type(search(), 'GX-77')
    expect(titles()).toEqual(['תיאום משלוח'])
  })

  it('finds a customer by the digits of the phone, however the number is written, and takes % and quotes as plain text', async () => {
    const { user } = openTasks(tasks)
    await findList()
    await user.selectOptions(screen.getByRole('combobox', { name: 'שיוך' }), 'all')
    for (const written of ['+972 50 123 4567', '050 123-4567', '(050)1234567', '0501234567']) {
      await user.clear(search())
      await user.type(search(), written)
      expect(titles(), written).toEqual(['חשבונית ללקוח'])
    }
    for (const plain of ['%', "'", '"', ',']) {
      await user.clear(search())
      await user.type(search(), plain)
      expect(titles(), plain).toEqual([])
    }
  })

  it('says that nothing fits, and offers to show everything', async () => {
    const { user } = openTasks(tasks)
    await findList()
    await user.type(search(), 'לא קיים')
    expect(screen.getByText('אין משימות שמתאימות לסינון.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'הציגו את כל המשימות' }))
    expect(titles()).toEqual(['חשבונית ללקוח', 'החזרת מוצר', 'תיאום משלוח'])
    expect(search()).toHaveValue('')
    expect(screen.getByRole('combobox', { name: 'שיוך' })).toHaveValue('all')
  })
})

describe('the search on the server', () => {
  const old = task('old', {
    title: 'חשבונית משנה שעברה',
    customer_name: 'משה לוי',
    assignee_id: OWNER.id,
    done_at: '2025-03-01T10:00:00.000Z',
  })

  it('finds what the screen does not have, whoever it is for and however old it is', async () => {
    const { user } = openTasks([task('a'), old])
    await findList()
    await user.type(search(), 'משה')
    expect(screen.getByText('אין משימות שמתאימות לסינון.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'חפש בכל המשימות' }))
    expect(await screen.findByText('תוצאות חיפוש בכל המשימות: משה')).toBeInTheDocument()
    expect(titles()).toEqual(['חשבונית משנה שעברה'])
    expect(screen.getByText('משימה אחת')).toBeInTheDocument()
  })

  it('runs when Enter is pressed in the box', async () => {
    const { user } = openTasks([old])
    await user.type(await screen.findByRole('searchbox', { name: 'חיפוש' }), 'משה{Enter}')
    expect(await screen.findByRole('link', { name: 'חשבונית משנה שעברה' })).toBeInTheDocument()
  })

  it('does nothing when Enter is pressed in an empty box', async () => {
    const { user, backend } = openTasks([task('a')])
    await findList()
    await user.type(search(), '{Enter}')
    await user.type(search(), '   {Enter}')
    expect(backend.tasks.calls.search).toBe(0)
    expect(screen.queryByText(/^תוצאות חיפוש בכל המשימות/)).not.toBeInTheDocument()
  })

  it('shows that it is searching, and does not start a second search meanwhile', async () => {
    let finish: () => void = () => undefined
    const { user, backend } = openTasks([old], {
      backend: (fake) => {
        const search = fake.tasks.gateway.search
        fake.tasks.gateway.search = (text) => new Promise((resolve) => (finish = () => resolve(search(text))))
      },
    })
    await user.type(await screen.findByRole('searchbox', { name: 'חיפוש' }), 'משה')
    await user.click(screen.getByRole('button', { name: 'חפש בכל המשימות' }))
    const busy = await screen.findByRole('button', { name: 'מחפש…' })
    expect(busy).toBeDisabled()
    await user.type(search(), '{Enter}')
    await act(async () => finish())
    expect(await screen.findByText('תוצאות חיפוש בכל המשימות: משה')).toBeInTheDocument()
    expect(backend.tasks.calls.search).toBe(1)
    expect(screen.getByRole('button', { name: 'חפש בכל המשימות' })).toBeEnabled()
  })

  it('is not offered for an empty box', async () => {
    openTasks([task('a')])
    await findList()
    expect(screen.getByRole('button', { name: 'חפש בכל המשימות' })).toBeDisabled()
  })

  it('puts the filters aside while the results are shown, and goes back to the list with "חזרה לרשימה"', async () => {
    const { user } = openTasks([task('a'), old])
    await findList()
    await user.type(search(), 'משה')
    await user.click(screen.getByRole('button', { name: 'חפש בכל המשימות' }))
    await screen.findByText('תוצאות חיפוש בכל המשימות: משה')
    expect(screen.queryByRole('group', { name: 'סינון לפי סטטוס' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'שיוך' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'מיון' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'חזרה לרשימה' }))
    expect(screen.queryByText('תוצאות חיפוש בכל המשימות: משה')).not.toBeInTheDocument()
    expect(search()).toHaveValue('')
    expect(titles()).toEqual(['משימה a'])
  })

  it('is left when the text of the box changes, because the results are no longer about it', async () => {
    const { user } = openTasks([task('a'), old])
    await findList()
    await user.type(search(), 'משה')
    await user.click(screen.getByRole('button', { name: 'חפש בכל המשימות' }))
    await screen.findByText('תוצאות חיפוש בכל המשימות: משה')
    await user.type(search(), 'x')
    expect(screen.queryByText(/^תוצאות חיפוש בכל המשימות/)).not.toBeInTheDocument()
  })

  it('says that it found nothing, when there is nothing on the screen either', async () => {
    const { user } = openTasks([])
    await user.type(await screen.findByRole('searchbox', { name: 'חיפוש' }), 'אין כזה')
    await user.click(screen.getByRole('button', { name: 'חפש בכל המשימות' }))
    expect(await screen.findByText('לא נמצאו משימות שמתאימות לחיפוש.')).toBeInTheDocument()
    expect(screen.queryByText(/עוד אין משימות/)).not.toBeInTheDocument()
  })

  it('does not show a found task that has been deleted since', async () => {
    const { user, backend } = openTasks([old])
    await user.type(await screen.findByRole('searchbox', { name: 'חיפוש' }), 'משה')
    await user.click(screen.getByRole('button', { name: 'חפש בכל המשימות' }))
    await screen.findByRole('link', { name: 'חשבונית משנה שעברה' })
    act(() => backend.tasks.pushRemote({ ...old, deleted_at: ago(HOUR), updated_at: ahead(HOUR) }))
    await waitFor(() => expect(screen.queryByRole('link', { name: 'חשבונית משנה שעברה' })).not.toBeInTheDocument())
  })

  it('says that it found nothing', async () => {
    const { user } = openTasks([task('a')])
    await findList()
    await user.type(search(), 'אין כזה')
    await user.click(screen.getByRole('button', { name: 'חפש בכל המשימות' }))
    expect(await screen.findByText('לא נמצאו משימות שמתאימות לחיפוש.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'הציגו את כל המשימות' })).not.toBeInTheDocument()
  })

  it('lets go of a found task that the store no longer has, after the connection came back and everything was read again', async () => {
    const { user, backend } = openTasks([task('a'), old])
    await findList()
    await user.type(search(), 'משה')
    await user.click(screen.getByRole('button', { name: 'חפש בכל המשימות' }))
    await screen.findByRole('link', { name: 'חשבונית משנה שעברה' })

    act(() => backend.tasks.setLive(false))
    act(() => backend.tasks.setLive(true))
    expect(await screen.findByText('לא נמצאו משימות שמתאימות לחיפוש.')).toBeInTheDocument()
  })

  it('shows the results of another search from the first page', async () => {
    const { user } = openTasks(Array.from({ length: 250 }, (_, i) => task(`t${String(i).padStart(3, '0')}`)))
    await findList()
    await user.type(search(), 'משימה')
    await user.click(screen.getByRole('button', { name: 'חפש בכל המשימות' }))
    await screen.findByText('תוצאות חיפוש בכל המשימות: משימה')
    await user.click(screen.getByRole('button', { name: 'העמוד הבא' }))
    expect(screen.getByText('עמוד 2 מתוך 2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'חפש בכל המשימות' }))
    await waitFor(() => expect(screen.getByText('עמוד 1 מתוך 2')).toBeInTheDocument())
  })

  it('says that it failed, and leaves the list as it was', async () => {
    const { user, backend } = openTasks([task('a')])
    await findList()
    await user.type(search(), 'משה')
    backend.tasks.failNext(networkError())
    await user.click(screen.getByRole('button', { name: 'חפש בכל המשימות' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('אין חיבור לשרת')
    expect(screen.queryByText(/^תוצאות חיפוש בכל המשימות/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'חפש בכל המשימות' })).toBeEnabled()

    await user.type(search(), 'ה')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps a found task up to date', async () => {
    const { user, backend } = openTasks([old])
    await user.type(await screen.findByRole('searchbox', { name: 'חיפוש' }), 'משה')
    await user.click(screen.getByRole('button', { name: 'חפש בכל המשימות' }))
    await screen.findByRole('link', { name: 'חשבונית משנה שעברה' })
    act(() => backend.tasks.pushRemote({ ...old, title: 'שונה בינתיים', updated_at: ahead(HOUR) }))
    expect(await screen.findByRole('link', { name: 'שונה בינתיים' })).toBeInTheDocument()
  })
})

describe('the box of done', () => {
  it('marks the task done through the store, and the open list lets go of it', async () => {
    const { user, backend } = openTasks([task('a'), task('b')])
    await findList()
    await user.click(screen.getByRole('checkbox', { name: 'בוצע: משימה a' }))
    await waitFor(() => expect(backend.tasks.upserts.at(-1)).toMatchObject({ id: 'a', patch: { done_at: expect.any(String) } }))
    expect(titles()).toEqual(['משימה b'])
  })

  it('marks a done task as not done again', async () => {
    const { user, backend } = openTasks([task('a', { done_at: ago(HOUR) })])
    await user.click(await screen.findByRole('button', { name: 'בוצעו' }))
    await user.click(screen.getByRole('checkbox', { name: 'בוצע: משימה a' }))
    await waitFor(() => expect(backend.tasks.upserts.at(-1)).toMatchObject({ id: 'a', patch: { done_at: null } }))
  })
})

describe('copying', () => {
  it('copies a phone number when it is clicked, and confirms it', async () => {
    const { user } = openTasks([task('a', { customer_phone: '050-123-4567' })])
    await findList()
    const writeText = stubClipboard()
    await user.click(screen.getByRole('button', { name: 'העתקת טלפון: 050-123-4567' }))
    expect(writeText).toHaveBeenCalledWith('050-123-4567')
    expect(await screen.findByText('הועתק')).toBeInTheDocument()
  })

  it('has a link that dials, on a narrow screen as well', async () => {
    openTasks([task('a', { customer_phone: '050-123-4567' })], { viewport: 'narrow' })
    expect(await screen.findByRole('link', { name: 'חיוג אל 050-123-4567' })).toHaveAttribute('href', 'tel:0501234567')
  })
})

describe('the pages', () => {
  const many = Array.from({ length: 250 }, (_, i) => task(`t${String(i).padStart(3, '0')}`))

  it('hold a hundred tasks each: 250 tasks make three pages', async () => {
    const { user } = openTasks(many)
    await findList()
    expect(titles()).toHaveLength(100)
    expect(screen.getByText('250 משימות')).toBeInTheDocument()
    expect(screen.getByText('עמוד 1 מתוך 3')).toBeInTheDocument()
    expect(titles()[0]).toBe('משימה t000')

    await user.click(screen.getByRole('button', { name: 'העמוד הבא' }))
    expect(titles()[0]).toBe('משימה t100')
    await user.click(screen.getByRole('button', { name: 'העמוד הבא' }))
    expect(titles()).toHaveLength(50)
    expect(screen.getByRole('button', { name: 'העמוד הבא' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'העמוד הקודם' }))
    expect(titles()[0]).toBe('משימה t100')
  })

  it('start again from the first page when the filter changes', async () => {
    const { user } = openTasks(many)
    await findList()
    await user.click(screen.getByRole('button', { name: 'העמוד הבא' }))
    expect(screen.getByText('עמוד 2 מתוך 3')).toBeInTheDocument()
    await user.type(search(), 't2')
    expect(screen.queryByText(/^עמוד/)).not.toBeInTheDocument()
    expect(titles()[0]).toBe('משימה t200')
    expect(titles()).toHaveLength(50)
  })

  it('start again from the first page when the chip, the person, the method or the state changes, and there are still pages', async () => {
    const { user } = openTasks(Array.from({ length: 250 }, (_, i) => task(`t${String(i).padStart(3, '0')}`, { ship_method: 'CARGO' })))
    await findList()
    const secondPage = () => user.click(screen.getByRole('button', { name: 'העמוד הבא' }))
    const firstPage = () => expect(screen.getByText('עמוד 1 מתוך 3')).toBeInTheDocument()

    await secondPage()
    await user.click(screen.getByRole('button', { name: /^בטיפול/ }))
    firstPage()
    await secondPage()
    await user.selectOptions(screen.getByRole('combobox', { name: 'שיוך' }), 'all')
    firstPage()
    await secondPage()
    await user.selectOptions(screen.getByRole('combobox', { name: 'שיטת משלוח' }), 'CARGO')
    firstPage()
    await secondPage()
    await user.click(screen.getByRole('button', { name: 'הכול' }))
    firstPage()
  })

  it('start again from the first page when the order changes', async () => {
    const { user } = openTasks(many)
    await findList()
    await user.click(screen.getByRole('button', { name: 'העמוד הבא' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'מיון' }), 'title-asc')
    expect(screen.getByText('עמוד 1 מתוך 3')).toBeInTheDocument()
  })

  it('come back to the last page that is there when the tasks get fewer', async () => {
    const { user } = openTasks(many.slice(0, 101))
    await findList()
    await user.click(screen.getByRole('button', { name: 'העמוד הבא' }))
    expect(titles()).toEqual(['משימה t100'])
    await user.click(screen.getByRole('checkbox', { name: 'בוצע: משימה t100' }))
    await waitFor(() => expect(screen.queryByText(/^עמוד/)).not.toBeInTheDocument())
    expect(titles()).toHaveLength(100)
  })
})

describe('the states', () => {
  it('says that it is loading, until the tasks come', async () => {
    let release: () => void = () => undefined
    openTasks([task('a')], {
      backend: (fake) => {
        const load = fake.tasks.gateway.loadInitial
        fake.tasks.gateway.loadInitial = (now) => new Promise((resolve) => (release = () => resolve(load(now))))
      },
    })
    expect(await screen.findByText('טוען משימות…')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    await act(async () => release())
    expect(await findList()).toBeInTheDocument()
    expect(screen.queryByText('טוען משימות…')).not.toBeInTheDocument()
  })

  it('says that it is loading while the store has not even started, and not that there is nothing', async () => {
    const login = createFakeGateway()
    login.getStoredUserId.mockResolvedValue(DANA.id)
    const auth = createAuthStore(login.gateway)
    await auth.getState().init()
    const fake = createFakeBackend()
    const tasks = createTasksStore({ gateway: fake.tasks.gateway, storage: fake.backend.outbox(DANA.id) })
    const directory = createDirectoryStore(fake.directory.gateway)
    render(
      <AuthProvider store={auth}>
        <TasksContext value={{ tasks, directory, attachments: fake.backend.attachments, history: fake.backend.tasks.loadHistory }}>
          <MemoryRouter>
            <TasksPage />
          </MemoryRouter>
        </TasksContext>
      </AuthProvider>,
    )
    expect(screen.getByText('טוען משימות…')).toBeInTheDocument()
    expect(screen.queryByText(/עוד אין משימות/)).not.toBeInTheDocument()
  })

  it('says that there are no tasks yet, and what to do', async () => {
    openTasks([])
    expect(await screen.findByText(/עוד אין משימות/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'משימה חדשה' })).toBeInTheDocument()
  })

  it('says that nothing fits the filter, and shows everything when asked to: the done tasks too', async () => {
    const { user } = openTasks([task('a', { assignee_id: OWNER.id }), task('b', { assignee_id: OWNER.id, done_at: ago(HOUR) })])
    expect(await screen.findByText('אין משימות שמתאימות לסינון.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'הציגו את כל המשימות' }))
    expect(titles()).toEqual(['משימה a', 'משימה b'])
  })

  it('says why the tasks could not be loaded, and loads them again on request', async () => {
    const { user } = openTasks([task('a')], { backend: (fake) => fake.tasks.failNext(networkError()) })
    expect(await screen.findByRole('alert')).toHaveTextContent('אין חיבור לשרת, או שהשרת לא זמין כרגע')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'נסו שוב' }))
    expect(await findList()).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the tasks on the screen when a later load fails, and says so', async () => {
    const { user, backend } = openTasks([task('a')])
    await findList()
    backend.tasks.setLive(true)
    backend.tasks.setLive(false)
    backend.tasks.failNext(networkError())
    backend.tasks.setLive(true)
    expect(await screen.findByRole('alert')).toHaveTextContent('אין חיבור לשרת')
    expect(titles()).toEqual(['משימה a'])
    await user.click(screen.getByRole('button', { name: 'נסו שוב' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })
})

describe('the keyboard', () => {
  it('reaches the search box, the filters and every row of the table, in that order', async () => {
    const { user } = openTasks([task('a', { customer_phone: '050-123-4567' })])
    await findList()
    const reached: string[] = []
    for (let step = 0; step < 40; step += 1) {
      await user.tab()
      const here = document.activeElement as HTMLInputElement | null
      const label = here?.getAttribute('aria-label') ?? here?.labels?.[0]?.textContent ?? here?.textContent ?? ''
      reached.push(label)
      if (label === 'העתקת טלפון: 050-123-4567') break
    }
    const at = (label: string) => reached.indexOf(label)
    expect(at('חיפוש')).toBeGreaterThanOrEqual(0)
    expect(at('חיפוש')).toBeLessThan(at('בוצע: משימה a'))
    expect(at('שיוך')).toBeGreaterThanOrEqual(0)
    expect(at('בוצע: משימה a')).toBeLessThan(at('משימה a'))
    expect(at('משימה a')).toBeLessThan(at('העתקת טלפון: 050-123-4567'))
  })

  it('has a table with a name', async () => {
    openTasks([task('a')])
    expect(await findList()).toHaveAccessibleName('רשימת משימות')
  })
})
