import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { openAdmin } from '../../test/adminHarness'
import { task } from '../../test/cardHarness'
import { DANA, OWNER } from '../../test/fakeGateway'
import type { Backend } from '../tasks/backend'
import type { Status } from '../tasks/gateways'
import { WRITE_MESSAGES } from './writeErrors'

// The statuses of the tasks, which an administrator renames, colours, blocks and puts in order. A status
// is never deleted: tasks keep it, and its key never changes. The fake server has four of them.

const list = () => screen.findByRole('list', { name: 'רשימת הסטטוסים' })
const rows = () => within(screen.getByRole('list', { name: 'רשימת הסטטוסים' })).getAllByRole('listitem')
const names = () => rows().map((row) => (within(row).getByLabelText('שם הסטטוס') as HTMLInputElement).value)
const rowOf = (name: string) => {
  const row = rows().find((item) => (within(item).getByLabelText('שם הסטטוס') as HTMLInputElement).value === name)
  if (!row) throw new Error(`no row for ${name}`)
  return within(row)
}
const open = (options: Parameters<typeof openAdmin>[0] = {}) => openAdmin({ path: '/admin/statuses', ...options })

const ORDER = ['בטיפול', 'הושלמו', 'Send to CARGO', 'הזמנת חו"ל']

describe('the list of the statuses', () => {
  it('shows them in the order of their places, each with a swatch of its colour, its name, its colour and its state', async () => {
    await open()
    await list()
    expect(names()).toEqual(ORDER)
    const first = rowOf('בטיפול')
    expect(first.getByLabelText('שם הסטטוס')).toHaveValue('בטיפול')
    expect(first.getByLabelText('צבע')).toHaveValue('#22a559')
    expect(first.getByLabelText('קוד הצבע')).toHaveValue('#22a559')
    expect(first.getByLabelText('פעיל')).toBeChecked()
    expect(rows()[0].querySelector('.swatch')).toHaveStyle({ backgroundColor: '#22a559' })
  })

  it('is in the order of the places and not the order in which the server holds them', async () => {
    await open({
      backend: (fake) => {
        fake.directory.statuses = [...fake.directory.statuses].reverse()
      },
    })
    await list()
    expect(names()).toEqual(ORDER)
  })

  it('shows a status that is blocked muted, at its place, and not checked as active', async () => {
    await open({
      backend: (fake) => {
        fake.directory.statuses = fake.directory.statuses.map((s) => (s.key === 'completed' ? { ...s, is_active: false } : s))
      },
    })
    await list()
    expect(names()).toEqual(ORDER)
    expect(rowOf('הושלמו').getByLabelText('פעיל')).not.toBeChecked()
    expect(rows()[1]).toHaveClass('status-off')
    expect(rows()[0]).not.toHaveClass('status-off')
  })

  it('has no button to delete a status', async () => {
    await open()
    await list()
    expect(screen.queryByRole('button', { name: /מחיקה|מחק|הסרה|הסר/ })).not.toBeInTheDocument()
  })

  it('says that it is loading, and shows no list, until the statuses are there', async () => {
    let arrive: (loaded: Awaited<ReturnType<Backend['directory']['load']>>) => void = () => undefined
    const { backend } = await open({
      backend: (fake) => {
        fake.backend.directory.load = () => new Promise((resolve) => (arrive = resolve))
      },
    })
    expect(await screen.findByText('טוען…')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'רשימת הסטטוסים' })).not.toBeInTheDocument()
    arrive({ statuses: backend.directory.statuses, profiles: backend.directory.profiles, settings: backend.directory.settings })
    await list()
    expect(screen.queryByText('טוען…')).not.toBeInTheDocument()
  })

  it('has the heading of the page and a button for a new status', async () => {
    await open()
    expect(await screen.findByRole('heading', { level: 3, name: 'סטטוסים' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'סטטוס חדש' })).toBeEnabled()
  })

  it('is brought up to date by what another administrator does, as the live connection tells it', async () => {
    const { backend } = await open()
    await list()
    act(() => {
      backend.directory.statuses = backend.directory.statuses.map((s) => (s.key === 'cargo' ? { ...s, name_he: 'נשלח לקרגו', color: '#112233' } : s))
      backend.directory.changed()
    })
    await waitFor(() => expect(names()).toContain('נשלח לקרגו'))
    expect(rowOf('נשלח לקרגו').getByLabelText('צבע')).toHaveValue('#112233')
    expect(names()).not.toContain('Send to CARGO')
  })

  it('says that the statuses could not be loaded at the start, and loads them again when asked', async () => {
    const { user, backend } = await open({ backend: (fake) => fake.directory.setOffline(true) })
    const note = await screen.findByRole('alert')
    expect(note).toHaveTextContent('אין חיבור לשרת')
    expect(screen.queryByRole('list', { name: 'רשימת הסטטוסים' })).not.toBeInTheDocument()
    backend.directory.setOffline(false)
    await user.click(within(note).getByRole('button', { name: 'נסו שוב' }))
    await list()
    expect(names()).toEqual(ORDER)
  })
})

