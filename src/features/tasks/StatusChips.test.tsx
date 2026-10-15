import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Status } from './gateways'
import { StatusChips } from './StatusChips'

const statuses: Status[] = [
  { key: 'processing', name_he: 'בטיפול', color: '#22a559', sort: 1, is_active: true },
  { key: 'completed', name_he: 'הושלמו', color: '#7c9cc0', sort: 3, is_active: true },
  { key: 'cargo', name_he: 'Send to CARGO', color: '#1e88c9', sort: 8, is_active: true },
]

function setup(props: Partial<Parameters<typeof StatusChips>[0]> = {}) {
  const onSelect = vi.fn()
  render(
    <StatusChips
      statuses={statuses}
      counts={{ processing: 5, cargo: 2 }}
      total={7}
      selected={null}
      onSelect={onSelect}
      {...props}
    />,
  )
  return { onSelect, user: userEvent.setup() }
}

const names = () => within(screen.getByRole('group', { name: 'סינון לפי סטטוס' })).getAllByRole('button').map((b) => b.textContent)

describe('StatusChips', () => {
  it('is a group with a name, with "all" first and then the statuses that have tasks, in the order of the statuses', () => {
    setup()
    expect(names()).toEqual(['הכול7', 'בטיפול5', 'Send to CARGO2'])
  })

  it('says in the name of each chip how many tasks it holds', () => {
    setup()
    expect(screen.getByRole('button', { name: 'הכול, 7 משימות' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'בטיפול, 5 משימות' })).toBeInTheDocument()
  })

  it('says "one task" for one', () => {
    setup({ counts: { processing: 1 }, total: 1 })
    expect(screen.getByRole('button', { name: 'בטיפול, משימה אחת' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'הכול, משימה אחת' })).toBeInTheDocument()
  })

  it('marks the chip that is selected, and "all" when none is', () => {
    setup()
    expect(screen.getByRole('button', { name: /^הכול/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^בטיפול/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps the selected chip, though no task has that status any more', () => {
    setup({ selected: 'completed', counts: { processing: 5 }, total: 5 })
    expect(names()).toEqual(['הכול5', 'בטיפול5', 'הושלמו0'])
    expect(screen.getByRole('button', { name: /^הושלמו/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^הכול/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('names a status that the directory does not know by its key, after the others', () => {
    setup({ counts: { processing: 5, mystery: 3 }, total: 8 })
    expect(names()).toEqual(['הכול8', 'בטיפול5', 'mystery3'])
  })

  it('puts the statuses that the directory does not know in the order of their keys', () => {
    setup({ counts: { zeta: 1, alpha: 2, mid: 3 }, total: 6 })
    expect(names()).toEqual(['הכול6', 'alpha2', 'mid3', 'zeta1'])
  })

  it('keeps a chosen status that nobody knows and nothing has, so that the choice can be undone', () => {
    setup({ selected: 'ghost', counts: { processing: 5 }, total: 5 })
    expect(names()).toEqual(['הכול5', 'בטיפול5', 'ghost0'])
    expect(screen.getByRole('button', { name: /^ghost/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('selects a chip when it is pressed, and clears the selection when the selected one is pressed again', async () => {
    const { onSelect, user } = setup({ selected: 'cargo' })
    await user.click(screen.getByRole('button', { name: /^בטיפול/ }))
    expect(onSelect).toHaveBeenLastCalledWith('processing')
    await user.click(screen.getByRole('button', { name: /^Send to CARGO/ }))
    expect(onSelect).toHaveBeenLastCalledWith(null)
  })

  it('clears the selection with "all"', async () => {
    const { onSelect, user } = setup({ selected: 'cargo' })
    await user.click(screen.getByRole('button', { name: /^הכול/ }))
    expect(onSelect).toHaveBeenLastCalledWith(null)
  })

  it('shows the colour of the status on its chip', () => {
    setup()
    const dot = screen.getByRole('button', { name: /^בטיפול/ }).querySelector('.dot')
    expect(dot).toHaveStyle({ background: '#22a559' })
  })
})
