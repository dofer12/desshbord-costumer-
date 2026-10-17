import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType } from 'react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { Profile } from '../auth/types'
import { stubClipboard } from '../../test/clipboard'
import { statusTextColor, TEXT_ON_LIGHT } from './display'
import type { Status } from './gateways'
import { newTask, type Task } from './model'
import { TaskCards } from './TaskCards'
import { TaskTable } from './TaskTable'
import type { TaskListProps } from './taskParts'

// Thursday 15 October 2026, 15:00 in Jerusalem.
const NOW = new Date('2026-10-15T12:00:00.000Z')

const status = (key: string, name_he: string, color: string): [string, Status] => [key, { key, name_he, color, sort: 1, is_active: true }]
const statuses = new Map([status('processing', 'בטיפול', '#22a559'), status('cargo', 'Send to CARGO', '#1e88c9'), status('dark', 'כהה', '#3a4250')])
const person = (id: string, display_name: string): [string, Profile] => [
  id,
  { id, email: `${id}@example.com`, display_name, role: 'employee', is_active: true, must_change_password: false, default_remind_min: 15 },
]
const people = new Map([person('u-dana', 'דנה')])

function task(id: string, patch: Partial<Task> = {}): Task {
  return { ...newTask('u-dana', id), no_glassix: true, title: `משימה ${id}`, status_key: 'processing', ...patch }
}

const full = task('full', {
  title: 'לתאם משלוח ללקוח',
  kind: 'delivery',
  priority: 'urgent',
  status_key: 'cargo',
  assignee_id: 'u-dana',
  due_at: '2026-10-15T07:00:00.000Z', // 10:00 today, five hours ago
  customer_name: 'רונית כהן',
  customer_phone: '050-123-4567',
  order_number: '10442',
  glassix_conversation_id: 'gx-77',
  cargo_number: 'CG-9',
})

function renderList(List: ComponentType<TaskListProps>, tasks: Task[], onToggleDone = vi.fn()) {
  render(
    <MemoryRouter>
      <List tasks={tasks} statuses={statuses} people={people} now={NOW} onToggleDone={onToggleDone} />
    </MemoryRouter>,
  )
  return { onToggleDone, user: userEvent.setup() }
}

const variants = [
  ['the table', TaskTable, 'tr'],
  ['the cards', TaskCards, 'li'],
] as const