describe('the first and the last', () => {
  it('has no way up for the first and no way down for the last', async () => {
    await open()
    await list()
    expect(rowOf('בטיפול').queryByRole('button', { name: /הזזה למעלה/ })).not.toBeInTheDocument()
    expect(rowOf('בטיפול').getByRole('button', { name: 'הזזה למטה: בטיפול' })).toBeEnabled()
    expect(rowOf('הזמנת חו"ל').queryByRole('button', { name: /הזזה למטה/ })).not.toBeInTheDocument()
    expect(rowOf('הזמנת חו"ל').getByRole('button', { name: 'הזזה למעלה: הזמנת חו"ל' })).toBeEnabled()
    expect(rowOf('הושלמו').getByRole('button', { name: 'הזזה למעלה: הושלמו' })).toBeEnabled()
    expect(rowOf('הושלמו').getByRole('button', { name: 'הזזה למטה: הושלמו' })).toBeEnabled()
  })
})

describe('the name', () => {
  async function edit(name = 'בטיפול') {
    const app = await open()
    await list()
    // The field is found once: a row is found by the name in its field, and that changes as the person types.
    const field = rowOf(name).getByLabelText('שם הסטטוס')
    return { ...app, input: () => field }
  }

  it('is changed in the row and saved with the Enter key', async () => {
    const { input, user, backend } = await edit()
    const update = vi.spyOn(backend.backend.admin.statuses, 'update')
    await user.clear(input())
    await user.type(input(), 'בטיפול מיידי{Enter}')
    await waitFor(() => expect(names()).toContain('בטיפול מיידי'))
    expect(update).toHaveBeenCalledExactlyOnceWith('processing', { name_he: 'בטיפול מיידי' })
    expect(backend.directory.statuses.find((s) => s.key === 'processing')?.name_he).toBe('בטיפול מיידי')
  })

  it('is saved when the person leaves the field', async () => {
    const { input, user, backend } = await edit()
    const update = vi.spyOn(backend.backend.admin.statuses, 'update')
    await user.clear(input())
    await user.type(input(), 'בטיפול מיידי')
    await user.tab()
    await waitFor(() => expect(names()).toContain('בטיפול מיידי'))
    expect(update).toHaveBeenCalledExactlyOnceWith('processing', { name_he: 'בטיפול מיידי' })
  })

  it('is saved trimmed', async () => {
    const { input, user, backend } = await edit()
    const update = vi.spyOn(backend.backend.admin.statuses, 'update')
    await user.clear(input())
    await user.type(input(), '   בטיפול מיידי  {Enter}')
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith('processing', { name_he: 'בטיפול מיידי' })
  })

  it('is sent once for the Enter key and the leaving of the field that follows it, and stays as it was typed until the answer is there', async () => {
    const { input, user, backend } = await edit()
    let finish: (row: Status) => void = () => undefined
    const update = vi.spyOn(backend.backend.admin.statuses, 'update').mockReturnValue(new Promise<Status>((resolve) => (finish = resolve)))
    await user.clear(input())
    await user.type(input(), 'בטיפול מיידי{Enter}')
    await user.tab()
    expect(update).toHaveBeenCalledTimes(1)
    expect(input()).toHaveValue('בטיפול מיידי')
    finish({ key: 'processing', name_he: 'בטיפול מיידי', color: '#22a559', sort: 1, is_active: true })
    await waitFor(() => expect(input()).not.toHaveAttribute('readonly'))
    expect(input()).toHaveValue('בטיפול מיידי')
  })

  it('goes back to what it was with the Escape key, and nothing is sent', async () => {
    const { input, user, backend } = await edit()
    const update = vi.spyOn(backend.backend.admin.statuses, 'update')
    await user.type(input(), ' וגם')
    expect(input()).toHaveValue('בטיפול וגם')
    await user.keyboard('{Escape}')
    expect(input()).toHaveValue('בטיפול')
    await user.tab()
    expect(update).not.toHaveBeenCalled()
  })

  it('is not sent when it was not changed, or only in the spaces around it', async () => {
    const { input, user, backend } = await edit()
    const update = vi.spyOn(backend.backend.admin.statuses, 'update')
    await user.click(input())
    await user.tab()
    await user.click(input())
    await user.type(input(), '   {Enter}')
    expect(update).not.toHaveBeenCalled()
    expect(input()).toHaveValue('בטיפול')
  })

  it.each([
    ['empty', '', 'הזינו שם לסטטוס.'],
    ['of only spaces', '   ', 'הזינו שם לסטטוס.'],
    ['too long', 'א'.repeat(41), 'השם ארוך מדי: עד 40 תווים.'],
    ['the name of another status in another case', 'SEND to cargo', 'יש כבר סטטוס בשם הזה.'],
  ])('says what is wrong with a name that is %s, in the row, and sends nothing', async (_what, typed, message) => {
    const { input, user, backend } = await edit()
    const update = vi.spyOn(backend.backend.admin.statuses, 'update')
    await user.clear(input())
    if (typed) await user.type(input(), typed)
    await user.keyboard('{Enter}')
    expect(within(input().closest('li') as HTMLElement).getByText(message)).toBeInTheDocument()
    expect(input()).toBeInvalid()
    expect(input()).toHaveAccessibleDescription(message)
    expect(update).not.toHaveBeenCalled()
  })

  it('takes the message away when the name is put right and saved', async () => {
    const { input, user } = await edit()
    await user.clear(input())
    await user.keyboard('{Enter}')
    expect(screen.getByText('הזינו שם לסטטוס.')).toBeInTheDocument()
    await user.type(input(), 'בטיפול מיידי{Enter}')
    await waitFor(() => expect(names()).toContain('בטיפול מיידי'))
    expect(screen.queryByText('הזינו שם לסטטוס.')).not.toBeInTheDocument()
  })

  it('takes the message away when another administrator changes the name, which is then what the field shows', async () => {
    const { input, user, backend } = await edit()
    await user.clear(input())
    await user.keyboard('{Enter}')
    expect(screen.getByText('הזינו שם לסטטוס.')).toBeInTheDocument()
    act(() => {
      backend.directory.statuses = backend.directory.statuses.map((s) => (s.key === 'processing' ? { ...s, name_he: 'השם של האחר' } : s))
      backend.directory.changed()
    })
    await waitFor(() => expect(input()).toHaveValue('השם של האחר'))
    expect(screen.queryByText('הזינו שם לסטטוס.')).not.toBeInTheDocument()
    expect(input()).not.toBeInvalid()
  })

  it('takes the message away when the person gives up with Escape', async () => {
    const { input, user } = await edit()
    await user.clear(input())
    await user.keyboard('{Enter}')
    expect(screen.getByText('הזינו שם לסטטוס.')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByText('הזינו שם לסטטוס.')).not.toBeInTheDocument()
    expect(input()).toHaveValue('בטיפול')
  })

  it('may be the name that a status had before, since it is not in use by any other', async () => {
    const { input, user, backend } = await edit()
    await user.clear(input())
    await user.type(input(), 'חדש{Enter}')
    await waitFor(() => expect(names()).toContain('חדש'))
    // The same field: the row is still the row of the same status.
    await user.clear(input())
    await user.type(input(), 'בטיפול{Enter}')
    await waitFor(() => expect(names()).toContain('בטיפול'))
    expect(backend.directory.statuses.find((s) => s.key === 'processing')?.name_he).toBe('בטיפול')
  })

  it('may change the capitals of its own name: the name that it has is not the name of another status', async () => {
    const { input, user, backend } = await edit('Send to CARGO')
    await user.clear(input())
    await user.type(input(), 'send to cargo{Enter}')
    await waitFor(() => expect(names()).toContain('send to cargo'))
    expect(backend.directory.statuses.find((s) => s.key === 'cargo')?.name_he).toBe('send to cargo')
  })

  it('is not saved while a keyboard is still composing it, and is saved by the Enter key that ends the composition', async () => {
    const { input, backend } = await edit()
    const update = vi.spyOn(backend.backend.admin.statuses, 'update')
    fireEvent.change(input(), { target: { value: 'בטיפול מיידי' } })
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true })
    expect(update).not.toHaveBeenCalled()
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(update).toHaveBeenCalledExactlyOnceWith('processing', { name_he: 'בטיפול מיידי' }))
  })

  it('goes back to what the server has, and says why, when it could not be saved', async () => {
    const { input, user, backend } = await edit()
    vi.spyOn(backend.backend.admin.statuses, 'update').mockRejectedValue(new TypeError('Failed to fetch'))
    await user.clear(input())
    await user.type(input(), 'בטיפול מיידי{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent(WRITE_MESSAGES.network)
    expect(input()).toHaveValue('בטיפול')
    expect(names()).toEqual(ORDER)
  })
})

