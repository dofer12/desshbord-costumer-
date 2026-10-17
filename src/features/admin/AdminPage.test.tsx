import { act, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { openAdmin } from '../../test/adminHarness'
import { DANA, OWNER } from '../../test/fakeGateway'

// The Admin tab, the pages under it, and who may go there. The screens are never the protection (the
// database and the function check every request again), but they must not invite anybody in.

const mainTabs = () => within(screen.getByRole('navigation', { name: 'ניווט ראשי' }))
const areas = () => within(screen.getByRole('navigation', { name: 'אזורי הניהול' }))

const PAGES = [
  ['עובדים', '/admin/employees'],
  ['סטטוסים', '/admin/statuses'],
  ['הגדרות', '/admin/settings'],
  ['ייבוא', '/admin/import'],
  ['גיבוי', '/admin/backup'],
  ['נמחקו לאחרונה', '/admin/deleted'],
] as const

describe('the Admin tab', () => {
  it('is there for an administrator, after the other tabs', async () => {
    await openAdmin({ path: '/today' })
    await screen.findByRole('heading', { level: 2, name: 'היום' })
    expect(mainTabs().getAllByRole('link').map((link) => link.textContent?.replace(/\d+\+?$/, ''))).toEqual(['היום', 'משימות', 'יומן', 'ניהול'])
  })

  it('is not there for an employee', async () => {
    await openAdmin({ path: '/today', as: DANA, people: [OWNER, DANA] })
    await screen.findByRole('heading', { level: 2, name: 'היום' })
    expect(mainTabs().queryByRole('link', { name: 'ניהול' })).not.toBeInTheDocument()
  })

  it('is marked while the person is in the area, whichever page of it', async () => {
    await openAdmin({ path: '/admin/backup' })
    await screen.findByRole('heading', { level: 3, name: 'גיבוי' })
    expect(mainTabs().getByRole('link', { name: 'ניהול' })).toHaveAttribute('aria-current', 'page')
    expect(mainTabs().getByRole('link', { name: 'היום' })).not.toHaveAttribute('aria-current')
  })

  it('takes the person to the area', async () => {
    const { user } = await openAdmin({ path: '/today' })
    await user.click(await screen.findByRole('link', { name: 'ניהול' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'ניהול' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 3, name: 'עובדים' })).toBeInTheDocument()
  })
})

describe('who may go to the area', () => {
  it.each(['/admin', '/admin/employees', '/admin/statuses', '/admin/settings', '/admin/import', '/admin/backup', '/admin/deleted', '/admin/nothing'])(
    'sends an employee who types %s to Today, and shows them none of it',
    async (path) => {
      await openAdmin({ path, as: DANA, people: [OWNER, DANA] })
      expect(await screen.findByRole('heading', { level: 2, name: 'היום' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'ניהול' })).not.toBeInTheDocument()
      expect(screen.queryByRole('navigation', { name: 'אזורי הניהול' })).not.toBeInTheDocument()
      expect(screen.queryByRole('list', { name: 'רשימת העובדים' })).not.toBeInTheDocument()
    },
  )

  it('sends a manager who is demoted while the app is open away from the area, and takes the tab away', async () => {
    const { fake, store } = await openAdmin({ path: '/admin/employees' })
    expect(await screen.findByRole('heading', { level: 3, name: 'עובדים' })).toBeInTheDocument()

    fake.fetchProfile.mockResolvedValue({ ...OWNER, role: 'employee' })
    await act(() => store.getState().recheck())

    expect(await screen.findByRole('heading', { level: 2, name: 'היום' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'ניהול' })).not.toBeInTheDocument()
    expect(mainTabs().queryByRole('link', { name: 'ניהול' })).not.toBeInTheDocument()
  })

  it('signs out a manager who is blocked while the app is open, as it does anybody', async () => {
    const { fake, store } = await openAdmin({ path: '/admin/employees' })
    expect(await screen.findByRole('heading', { level: 3, name: 'עובדים' })).toBeInTheDocument()
    fake.fetchProfile.mockResolvedValue({ ...OWNER, is_active: false })
    await act(() => store.getState().recheck())
    expect(await screen.findByRole('button', { name: 'כניסה' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'רשימת העובדים' })).not.toBeInTheDocument()
  })

  it('lets a person who becomes a manager meanwhile in, when the profile is read again', async () => {
    const { fake, store } = await openAdmin({ path: '/today', as: DANA, people: [OWNER, DANA] })
    await screen.findByRole('heading', { level: 2, name: 'היום' })
    expect(mainTabs().queryByRole('link', { name: 'ניהול' })).not.toBeInTheDocument()
    fake.fetchProfile.mockResolvedValue({ ...DANA, role: 'admin' })
    await act(() => store.getState().recheck())
    expect(await mainTabs().findByRole('link', { name: 'ניהול' })).toBeInTheDocument()
  })
})

describe('the Admin area', () => {
  it('goes to the employees when it is opened without a page', async () => {
    await openAdmin({ path: '/admin' })
    expect(await screen.findByRole('heading', { level: 3, name: 'עובדים' })).toBeInTheDocument()
    expect(areas().getByRole('link', { name: 'עובדים' })).toHaveAttribute('aria-current', 'page')
  })

  it('has the six pages, as links, in order', async () => {
    await openAdmin({ path: '/admin' })
    await screen.findByRole('heading', { level: 3, name: 'עובדים' })
    expect(areas().getAllByRole('link').map((link) => link.textContent)).toEqual(PAGES.map(([name]) => name))
  })

  it.each(PAGES)('opens "%s" by the link, and marks it as the current one and no other', async (name, path) => {
    const { user, router } = await openAdmin({ path: '/admin', dataRouter: true })
    await screen.findByRole('heading', { level: 3, name: 'עובדים' })
    await user.click(areas().getByRole('link', { name }))
    expect(await screen.findByRole('heading', { level: 3, name })).toBeInTheDocument()
    expect(router!.state.location.pathname).toBe(path)
    expect(areas().getByRole('link', { name })).toHaveAttribute('aria-current', 'page')
    expect(areas().getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page')).toHaveLength(1)
  })

  it.each(PAGES)('opens "%s" by its address too', async (name, path) => {
    await openAdmin({ path })
    expect(await screen.findByRole('heading', { level: 3, name })).toBeInTheDocument()
    expect(areas().getByRole('link', { name })).toHaveAttribute('aria-current', 'page')
  })

  it('is reached by the keyboard: the links are in the order of the tab key, and Enter opens one', async () => {
    const { user } = await openAdmin({ path: '/admin' })
    await screen.findByRole('heading', { level: 3, name: 'עובדים' })
    const links = areas().getAllByRole('link')
    links[0].focus()
    await user.tab()
    expect(links[1]).toHaveFocus()
    await user.tab()
    expect(links[2]).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { level: 3, name: 'הגדרות' })).toBeInTheDocument()
    expect(links[2]).toHaveAttribute('aria-current', 'page')
  })

  it('has the heading of the area, and the navigation is named for a screen reader', async () => {
    await openAdmin({ path: '/admin/employees' })
    expect(await screen.findByRole('heading', { level: 2, name: 'ניהול' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'אזורי הניהול' })).toBeInTheDocument()
  })
})
