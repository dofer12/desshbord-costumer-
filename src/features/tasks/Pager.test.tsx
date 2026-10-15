import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Pager } from './Pager'

function setup(page: number, pageCount: number) {
  const onPage = vi.fn()
  render(<Pager page={page} pageCount={pageCount} onPage={onPage} />)
  return { onPage, user: userEvent.setup() }
}

describe('Pager', () => {
  it('is not there for one page', () => {
    setup(1, 1)
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('is a navigation with a name, and says which page of how many', () => {
    setup(2, 3)
    expect(screen.getByRole('navigation', { name: 'דפדוף בין עמודים' })).toBeInTheDocument()
    expect(screen.getByText('עמוד 2 מתוך 3')).toBeInTheDocument()
  })

  it('goes to the page before and the page after', async () => {
    const { onPage, user } = setup(2, 3)
    await user.click(screen.getByRole('button', { name: 'העמוד הקודם' }))
    expect(onPage).toHaveBeenLastCalledWith(1)
    await user.click(screen.getByRole('button', { name: 'העמוד הבא' }))
    expect(onPage).toHaveBeenLastCalledWith(3)
  })

  it('cannot go before the first page or after the last', () => {
    setup(1, 3)
    expect(screen.getByRole('button', { name: 'העמוד הקודם' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'העמוד הבא' })).toBeEnabled()
  })

  it('cannot go after the last page', () => {
    setup(3, 3)
    expect(screen.getByRole('button', { name: 'העמוד הבא' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'העמוד הקודם' })).toBeEnabled()
  })
})
