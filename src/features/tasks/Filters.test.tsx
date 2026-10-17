import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Profile } from '../auth/types'
import { Filters } from './Filters'
import type { SortChoice, TaskFilter } from './selectors'

const person = (id: string, display_name: string, is_active = true): Profile => ({
  id,
  email: `${id}@example.com`,
  display_name,
  role: 'employee',
  is_active,
  must_change_password: false,
  default_remind_min: 15,
})

const filter: TaskFilter = { statusKey: null, assignee: 'me', shipMethod: null, state: 'open', text: '' }

function setup(props: { filter?: Partial<TaskFilter>; sort?: SortChoice; disabled?: boolean } = {}) {
  const onChange = vi.fn()
  const onSort = vi.fn()
  render(
    <Filters
      filter={{ ...filter, ...props.filter }}
      onChange={onChange}
      sort={props.sort ?? 'due-asc'}
      onSort={onSort}
      people={[person('u-dana', 'דנה'), person('u-avi', 'אבי'), person('u-old', 'ישן', false)]}
      shipMethods={['איסוף עצמי', 'CARGO']}
      disabled={props.disabled}
    />,
  )
  return { onChange, onSort, user: userEvent.setup() }
}

const optionsOf = (name: string) => within(screen.getByRole('combobox', { name })).getAllByRole('option').map((o) => o.textContent)

describe('the assignee filter', () => {
  it('offers my tasks, everybody, nobody, and then each person, with a person who left marked', () => {
    setup()
    expect(optionsOf('שיוך')).toEqual(['המשימות שלי', 'כולם', 'ללא שיוך', 'דנה', 'אבי', 'ישן (לא פעיל)'])
  })

  it('shows the one that is chosen', () => {
    setup({ filter: { assignee: 'all' } })
    expect(screen.getByRole('combobox', { name: 'שיוך' })).toHaveValue('all')
  })

  it('reports a choice, and keeps the rest of the filter', async () => {
    const { onChange, user } = setup({ filter: { statusKey: 'cargo', text: 'דנה' } })
    await user.selectOptions(screen.getByRole('combobox', { name: 'שיוך' }), 'u-avi')
    expect(onChange).toHaveBeenLastCalledWith({ ...filter, statusKey: 'cargo', text: 'דנה', assignee: 'u-avi' })
    await user.selectOptions(screen.getByRole('combobox', { name: 'שיוך' }), 'none')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ assignee: 'none' }))
  })
})

describe('the shipping method filter', () => {
  it('offers every method, and "all methods" first', () => {
    setup()
    expect(optionsOf('שיטת משלוח')).toEqual(['כל השיטות', 'איסוף עצמי', 'CARGO'])
  })

  it('reports a method, and null for all of them', async () => {
    const { onChange, user } = setup({ filter: { shipMethod: 'CARGO' } })
    expect(screen.getByRole('combobox', { name: 'שיטת משלוח' })).toHaveValue('CARGO')
    await user.selectOptions(screen.getByRole('combobox', { name: 'שיטת משלוח' }), 'איסוף עצמי')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ shipMethod: 'איסוף עצמי' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'שיטת משלוח' }), '')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ shipMethod: null }))
  })

  it('keeps a method that the list does not have, because a task may carry it', () => {
    setup({ filter: { shipMethod: 'שליח ישן' } })
    expect(optionsOf('שיטת משלוח')).toEqual(['כל השיטות', 'איסוף עצמי', 'CARGO', 'שליח ישן'])
    expect(screen.getByRole('combobox', { name: 'שיטת משלוח' })).toHaveValue('שליח ישן')
  })
})

describe('the open, done and all buttons', () => {
  it('are a group with a name, and the one that is chosen is pressed', () => {
    setup({ filter: { state: 'done' } })
    const group = screen.getByRole('group', { name: 'מצב' })
    expect(within(group).getAllByRole('button').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
      ['פתוחות', 'false'],
      ['בוצעו', 'true'],
      ['הכול', 'false'],
    ])
  })

  it('report a choice', async () => {
    const { onChange, user } = setup()
    await user.click(screen.getByRole('button', { name: 'הכול' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...filter, state: 'all' })
    await user.click(screen.getByRole('button', { name: 'בוצעו' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...filter, state: 'done' })
  })
})

describe('the sort control', () => {
  it('offers the five orders, and shows the one that is chosen', () => {
    setup({ sort: 'updated-desc' })
    expect(optionsOf('מיון')).toEqual(['מועד: הקרוב קודם', 'מועד: הרחוק קודם', 'כותרת: א׳–ת׳', 'עודכנו לאחרונה', 'עודכנו מזמן'])
    expect(screen.getByRole('combobox', { name: 'מיון' })).toHaveValue('updated-desc')
  })

  it('reports a choice', async () => {
    const { onSort, user } = setup()
    await user.selectOptions(screen.getByRole('combobox', { name: 'מיון' }), 'title-asc')
    expect(onSort).toHaveBeenLastCalledWith('title-asc')
  })
})

describe('when it is disabled', () => {
  it('turns off the filters, and leaves the order, which still applies to what is shown', () => {
    setup({ disabled: true })
    for (const name of ['שיוך', 'שיטת משלוח']) expect(screen.getByRole('combobox', { name })).toBeDisabled()
    for (const button of within(screen.getByRole('group', { name: 'מצב' })).getAllByRole('button')) expect(button).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'מיון' })).toBeEnabled()
  })
})