describe('the colour', () => {
  async function pick() {
    const app = await open()
    await list()
    const row = () => rowOf('בטיפול')
    return { ...app, row, picker: () => row().getByLabelText('צבע'), hex: () => row().getByLabelText('קוד הצבע') }
  }

  it('is chosen with the colour input, saved once the choice is made, and the swatch and the code agree', async () => {
    const { picker, hex, backend } = await pick()
    const update = vi.spyOn(backend.backend.admin.statuses, 'update')
    fireEvent.change(picker(), { target: { value: '#ff0000' } })
    await waitFor(() => expect(update).toHaveBeenCalledExactlyOnceWith('processing', { color: '#ff0000' }))
    await waitFor(() => expect(rows()[0].querySelector('.swatch')).toHaveStyle({ backgroundColor: '#ff0000' }))
    expect(hex()).toHaveValue('#ff0000')
    expect(picker()).toHaveValue('#ff0000')
  })

  it('is typed as a code, saved with Enter, and the colour input and the swatch follow', async () => {
    const { picker, hex, user, backend } = await pick()
    const update = vi.spyOn(backend.backend.admin.statuses, 'update')
    await user.clear(hex())
    await user.type(hex(), '#00ff00')
    // The colour input follows the code as it is typed, before it is saved.
    expect(picker()).toHaveValue('#00ff00')
    expect(update).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(update).toHaveBeenCalledExactlyOnceWith('processing', { color: '#00ff00' }))
    await waitFor(() => expect(rows()[0].querySelector('.swatch')).toHaveStyle({ backgroundColor: '#00ff00' }))
  })

  it('is saved when the person leaves the code, and in lower-case when it was typed in capitals', async () => {
    const { hex, user, backend } = await pick()
    const update = vi.spyOn(backend.backend.admin.statuses, 'update')
    await user.clear(hex())
    await user.type(hex(), '#ABCDEF')
    await user.tab()
    await waitFor(() => expect(update).toHaveBeenCalledExactlyOnceWith('processing', { color: '#abcdef' }))
    await waitFor(() => expect(hex()).toHaveValue('#abcdef'))
  })

  it('says what is wrong with a code that is not a colour, keeps the colour that there is, and sends nothing', async () => {
    const { picker, hex, user, backend } = await pick()
    const update = vi.spyOn(backend.backend.admin.statuses, 'update')
    await user.clear(hex())
    await user.type(hex(), '#12345{Enter}')
    expect(screen.getByText('הצבע צריך להיות בצורה #rrggbb.')).toBeInTheDocument()
    expect(hex()).toBeInvalid()
    expect(picker()).toHaveValue('#22a559')
    expect(update).not.toHaveBeenCalled()
  })

  it('goes back to what it was with the Escape key', async () => {
    const { picker, hex, user, backend } = await pick()
    const update = vi.spyOn(backend.backend.admin.statuses, 'update')
    await user.clear(hex())
    await user.type(hex(), '#00ff00')
    await user.keyboard('{Escape}')
    expect(hex()).toHaveValue('#22a559')
    expect(picker()).toHaveValue('#22a559')
    expect(update).not.toHaveBeenCalled()
  })

  it('is not sent when it is the colour that there is, in whatever case, and the code shows the colour that there is', async () => {
    const { hex, user, backend } = await pick()
    const update = vi.spyOn(backend.backend.admin.statuses, 'update')
    await user.clear(hex())
    await user.type(hex(), '#22A559{Enter}')
    expect(update).not.toHaveBeenCalled()
    expect(hex()).toHaveValue('#22a559')
  })

  it('takes the message away when another administrator changes the colour, which is then what the fields show', async () => {
    const { picker, hex, user, backend } = await pick()
    await user.clear(hex())
    await user.type(hex(), '#12345{Enter}')
    expect(screen.getByText('הצבע צריך להיות בצורה #rrggbb.')).toBeInTheDocument()
    act(() => {
      backend.directory.statuses = backend.directory.statuses.map((s) => (s.key === 'processing' ? { ...s, color: '#445566' } : s))
      backend.directory.changed()
    })
    await waitFor(() => expect(hex()).toHaveValue('#445566'))
    expect(picker()).toHaveValue('#445566')
    expect(screen.queryByText('הצבע צריך להיות בצורה #rrggbb.')).not.toBeInTheDocument()
    expect(hex()).not.toBeInvalid()
  })

  it('is written from left to right, as the code of a colour is', async () => {
    const { hex } = await pick()
    expect(hex()).toHaveAttribute('dir', 'ltr')
  })

  it('goes back to what the server has, and says why, when it could not be saved', async () => {
    const { picker, hex, backend } = await pick()
    vi.spyOn(backend.backend.admin.statuses, 'update').mockRejectedValue({ status: 403, code: '42501' })
    fireEvent.change(picker(), { target: { value: '#ff0000' } })
    expect(await screen.findByRole('alert')).toHaveTextContent(WRITE_MESSAGES.forbidden)
    await waitFor(() => expect(picker()).toHaveValue('#22a559'))
    expect(hex()).toHaveValue('#22a559')
  })
})

