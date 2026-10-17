import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { DANA, type FakeGateway } from '../../test/fakeGateway'
import { stubViewport } from '../../test/matchMedia'
import { renderApp } from '../../test/renderApp'
import { AUTH_MESSAGES, PASSWORD_MESSAGES } from './errors'

// A person whom an administrator has just created, or whose password an administrator has just reset, gets a
// temporary password. Until they choose one of their own they see nothing of the app: not the tabs, not
// a deep link, not the card of a task.

const TEMPORARY = { ...DANA, must_change_password: true }
const NEW_PASSWORD = 'a-password-of-my-own'
const SAME = Object.assign(new Error('the same'), { name: 'AuthApiError', code: 'same_password', status: 422 })

interface Options {
  path?: string
  /** Whether the person has a temporary password (they do, unless it says otherwise). */
  asked?: boolean
  configure?: (fake: FakeGateway) => void
  dataRouter?: boolean
}

async function open(options: Options = {}) {
  stubViewport('wide')
  const app = renderApp({
    path: options.path ?? '/today',
    dataRouter: options.dataRouter,
    configure: (fake) => {
      fake.getStoredUserId.mockResolvedValue(DANA.id)
      fake.fetchProfile.mockResolvedValue(options.asked === false ? DANA : TEMPORARY)
      options.configure?.(fake)
    },
  })
  await app.ready
  return { ...app, user: userEvent.setup() }
}

const appFrame = () => screen.queryByRole('navigation', { name: 'ניווט ראשי' })
const heading = () => screen.findByRole('heading', { level: 1, name: 'בחירת סיסמה חדשה' })
const password = () => screen.getByLabelText('סיסמה חדשה')
const confirmation = () => screen.getByLabelText('אימות הסיסמה')
const save = () => screen.getByRole('button', { name: /^(שמירה והמשך|שומר…)$/ })

async function choose(user: ReturnType<typeof userEvent.setup>, chosen = NEW_PASSWORD, again = chosen) {
  await user.type(password(), chosen)
  await user.type(confirmation(), again)
}