describe.each(variants)('%s', (_name, List, rowTag) => {
  const rowOf = (title: string) => {
    const row = screen.getByRole('checkbox', { name: `בוצע: ${title}` }).closest(rowTag)
    if (!row) throw new Error(`no ${rowTag} for ${title}`)
    return within(row as HTMLElement)
  }

  const elementOf = (title: string) => {
    const row = screen.getByRole('checkbox', { name: `בוצע: ${title}` }).closest(rowTag)
    if (!row) throw new Error(`no ${rowTag} for ${title}`)
    return row
  }

  it('shows the title as a link to the task', () => {
    renderList(List, [full])
    expect(rowOf('לתאם משלוח ללקוח').getByRole('link', { name: 'לתאם משלוח ללקוח' })).toHaveAttribute('href', '/tasks/full')
  })

  it('makes a title for a task that has none, from its order number', () => {
    renderList(List, [task('x', { title: '', order_number: '#555' })])
    expect(rowOf('טיפול בהזמנה #555').getByRole('link', { name: 'טיפול בהזמנה #555' })).toBeInTheDocument()
  })

  it('shows the status with its colour and a text that can be read on it', () => {
    renderList(List, [full, task('dark', { status_key: 'dark' }), task('light', { status_key: 'processing' })])
    const badge = rowOf('לתאם משלוח ללקוח').getByText('Send to CARGO')
    expect(badge).toHaveStyle({ background: '#1e88c9', color: TEXT_ON_LIGHT })
    expect(rowOf('משימה dark').getByText('כהה')).toHaveStyle({ background: '#3a4250', color: '#ffffff' })
  })

  it('names a status that the directory does not have by its key, in a quiet colour', () => {
    renderList(List, [task('x', { status_key: 'gone' })])
    const badge = rowOf('משימה x').getByText('gone')
    expect(badge).toHaveStyle({ background: '#8a9aa1' })
    expect(badge).toHaveStyle({ color: statusTextColor('#8a9aa1') })
  })

  it('shows who the task is for, and says so when nobody is, or when the person is not known', () => {
    renderList(List, [full, task('nobody', { assignee_id: null }), task('stranger', { assignee_id: 'u-who' })])
    expect(rowOf('לתאם משלוח ללקוח').getByText('דנה')).toBeInTheDocument()
    expect(rowOf('משימה nobody').getByText('ללא שיוך')).toBeInTheDocument()
    expect(rowOf('משימה stranger').getByText('לא ידוע')).toBeInTheDocument()
  })

  it('shows when it is due, and says that it is late when the time has passed', () => {
    renderList(List, [full, task('later', { due_at: '2026-10-16T06:00:00.000Z' }), task('open')])
    const late = rowOf('לתאם משלוח ללקוח')
    expect(late.getByText('היום · 10:00')).toHaveAttribute('datetime', '2026-10-15T07:00:00.000Z')
    expect(late.getByText('באיחור')).toBeInTheDocument()
    expect(rowOf('משימה later').getByText('מחר · 09:00')).toBeInTheDocument()
    expect(rowOf('משימה later').queryByText('באיחור')).not.toBeInTheDocument()
    expect(rowOf('משימה open').getByText('ללא מועד')).toBeInTheDocument()
  })

  it('does not call a done task late, and strikes its title', () => {
    renderList(List, [task('done', { due_at: '2026-10-01T06:00:00.000Z', done_at: '2026-10-02T06:00:00.000Z' })])
    const row = rowOf('משימה done')
    expect(row.queryByText('באיחור')).not.toBeInTheDocument()
    expect(row.getByRole('checkbox')).toBeChecked()
    expect(row.getByRole('link', { name: 'משימה done' })).toHaveClass('is-done')
    expect(elementOf('משימה done')).toHaveClass('is-done')
  })

  it('does not mark an open task as done', () => {
    renderList(List, [task('open')])
    expect(elementOf('משימה open')).not.toHaveClass('is-done')
    expect(within(elementOf('משימה open') as HTMLElement).getByRole('link', { name: 'משימה open' })).not.toHaveClass('is-done')
  })

  it('marks an urgent task, names the kind of a delivery or a pickup, and says nothing about the usual', () => {
    renderList(List, [full, task('pick', { kind: 'pickup', priority: 'high' }), task('plain')])
    expect(rowOf('לתאם משלוח ללקוח').getByText('דחוף מאוד')).toBeInTheDocument()
    expect(rowOf('לתאם משלוח ללקוח').getByText('משלוח')).toBeInTheDocument()
    expect(rowOf('משימה pick').getByText('דחוף')).toBeInTheDocument()
    expect(rowOf('משימה pick').getByText('איסוף')).toBeInTheDocument()
    const plain = rowOf('משימה plain')
    for (const text of ['דחוף', 'דחוף מאוד', 'משלוח', 'איסוף', 'כללית', 'רגילה']) expect(plain.queryByText(text)).not.toBeInTheDocument()
  })

  it('has a checkbox that asks for the task to be done, or not done', async () => {
    const { onToggleDone, user } = renderList(List, [task('open'), task('done', { done_at: '2026-10-02T06:00:00.000Z' })])
    await user.click(rowOf('משימה open').getByRole('checkbox'))
    expect(onToggleDone).toHaveBeenLastCalledWith('open', true)
    await user.click(rowOf('משימה done').getByRole('checkbox'))
    expect(onToggleDone).toHaveBeenLastCalledWith('done', false)
  })

  it('shows the customer, and copies the phone, the order, the Glassix id and the Cargo number when they are clicked', async () => {
    const { user } = renderList(List, [full])
    const writeText = stubClipboard()
    const row = rowOf('לתאם משלוח ללקוח')
    expect(row.getByText('רונית כהן')).toBeInTheDocument()

    await user.click(row.getByRole('button', { name: 'העתקת טלפון: 050-123-4567' }))
    await user.click(row.getByRole('button', { name: 'העתקת מספר הזמנה: 10442' }))
    await user.click(row.getByRole('button', { name: 'העתקת מזהה Glassix: gx-77' }))
    await user.click(row.getByRole('button', { name: 'העתקת מספר Cargo: CG-9' }))
    expect(writeText.mock.calls.map((call) => call[0])).toEqual(['050-123-4567', '10442', 'gx-77', 'CG-9'])
  })

  it('copies the phone, the order and the others without the spaces around them', async () => {
    const { user } = renderList(List, [task('x', { customer_phone: '  050-123-4567 ', order_number: ' 10442 ', cargo_number: ' CG-9' })])
    const writeText = stubClipboard()
    const row = rowOf('משימה x')
    await user.click(row.getByRole('button', { name: 'העתקת טלפון: 050-123-4567' }))
    await user.click(row.getByRole('button', { name: 'העתקת מספר הזמנה: 10442' }))
    await user.click(row.getByRole('button', { name: 'העתקת מספר Cargo: CG-9' }))
    expect(writeText.mock.calls.map((call) => call[0])).toEqual(['050-123-4567', '10442', 'CG-9'])
    expect(row.getByRole('link', { name: 'חיוג אל 050-123-4567' })).toHaveAttribute('href', 'tel:0501234567')
  })

  it('has a link that dials the phone', () => {
    renderList(List, [full])
    expect(rowOf('לתאם משלוח ללקוח').getByRole('link', { name: 'חיוג אל 050-123-4567' })).toHaveAttribute('href', 'tel:0501234567')
  })

  it('has nothing to copy or dial for what is empty', () => {
    renderList(List, [task('bare')])
    const row = rowOf('משימה bare')
    expect(row.queryAllByRole('button')).toHaveLength(0)
    expect(row.queryByRole('link', { name: /חיוג/ })).not.toBeInTheDocument()
  })

  it('shows every task that it is given, in the order given', () => {
    renderList(List, [task('b'), task('a'), task('c')])
    expect(screen.getAllByRole('checkbox').map((box) => box.getAttribute('aria-label'))).toEqual(['בוצע: משימה b', 'בוצע: משימה a', 'בוצע: משימה c'])
  })
})

describe('the table', () => {
  it('has a name, and a header for each column', () => {
    renderList(TaskTable, [full])
    const table = screen.getByRole('table', { name: 'רשימת משימות' })
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'בוצע',
      'משימה',
      'לקוח',
      'הזמנה',
      'Glassix',
      'Cargo',
      'סטטוס',
      'שיוך',
      'מועד',
    ])
  })

  it('has a row for each task, besides the header', () => {
    renderList(TaskTable, [task('a'), task('b')])
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })
})

describe('the cards', () => {
  it('are a list with a name', () => {
    renderList(TaskCards, [task('a'), task('b')])
    const list = screen.getByRole('list', { name: 'רשימת משימות' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  })
})