describe('a colour that is not what the colour input can show', () => {
  const withColor = (color: string) =>
    open({
      backend: (fake) => {
        fake.directory.statuses = fake.directory.statuses.map((s) => (s.key === 'processing' ? { ...s, color } : s))
      },
    })

  it('is shown in the code as it is kept, with a black colour input, and the screen goes on working', async () => {
    const { user, backend } = await withColor('red')
    await list()
    expect(rowOf('בטיפול').getByLabelText('קוד הצבע')).toHaveValue('red')
    expect(rowOf('בטיפול').getByLabelText('צבע')).toHaveValue('#000000')
    const update = vi.spyOn(backend.backend.admin.statuses, 'update')
    await user.click(rowOf('בטיפול').getByLabelText('פעיל'))
    await waitFor(() => expect(update).toHaveBeenCalledExactlyOnceWith('processing', { is_active: false }))
  })

  it('is shown in lower-case by the colour input when it is kept in capitals, and is the colour that there is', async () => {
    const { user, backend } = await withColor('#22A559')
    await list()
    expect(rowOf('בטיפול').getByLabelText('צבע')).toHaveValue('#22a559')
    expect(rows()[0].querySelector('.swatch')).toHaveStyle({ backgroundColor: '#22a559' })
    // The same colour, in lower-case, is not a change.
    const update = vi.spyOn(backend.backend.admin.statuses, 'update')
    const hex = rowOf('בטיפול').getByLabelText('קוד הצבע')
    await user.clear(hex)
    await user.type(hex, '#22a559{Enter}')
    expect(update).not.toHaveBeenCalled()
  })
})