describe('a person who has a temporary password', () => {
  it.each(['/', '/today', '/tasks', '/calendar', '/tasks/new', '/today/a-task', '/calendar/a-task', '/login', '/nowhere'])(
    'is held on the page that asks for a new one at %s, and sees none of the app',
    async (path) => {
      const app = await open({ path })
      expect(await heading()).toBeInTheDocument()
      expect(appFrame()).not.toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      for (const name of ['היום', 'משימות', 'יומן']) expect(screen.queryByRole('heading', { name })).not.toBeInTheDocument()
      // Nothing of the team's work is even fetched or listened to.
      expect(app.backend.tasks.calls.loadInitial).toBe(0)
      expect(app.backend.tasks.subscribers).toBe(0)
      expect(app.backend.directory.loads).toBe(0)
    },
  )

  it('is held there after signing in with the temporary password', async () => {
    const { user } = await open({ path: '/login', configure: (fake) => fake.getStoredUserId.mockResolvedValue(null) })
    await user.type(await screen.findByLabelText('אימייל'), 'dana@example.com')
    await user.type(screen.getByLabelText('סיסמה'), 'the-temporary-one{Enter}')
    expect(await heading()).toBeInTheDocument()
    expect(appFrame()).not.toBeInTheDocument()
  })

  it('asks for the password and its confirmation, which are password fields that a password manager can fill', async () => {
    await open()
    await heading()
    for (const field of [password(), confirmation()]) {
      expect(field).toHaveAttribute('type', 'password')
      expect(field).toHaveAttribute('autocomplete', 'new-password')
      expect(field).toHaveAttribute('dir', 'ltr')
    }
    expect(password()).toHaveFocus()
    expect(screen.getByText(/לפחות 10 תווים/)).toBeInTheDocument()
  })

  it('has a button to sign out, which leads to the login page', async () => {
    const { fake, user } = await open()
    await heading()
    await user.click(screen.getByRole('button', { name: 'התנתקות' }))
    expect(fake.signOut).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: 'כניסה' })).toBeInTheDocument()
  })

  it('asks again, with the field and the reason, when the password is missing, too short, or not the same twice', async () => {
    const { fake, user } = await open()
    await heading()

    await user.click(save())
    expect(screen.getByText('הזינו סיסמה חדשה.')).toBeInTheDocument()
    expect(password()).toHaveFocus()
    expect(password()).toBeInvalid()
    expect(confirmation()).toBeValid()

    await user.type(password(), 'short')
    await user.type(confirmation(), 'short')
    await user.click(save())
    expect(screen.getByText('הסיסמה קצרה מדי: לפחות 10 תווים.')).toBeInTheDocument()
    expect(password()).toHaveFocus()

    await user.clear(password())
    await user.clear(confirmation())
    await choose(user, NEW_PASSWORD, 'another-password')
    await user.click(save())
    expect(screen.getByText('שתי הסיסמאות אינן זהות.')).toBeInTheDocument()
    expect(confirmation()).toHaveFocus()
    expect(confirmation()).toBeInvalid()
    expect(password()).toBeValid()
    expect(password()).toHaveValue(NEW_PASSWORD)

    expect(fake.changePassword).not.toHaveBeenCalled()
  })

  it('ties the reason to its field, for a screen reader', async () => {
    const { user } = await open()
    await heading()
    await user.type(password(), 'short')
    await user.type(confirmation(), 'short')
    await user.click(save())
    const reason = screen.getByText('הסיסמה קצרה מדי: לפחות 10 תווים.')
    expect(password()).toHaveAccessibleDescription('הסיסמה קצרה מדי: לפחות 10 תווים.')
    expect(reason).toHaveAttribute('id', password().getAttribute('aria-describedby'))
  })

  it('takes the reasons away once the password is good', async () => {
    const { user } = await open()
    await heading()
    await user.click(save())
    expect(screen.getByText('הזינו סיסמה חדשה.')).toBeInTheDocument()
    await choose(user)
    await user.click(save())
    await screen.findByRole('navigation', { name: 'ניווט ראשי' })
    expect(screen.queryByText('הזינו סיסמה חדשה.')).not.toBeInTheDocument()
  })

  it('sets the password, says so, and lands on the page that was asked for', async () => {
    const { fake, user } = await open({ path: '/tasks' })
    await heading()
    await choose(user)
    await user.click(save())
    expect(await screen.findByRole('heading', { level: 2, name: 'משימות' })).toBeInTheDocument()
    expect(appFrame()).toBeInTheDocument()
    expect(fake.changePassword).toHaveBeenCalledExactlyOnceWith(NEW_PASSWORD)
    expect(fake.clearMustChangePassword).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('heading', { name: 'בחירת סיסמה חדשה' })).not.toBeInTheDocument()
  })

  it('lands on the card of a task that was asked for by its address', async () => {
    const { user } = await open({ path: '/tasks/new' })
    await heading()
    await choose(user)
    await user.click(save())
    expect(await screen.findByRole('dialog', { name: 'משימה חדשה' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'משימות' })).toBeInTheDocument()
  })

  it.each([
    ['the temporary password typed again', SAME, PASSWORD_MESSAGES.same_password],
    ['a password that the server finds weak', Object.assign(new Error('weak'), { name: 'AuthWeakPasswordError', code: 'weak_password', status: 422 }), PASSWORD_MESSAGES.weak_password],
    ['a session that has ended', Object.assign(new Error('gone'), { name: 'AuthSessionMissingError', status: 400 }), PASSWORD_MESSAGES.session],
    ['a server that cannot be reached', new TypeError('Failed to fetch'), PASSWORD_MESSAGES.network],
  ])('says what is wrong after %s, keeps what was typed, and stays where it is', async (_what, error, sentence) => {
    const { fake, user } = await open()
    fake.changePassword.mockRejectedValue(error)
    await heading()
    await choose(user)
    await user.click(save())
    expect(await screen.findByRole('alert')).toHaveTextContent(sentence)
    expect(password()).toHaveValue(NEW_PASSWORD)
    expect(confirmation()).toHaveValue(NEW_PASSWORD)
    expect(save()).toBeEnabled()
    expect(appFrame()).not.toBeInTheDocument()
    expect(fake.clearMustChangePassword).not.toHaveBeenCalled()
  })

  it('takes the message of the server away when the person tries again, whatever comes of it', async () => {
    const { fake, user } = await open()
    fake.changePassword.mockRejectedValueOnce(SAME)
    await heading()
    await choose(user)
    await user.click(save())
    expect(await screen.findByRole('alert')).toHaveTextContent(PASSWORD_MESSAGES.same_password)

    // The next try is turned back by the page itself: the old message of the server is not left beside the new one.
    await user.clear(password())
    await user.clear(confirmation())
    await user.type(password(), 'short')
    await user.type(confirmation(), 'short')
    await user.click(save())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('הסיסמה קצרה מדי: לפחות 10 תווים.')).toBeInTheDocument()
  })

  it('shows no password in the message, whatever the server says', async () => {
    const { fake, user } = await open()
    fake.changePassword.mockRejectedValue(Object.assign(new Error(`Password ${NEW_PASSWORD} is weak`), { code: 'weak_password' }))
    await heading()
    await choose(user)
    await user.click(save())
    expect((await screen.findByRole('alert')).textContent).not.toContain(NEW_PASSWORD)
  })

  it('says to try again when the password was set and the rest was not, and the second try opens the app', async () => {
    const { fake, user } = await open()
    fake.clearMustChangePassword.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await heading()
    await choose(user)
    await user.click(save())
    expect(await screen.findByRole('alert')).toHaveTextContent(PASSWORD_MESSAGES.incomplete)
    expect(appFrame()).not.toBeInTheDocument()

    // The server has the password now, and says "the same" to it.
    fake.changePassword.mockRejectedValue(SAME)
    await user.click(save())
    expect(await screen.findByRole('navigation', { name: 'ניווט ראשי' })).toBeInTheDocument()
    expect(fake.clearMustChangePassword).toHaveBeenCalledTimes(2)
  })

  it('shows that it is working, and sends one request for a double click', async () => {
    const { fake, user } = await open()
    let release: () => void = () => undefined
    fake.changePassword.mockReturnValue(new Promise<void>((resolve) => (release = resolve)))
    await heading()
    await choose(user)
    await user.dblClick(save())
    expect(await screen.findByRole('button', { name: 'שומר…' })).toBeDisabled()
    // Signing out is still possible while it works.
    expect(screen.getByRole('button', { name: 'התנתקות' })).toBeEnabled()
    release()
    await screen.findByRole('navigation', { name: 'ניווט ראשי' })
    expect(fake.changePassword).toHaveBeenCalledTimes(1)
  })
})

