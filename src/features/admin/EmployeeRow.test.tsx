import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { AVI, MICHAL, NOAM, YAEL } from '../../test/adminHarness'
import type { Profile } from '../auth/types'
import { EmployeeRow } from './EmployeeRow'

// One row on its own, with every combination of what the page can tell it. The page tries the rows in
// the list (EmployeesPage.test.tsx, EmployeeActions.test.tsx); here are the cases that a list of people
// cannot be made to show, such as an only administrator who is not the one who is looking.

function setup(person: Profile, props: Partial<Parameters<typeof EmployeeRow>[0]> = {}) {
  const calls = {
    onEdit: vi.fn(),
    onStopEditing: vi.fn(),
    onRename: vi.fn().mockResolvedValue(true),
    onSetRole: vi.fn(),
    onAskReset: vi.fn(),
    onAskBlock: vi.fn(),
    onUnblock: vi.fn(),
  }
  render(
    <MemoryRouter>
      <ul>
        <EmployeeRow person={person} isMe={false} onlyActiveAdmin={false} busy={false} editing={false} {...calls} {...props} />
      </ul>
    </MemoryRouter>,
  )
  return { ...calls, user: userEvent.setup() }
}

describe('the one active administrator', () => {
  it('cannot be blocked or made an employee, whoever is looking, and the reason is beside the buttons', () => {
    setup(YAEL, { onlyActiveAdmin: true })
    const block = screen.getByRole('button', { name: 'חסימה: יעל גולן' })
    const demote = screen.getByRole('button', { name: 'הפיכה לעובד: יעל גולן' })
    expect(block).toBeDisabled()
    expect(demote).toBeDisabled()
    expect(block).toHaveAccessibleDescription(/המנהל הפעיל היחיד/)
    expect(demote).toHaveAccessibleDescription(/המנהל הפעיל היחיד/)
  })

  it('does not have the reason written when there is another one', () => {
    setup(YAEL)
    expect(screen.getByRole('button', { name: 'חסימה: יעל גולן' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'הפיכה לעובד: יעל גולן' })).toBeEnabled()
    expect(screen.queryByText(/המנהל הפעיל היחיד/)).not.toBeInTheDocument()
  })
})

describe('what the buttons do', () => {
  it('asks the page for each thing, once', async () => {
    const { user, onEdit, onSetRole, onAskReset, onAskBlock } = setup(AVI)
    await user.click(screen.getByRole('button', { name: 'שינוי שם: אבי לוי' }))
    await user.click(screen.getByRole('button', { name: 'הפיכה למנהל: אבי לוי' }))
    await user.click(screen.getByRole('button', { name: 'איפוס סיסמה: אבי לוי' }))
    await user.click(screen.getByRole('button', { name: 'חסימה: אבי לוי' }))
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onSetRole).toHaveBeenCalledExactlyOnceWith('admin')
    expect(onAskReset).toHaveBeenCalledTimes(1)
    expect(onAskBlock).toHaveBeenCalledTimes(1)
  })

  it('asks for the other role of a manager, and to unblock a person who is blocked', async () => {
    const { user, onSetRole, onUnblock } = setup(YAEL)
    await user.click(screen.getByRole('button', { name: 'הפיכה לעובד: יעל גולן' }))
    expect(onSetRole).toHaveBeenCalledExactlyOnceWith('employee')
    expect(onUnblock).not.toHaveBeenCalled()
  })

  it('offers to unblock a person who is blocked, and not to block them', async () => {
    const { user, onUnblock, onAskBlock } = setup(MICHAL)
    expect(screen.queryByRole('button', { name: 'חסימה: מיכל ברק' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'שחרור: מיכל ברק' }))
    expect(onUnblock).toHaveBeenCalledTimes(1)
    expect(onAskBlock).not.toHaveBeenCalled()
  })

  it('has every button waiting while a request is on its way', () => {
    setup(AVI, { busy: true })
    for (const name of ['שינוי שם: אבי לוי', 'הפיכה למנהל: אבי לוי', 'איפוס סיסמה: אבי לוי', 'חסימה: אבי לוי']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
  })

  it('has the button of unblocking waiting too', () => {
    setup(MICHAL, { busy: true })
    expect(screen.getByRole('button', { name: 'שחרור: מיכל ברק' })).toBeDisabled()
  })
})