describe('while a request is on its way', () => {
  it('lets nothing else be changed, and lets it be changed again when the answer is there', async () => {
    const { user, backend } = await open()
    await list()
    let finish: () => void = () => undefined
    vi.spyOn(backend.backend.admin.statuses, 'reorder').mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
    await user.click(rowOf('בטיפול').getByRole('button', { name: 'הזזה למטה: בטיפול' }))
    const other = rowOf('הושלמו')
    expect(other.getByLabelText('שם הסטטוס')).toHaveAttribute('readonly')
    expect(other.getByLabelText('קוד הצבע')).toHaveAttribute('readonly')
    expect(other.getByLabelText('צבע')).toBeDisabled()
    expect(other.getByLabelText('פעיל')).toBeDisabled()
    finish()
    await waitFor(() => expect(other.getByLabelText('פעיל')).toBeEnabled())
    expect(other.getByLabelText('שם הסטטוס')).not.toHaveAttribute('readonly')
    expect(other.getByLabelText('קוד הצבע')).not.toHaveAttribute('readonly')
    expect(other.getByLabelText('צבע')).toBeEnabled()
  })
})

describe('blocking', () => {
  const openWith = (tasks: ReturnType<typeof task>[] = []) => openAdmin({ path: '/admin/statuses', tasks })

  it('blocks a status and shows it blocked, and unblocks it', async () => {
    const { user, backend } = await openWith()
    await list()
    const update = vi.spyOn(backend.backend.admin.statuses, 'update')
    await user.click(rowOf('הושלמו').getByLabelText('פעיל'))
    await waitFor(() => expect(rowOf('הושלמו').getByLabelText('פעיל')).not.toBeChecked())
    expect(update).toHaveBeenCalledExactlyOnceWith('completed', { is_active: false })
    expect(rows()[1]).toHaveClass('status-off')
    expect(names()).toEqual(ORDER)

    await user.click(rowOf('הושלמו').getByLabelText('פעיל'))
    await waitFor(() => expect(rowOf('הושלמו').getByLabelText('פעיל')).toBeChecked())
    expect(update).toHaveBeenLastCalledWith('completed', { is_active: true })
    expect(rows()[1]).not.toHaveClass('status-off')
  })

  it('says how many open tasks have a status that is blocked, and blocks it all the same', async () => {
    const tasks = [task('a'), task('b'), task('c', { done_at: '2026-10-10T08:00:00.000Z' }), task('d', { status_key: 'cargo' })]
    const { user, backend } = await openWith(tasks)
    await list()
    expect(screen.queryByText(/משימות פתוחות/)).not.toBeInTheDocument()
    await user.click(rowOf('בטיפול').getByLabelText('פעיל'))
    await waitFor(() => expect(rowOf('בטיפול').getByLabelText('פעיל')).not.toBeChecked())
    expect(rowOf('בטיפול').getByText('יש 2 משימות פתוחות בסטטוס הזה. הן שומרות אותו.')).toBeInTheDocument()
    expect(backend.directory.statuses.find((s) => s.key === 'processing')?.is_active).toBe(false)
    // The tasks keep it: the pretend server did not touch them.
    expect(backend.tasks.rows.get('a')?.status_key).toBe('processing')
    // And no other status says anything: not the one that is in use and has an open task of its own.
    expect(screen.getAllByText(/בסטטוס הזה/)).toHaveLength(1)
  })

  it('says it in the singular for one task', async () => {
    const { user } = await openWith([task('a')])
    await list()
    await user.click(rowOf('בטיפול').getByLabelText('פעיל'))
    expect(await screen.findByText('יש משימה פתוחה אחת בסטטוס הזה. היא שומרת אותו.')).toBeInTheDocument()
  })

  it('does not count a task that is done, and says nothing of a status that no task has', async () => {
    const { user } = await openWith([task('c', { done_at: '2026-10-10T08:00:00.000Z' })])
    await list()
    await user.click(rowOf('בטיפול').getByLabelText('פעיל'))
    await waitFor(() => expect(rowOf('בטיפול').getByLabelText('פעיל')).not.toBeChecked())
    // Neither the plural nor the singular of the note.
    expect(screen.queryByText(/בסטטוס הזה/)).not.toBeInTheDocument()
  })

  it('takes the note away when the status is unblocked', async () => {
    const { user } = await openWith([task('a')])
    await list()
    await user.click(rowOf('בטיפול').getByLabelText('פעיל'))
    expect(await screen.findByText(/משימה פתוחה אחת/)).toBeInTheDocument()
    await user.click(rowOf('בטיפול').getByLabelText('פעיל'))
    await waitFor(() => expect(screen.queryByText(/משימה פתוחה אחת/)).not.toBeInTheDocument())
  })

  it('says it of a status that was blocked already, as soon as the page is open', async () => {
    await openAdmin({
      path: '/admin/statuses',
      tasks: [task('a'), task('b')],
      backend: (fake) => {
        fake.directory.statuses = fake.directory.statuses.map((s) => (s.key === 'processing' ? { ...s, is_active: false } : s))
      },
    })
    await list()
    expect(await screen.findByText('יש 2 משימות פתוחות בסטטוס הזה. הן שומרות אותו.')).toBeInTheDocument()
  })

  it('stays as it was, and says why, when it could not be blocked', async () => {
    const { user, backend } = await openWith()
    await list()
    vi.spyOn(backend.backend.admin.statuses, 'update').mockRejectedValue({ status: 403, code: '42501' })
    await user.click(rowOf('הושלמו').getByLabelText('פעיל'))
    expect(await screen.findByRole('alert')).toHaveTextContent(WRITE_MESSAGES.forbidden)
    expect(rowOf('הושלמו').getByLabelText('פעיל')).toBeChecked()
  })
})