describe('a person who is asked to choose a password while the app is open', () => {
  it('is held on the page at once when the check of the profile finds it out', async () => {
    const { fake, store, user } = await open({ path: '/tasks', asked: false })
    expect(await screen.findByRole('heading', { level: 2, name: 'משימות' })).toBeInTheDocument()

    fake.fetchProfile.mockResolvedValue(TEMPORARY)
    await act(() => store.getState().recheck())

    expect(await heading()).toBeInTheDocument()
    expect(appFrame()).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'משימות' })).not.toBeInTheDocument()

    // And once they have chosen, they are back where they were.
    await choose(user)
    await user.click(save())
    expect(await screen.findByRole('heading', { level: 2, name: 'משימות' })).toBeInTheDocument()
  })

  it('is held there when the app comes back to the front and the profile says so', async () => {
    const { fake } = await open({ path: '/today', asked: false })
    await screen.findByRole('navigation', { name: 'ניווט ראשי' })
    fake.fetchProfile.mockResolvedValue(TEMPORARY)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(await heading()).toBeInTheDocument()
  })
})

describe('the page itself is still a signed-in page', () => {
  const visible = () => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
  }

  it('sends a person who was blocked meanwhile to the login page, with the reason', async () => {
    const { fake } = await open()
    await heading()
    fake.fetchProfile.mockResolvedValue({ ...TEMPORARY, is_active: false })
    visible()
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.notMember)
    expect(screen.getByRole('button', { name: 'כניסה' })).toBeInTheDocument()
  })

  it('sees at once that the password was chosen on another device', async () => {
    const { fake } = await open({ path: '/tasks' })
    await heading()
    fake.fetchProfile.mockResolvedValue(DANA)
    visible()
    expect(await screen.findByRole('heading', { level: 2, name: 'משימות' })).toBeInTheDocument()
  })
})