describe('the person who is looking', () => {
  it('has no button to reset or block, and a note about where the password is changed', () => {
    setup(YAEL, { isMe: true })
    expect(screen.queryByRole('button', { name: /איפוס סיסמה|חסימה|שחרור/ })).not.toBeInTheDocument()
    expect(screen.getByText('אתם')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'בפרופיל' })).toHaveAttribute('href', '/profile')
  })

  it('may still be renamed, and made an employee when there is another manager', () => {
    setup(YAEL, { isMe: true })
    expect(screen.getByRole('button', { name: 'שינוי שם: יעל גולן' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'הפיכה לעובד: יעל גולן' })).toBeEnabled()
  })

  it('is not marked on the row of somebody else', () => {
    setup(AVI)
    expect(screen.queryByText('אתם')).not.toBeInTheDocument()
    expect(screen.queryByText(/לשינוי הסיסמה שלך/)).not.toBeInTheDocument()
  })
})

describe('what the row says of a person', () => {
  it('says that a person who is blocked is, and a person who is not is not, in a row that looks it', () => {
    const { container } = render(
      <MemoryRouter>
        <ul>
          <EmployeeRow person={MICHAL} isMe={false} onlyActiveAdmin={false} busy={false} editing={false} onEdit={vi.fn()} onStopEditing={vi.fn()} onRename={vi.fn()} onSetRole={vi.fn()} onAskReset={vi.fn()} onAskBlock={vi.fn()} onUnblock={vi.fn()} />
          <EmployeeRow person={AVI} isMe={false} onlyActiveAdmin={false} busy={false} editing={false} onEdit={vi.fn()} onStopEditing={vi.fn()} onRename={vi.fn()} onSetRole={vi.fn()} onAskReset={vi.fn()} onAskBlock={vi.fn()} onUnblock={vi.fn()} />
        </ul>
      </MemoryRouter>,
    )
    const [blocked, active] = Array.from(container.querySelectorAll('li'))
    expect(blocked).toHaveClass('person-off')
    expect(active).not.toHaveClass('person-off')
  })

  it('says that a person who has to choose a password is waiting for it', () => {
    setup(NOAM)
    expect(screen.getByText('ממתין להחלפת סיסמה')).toBeInTheDocument()
  })
})

describe('the edit of the name', () => {
  it('is not there until the page says so, and then asks for what it needs', () => {
    setup(AVI)
    expect(screen.queryByLabelText('שם חדש')).not.toBeInTheDocument()
  })

  it('is saved with the name trimmed, and the page is asked to stop the edit only when it worked', async () => {
    const { user, onRename, onStopEditing } = setup(AVI, { editing: true })
    await user.clear(screen.getByLabelText('שם חדש'))
    await user.type(screen.getByLabelText('שם חדש'), '  אבי כהן ')
    await user.click(screen.getByRole('button', { name: 'שמירה' }))
    expect(onRename).toHaveBeenCalledExactlyOnceWith('אבי כהן')
    expect(onStopEditing).toHaveBeenCalledTimes(1)
  })

  it('goes on when the page says that it did not work', async () => {
    const onRename = vi.fn().mockResolvedValue(false)
    const { user, onStopEditing } = setup(AVI, { editing: true, onRename })
    await user.type(screen.getByLabelText('שם חדש'), 'x')
    await user.click(screen.getByRole('button', { name: 'שמירה' }))
    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onStopEditing).not.toHaveBeenCalled()
    expect(screen.getByLabelText('שם חדש')).toHaveValue('אבי לויx')
  })

  it('waits while a request is on its way: neither button works, nor Escape', async () => {
    const { user, onStopEditing, onRename } = setup(AVI, { editing: true, busy: true })
    expect(screen.getByRole('button', { name: 'שמירה' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'ביטול' })).toBeDisabled()
    await user.keyboard('{Escape}')
    await user.type(screen.getByLabelText('שם חדש'), '{Enter}')
    expect(onStopEditing).not.toHaveBeenCalled()
    expect(onRename).not.toHaveBeenCalled()
  })
})