describe('the order', () => {
  it('moves a status one place down, and the order is written for all of them', async () => {
    const { user, backend } = await open()
    await list()
    const reorder = vi.spyOn(backend.backend.admin.statuses, 'reorder')
    await user.click(rowOf('בטיפול').getByRole('button', { name: 'הזזה למטה: בטיפול' }))
    await waitFor(() => expect(names()).toEqual(['הושלמו', 'בטיפול', 'Send to CARGO', 'הזמנת חו"ל']))
    expect(reorder).toHaveBeenCalledExactlyOnceWith(['completed', 'processing', 'cargo', 'abroad'])
    expect(backend.directory.statuses.map((s) => [s.key, s.sort])).toEqual([
      ['processing', 2],
      ['completed', 1],
      ['cargo', 3],
      ['abroad', 4],
    ])
  })

  it('moves a status one place up', async () => {
    const { user, backend } = await open()
    await list()
    const reorder = vi.spyOn(backend.backend.admin.statuses, 'reorder')
    await user.click(rowOf('Send to CARGO').getByRole('button', { name: 'הזזה למעלה: Send to CARGO' }))
    await waitFor(() => expect(names()).toEqual(['בטיפול', 'Send to CARGO', 'הושלמו', 'הזמנת חו"ל']))
    expect(reorder).toHaveBeenCalledExactlyOnceWith(['processing', 'cargo', 'completed', 'abroad'])
  })

  it('keeps the cursor on the button that was used, so that the person can go on', async () => {
    const { user } = await open()
    await list()
    await user.click(rowOf('בטיפול').getByRole('button', { name: 'הזזה למטה: בטיפול' }))
    await waitFor(() => expect(names()).toEqual(['הושלמו', 'בטיפול', 'Send to CARGO', 'הזמנת חו"ל']))
    expect(rowOf('בטיפול').getByRole('button', { name: 'הזזה למטה: בטיפול' })).toHaveFocus()
  })

  it('puts the cursor on the other button when the status has reached the end of the list', async () => {
    const { user } = await open()
    await list()
    await user.click(rowOf('Send to CARGO').getByRole('button', { name: 'הזזה למטה: Send to CARGO' }))
    await waitFor(() => expect(names()).toEqual(['בטיפול', 'הושלמו', 'הזמנת חו"ל', 'Send to CARGO']))
    expect(rowOf('Send to CARGO').getByRole('button', { name: 'הזזה למעלה: Send to CARGO' })).toHaveFocus()
  })

  it('moves the status that was blocked, too: it keeps its place in the order', async () => {
    const { user } = await openAdmin({
      path: '/admin/statuses',
      backend: (fake) => {
        fake.directory.statuses = fake.directory.statuses.map((s) => (s.key === 'completed' ? { ...s, is_active: false } : s))
      },
    })
    await list()
    await user.click(rowOf('הושלמו').getByRole('button', { name: 'הזזה למטה: הושלמו' }))
    await waitFor(() => expect(names()).toEqual(['בטיפול', 'Send to CARGO', 'הושלמו', 'הזמנת חו"ל']))
    expect(rows()[2]).toHaveClass('status-off')
  })

  it('puts the cursor back on the button that was used when the order could not be written', async () => {
    const { user, backend } = await open()
    await list()
    let fail: (reason: unknown) => void = () => undefined
    vi.spyOn(backend.backend.admin.statuses, 'reorder').mockReturnValue(new Promise<void>((_resolve, reject) => (fail = reject)))
    const button = () => rowOf('בטיפול').getByRole('button', { name: 'הזזה למטה: בטיפול' })
    await user.click(button())
    // A browser takes the cursor away from a button that is disabled while the request is on its way.
    act(() => rowOf('הושלמו').getByLabelText('שם הסטטוס').focus())
    expect(button()).not.toHaveFocus()
    fail({ status: 403, code: '42501' })
    await screen.findByRole('alert')
    await waitFor(() => expect(button()).toHaveFocus())
  })

  it('does not take the cursor to a row that the person has left when the list changes later', async () => {
    const { user, backend } = await open()
    await list()
    // The write works, but the order that comes back is the same: the row is not where the cursor was promised to it.
    vi.spyOn(backend.backend.admin.statuses, 'reorder').mockResolvedValue(undefined)
    await user.click(rowOf('בטיפול').getByRole('button', { name: 'הזזה למטה: בטיפול' }))
    await waitFor(() => expect(rowOf('בטיפול').getByRole('button', { name: 'הזזה למטה: בטיפול' })).toBeEnabled())
    // The person does something else, which sends a request of its own…
    const field = rowOf('Send to CARGO').getByLabelText('שם הסטטוס')
    await user.click(field)
    await user.type(field, ' 2{Enter}')
    await waitFor(() => expect(names()).toContain('Send to CARGO 2'))
    // …and then the order is the one that the old promise was about.
    act(() => {
      backend.directory.statuses = backend.directory.statuses.map((s) => (s.key === 'processing' ? { ...s, sort: 2 } : s.key === 'completed' ? { ...s, sort: 1 } : s))
      backend.directory.changed()
    })
    await waitFor(() => expect(names().slice(0, 2)).toEqual(['הושלמו', 'בטיפול']))
    expect(rowOf('בטיפול').getByRole('button', { name: 'הזזה למטה: בטיפול' })).not.toHaveFocus()
  })

  it('sends one request for a double click, and the buttons wait for the answer', async () => {
    const { user, backend } = await open()
    await list()
    let finish: () => void = () => undefined
    const reorder = vi.spyOn(backend.backend.admin.statuses, 'reorder').mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
    await user.dblClick(rowOf('בטיפול').getByRole('button', { name: 'הזזה למטה: בטיפול' }))
    expect(rowOf('הושלמו').getByRole('button', { name: 'הזזה למעלה: הושלמו' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'סטטוס חדש' })).toBeDisabled()
    finish()
    await waitFor(() => expect(screen.getByRole('button', { name: 'סטטוס חדש' })).toBeEnabled())
    expect(reorder).toHaveBeenCalledTimes(1)
  })

  it('shows the order that the server has, and says why, when it could not be written', async () => {
    const { user, backend } = await open()
    await list()
    vi.spyOn(backend.backend.admin.statuses, 'reorder').mockRejectedValue({ status: 500 })
    await user.click(rowOf('בטיפול').getByRole('button', { name: 'הזזה למטה: בטיפול' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(WRITE_MESSAGES.network)
    expect(names()).toEqual(ORDER)
  })
})

describe('a new status', () => {
  it('is added at the end, active, with a name that can be changed at once', async () => {
    const { user, backend } = await open()
    await list()
    const add = vi.spyOn(backend.backend.admin.statuses, 'add')
    await user.click(screen.getByRole('button', { name: 'סטטוס חדש' }))
    await waitFor(() => expect(names()).toEqual([...ORDER, 'סטטוס חדש']))
    expect(add).toHaveBeenCalledExactlyOnceWith({ name_he: 'סטטוס חדש', color: '#6b7280' })
    const added = rowOf('סטטוס חדש')
    expect(added.getByLabelText('פעיל')).toBeChecked()
    expect(added.getByLabelText('צבע')).toHaveValue('#6b7280')
    // The name is selected, so that typing replaces it.
    const input = added.getByLabelText('שם הסטטוס') as HTMLInputElement
    expect(input).toHaveFocus()
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('סטטוס חדש'.length)
  })

  it('takes a name that no other status has: the second one is the second', async () => {
    const { user } = await open()
    await list()
    await user.click(screen.getByRole('button', { name: 'סטטוס חדש' }))
    await waitFor(() => expect(names()).toContain('סטטוס חדש'))
    await user.click(screen.getByRole('button', { name: 'סטטוס חדש' }))
    await waitFor(() => expect(names()).toContain('סטטוס חדש 2'))
    await user.click(screen.getByRole('button', { name: 'סטטוס חדש' }))
    await waitFor(() => expect(names()).toContain('סטטוס חדש 3'))
  })

  it('can be named at once: the first thing that is typed replaces the name', async () => {
    const { user, backend } = await open()
    await list()
    await user.click(screen.getByRole('button', { name: 'סטטוס חדש' }))
    await waitFor(() => expect(names()).toContain('סטטוס חדש'))
    await user.keyboard('ממתין ללקוח{Enter}')
    await waitFor(() => expect(names()).toContain('ממתין ללקוח'))
    expect(backend.directory.statuses.at(-1)).toMatchObject({ name_he: 'ממתין ללקוח', is_active: true })
  })

  it('has a key of its own that the person did not choose, and a place after the last', async () => {
    const { user, backend } = await open()
    await list()
    await user.click(screen.getByRole('button', { name: 'סטטוס חדש' }))
    await waitFor(() => expect(names()).toContain('סטטוס חדש'))
    const added = backend.directory.statuses.at(-1)
    expect(added?.key).toMatch(/^custom-[a-z0-9]{6}$/)
    expect(added?.sort).toBe(18)
  })

  it('shows that it is working, and sends one request for a double click', async () => {
    const { user, backend } = await open()
    await list()
    let finish: (status: Status) => void = () => undefined
    const add = vi.spyOn(backend.backend.admin.statuses, 'add').mockReturnValue(new Promise<Status>((resolve) => (finish = resolve)))
    await user.dblClick(screen.getByRole('button', { name: 'סטטוס חדש' }))
    expect(screen.getByRole('button', { name: 'סטטוס חדש' })).toBeDisabled()
    finish({ key: 'custom-abcdef', name_he: 'סטטוס חדש', color: '#6b7280', sort: 18, is_active: true })
    await waitFor(() => expect(screen.getByRole('button', { name: 'סטטוס חדש' })).toBeEnabled())
    expect(add).toHaveBeenCalledTimes(1)
  })

  it('says why, and adds nothing, when it could not be added', async () => {
    const { user, backend } = await open()
    await list()
    vi.spyOn(backend.backend.admin.statuses, 'add').mockRejectedValue({ status: 403, code: '42501' })
    await user.click(screen.getByRole('button', { name: 'סטטוס חדש' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(WRITE_MESSAGES.forbidden)
    expect(names()).toEqual(ORDER)
    expect(screen.getByRole('button', { name: 'סטטוס חדש' })).toBeEnabled()
  })
})

describe('whatever goes wrong', () => {
  it.each([
    ['the server cannot be reached', new TypeError('Failed to fetch'), WRITE_MESSAGES.network],
    ['the session is over', { status: 401, code: 'PGRST301' }, WRITE_MESSAGES.session],
    ['the person has no right to', { status: 403, code: '42501' }, WRITE_MESSAGES.forbidden],
    ['the status is not there any more', { status: 406, code: 'PGRST116' }, WRITE_MESSAGES.gone],
    ['the database does not take the value', { status: 400, code: '23514' }, WRITE_MESSAGES.invalid],
    ['something nobody foresaw', new Error('boom 10.0.0.5'), WRITE_MESSAGES.failed],
  ])('says it in words, and keeps the list as it was, when %s', async (_what, error, message) => {
    const { user, backend } = await open()
    await list()
    vi.spyOn(backend.backend.admin.statuses, 'update').mockRejectedValue(error)
    await user.click(rowOf('הושלמו').getByLabelText('פעיל'))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(message)
    expect(alert.textContent).not.toContain('10.0.0.5')
    expect(names()).toEqual(ORDER)
    expect(rowOf('הושלמו').getByLabelText('פעיל')).toBeChecked()
  })

  it('shows what is on the server after a failure that says that the screen was out of date', async () => {
    const { user, backend } = await open()
    await list()
    // Another administrator changed the status, and this screen has not heard of it.
    backend.directory.memory.statuses = backend.directory.memory.statuses.filter((s) => s.key !== 'completed')
    await user.click(rowOf('הושלמו').getByLabelText('פעיל'))
    expect(await screen.findByRole('alert')).toHaveTextContent(WRITE_MESSAGES.gone)
    await waitFor(() => expect(names()).toEqual(['בטיפול', 'Send to CARGO', 'הזמנת חו"ל']))
  })

  it('takes the message away when the next thing is done', async () => {
    const { user, backend } = await open()
    await list()
    const update = vi.spyOn(backend.backend.admin.statuses, 'update').mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await user.click(rowOf('הושלמו').getByLabelText('פעיל'))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    update.mockRestore()
    await user.click(rowOf('הושלמו').getByLabelText('פעיל'))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(rowOf('הושלמו').getByLabelText('פעיל')).not.toBeChecked()
  })

  it('asks for the list again after a write, and does not wait for the live connection to say that something changed', async () => {
    const { user, backend } = await open()
    await list()
    // The write works but nobody is told: only the screen itself can know that the list is out of date.
    vi.spyOn(backend.backend.admin.statuses, 'update').mockResolvedValue({ key: 'completed', name_he: 'הושלמו', color: '#7c9cc0', sort: 3, is_active: false })
    const loads = backend.directory.loads
    await user.click(rowOf('הושלמו').getByLabelText('פעיל'))
    await waitFor(() => expect(backend.directory.loads).toBeGreaterThan(loads))
  })

  it('does not ask for the list again when the server could not be reached, and does after every other answer', async () => {
    const { user, backend } = await open()
    await list()
    const update = vi.spyOn(backend.backend.admin.statuses, 'update').mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const loads = backend.directory.loads
    await user.click(rowOf('הושלמו').getByLabelText('פעיל'))
    await screen.findByRole('alert')
    expect(backend.directory.loads).toBe(loads)

    update.mockRejectedValueOnce({ status: 403, code: '42501' })
    await user.click(rowOf('הושלמו').getByLabelText('פעיל'))
    await waitFor(() => expect(backend.directory.loads).toBe(loads + 1))
  })

  it('ends with the last write when two administrators change the same status, and shows what is on the server', async () => {
    const { user, backend } = await open()
    await list()
    // The other administrator renames the status; this screen has not heard of it yet, and saves another name.
    backend.directory.memory.statuses = backend.directory.memory.statuses.map((s) => (s.key === 'processing' ? { ...s, name_he: 'השם של האחר' } : s))
    const input = rowOf('בטיפול').getByLabelText('שם הסטטוס')
    await user.clear(input)
    await user.type(input, 'השם שלי{Enter}')
    await waitFor(() => expect(names()).toContain('השם שלי'))
    expect(backend.directory.statuses.find((s) => s.key === 'processing')?.name_he).toBe('השם שלי')
    expect(names()).not.toContain('השם של האחר')
  })

  it('is told by an administrator who is not one any more that the action is not allowed, and changes nothing', async () => {
    const { user, backend } = await open()
    await list()
    backend.actAs(DANA.id)
    await user.click(rowOf('הושלמו').getByLabelText('פעיל'))
    expect(await screen.findByRole('alert')).toHaveTextContent(WRITE_MESSAGES.forbidden)
    expect(backend.directory.statuses.find((s) => s.key === 'completed')?.is_active).toBe(true)
    backend.actAs(OWNER.id)
  })
})
