import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { card, findCard, openCard } from '../../test/cardHarness'
import { DANA, OWNER } from '../../test/fakeGateway'
import { stubViewport } from '../../test/matchMedia'
import { renderApp } from '../../test/renderApp'
import { PASSWORD_MESSAGES, PROFILE_MESSAGES } from './errors'
import type { Profile } from './types'

// The page where a person looks after themselves: the name that the team sees, the reminder that their new
// tasks start with, and their password. The e-mail and the role are shown and cannot be changed here.

const NEW_PASSWORD = 'a-password-of-my-own'
const SAME = Object.assign(new Error('the same'), { name: 'AuthApiError', code: 'same_password', status: 422 })
const TAKEN = Object.assign(new Error('duplicate key value violates unique constraint "profiles_display_name_key"'), { code: '23505', status: 409 })

async function open(options: { as?: Profile; dataRouter?: boolean } = {}) {
  const app = openCard('/profile', [], { as: options.as, dataRouter: options.dataRouter })
  await app.ready
  await screen.findByRole('heading', { level: 2, name: 'הפרופיל שלי' })
  return app
}

const details = () => within(screen.getByRole('form', { name: 'פרטים אישיים' }))
const passwordForm = () => within(screen.getByRole('form', { name: 'החלפת סיסמה' }))
const name = () => details().getByLabelText('שם תצוגה')
const reminder = () => details().getByLabelText('תזכורת ברירת מחדל (בדקות לפני המועד)')
const saveDetails = () => details().getByRole('button', { name: /^(שמירה|שומר…)$/ })
const newPassword = () => passwordForm().getByLabelText('סיסמה חדשה')
const confirmation = () => passwordForm().getByLabelText('אימות הסיסמה')
const changePassword = () => passwordForm().getByRole('button', { name: /^(החלפת סיסמה|שומר…)$/ })

async function replace(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, text: string) {
  await user.clear(field)
  if (text) await user.type(field, text)
}

describe('the page', () => {
  it('shows who the person is: the e-mail and the role, as text that cannot be edited', async () => {
    await open()
    expect(details().getByText('dana@example.com')).toBeInTheDocument()
    expect(details().getByText('עובד')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('dana@example.com')).not.toBeInTheDocument()
    expect(details().getAllByRole('textbox')).toHaveLength(2)
  })

  it('calls an administrator a manager', async () => {
    await open({ as: OWNER })
    expect(details().getByText('מנהל')).toBeInTheDocument()
  })

  it('starts with the name and the default reminder that the person has', async () => {
    await open()
    expect(name()).toHaveValue('דנה')
    expect(reminder()).toHaveValue('15')
    expect(reminder()).toHaveAttribute('inputmode', 'numeric')
    expect(reminder()).toHaveAttribute('dir', 'ltr')
  })

  it('is reached from the user menu, which closes behind it', async () => {
    const { user } = openCard('/today')
    await screen.findByRole('navigation', { name: 'ניווט ראשי' })
    const toggle = screen.getByRole('button', { name: 'דנה' })
    await user.click(toggle)
    await user.click(screen.getByRole('link', { name: 'הפרופיל שלי' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'הפרופיל שלי' })).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    // The tabs are still there to go back to the work.
    expect(screen.getByRole('navigation', { name: 'ניווט ראשי' })).toBeInTheDocument()
  })

  it('sends a visitor who is not signed in to the login page', async () => {
    const app = renderApp({ path: '/profile' })
    await app.ready
    expect(await screen.findByRole('button', { name: 'כניסה' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'הפרופיל שלי' })).not.toBeInTheDocument()
  })
})

describe('the name and the reminder', () => {
  it('are saved together, with the name trimmed, and the user menu shows the new name', async () => {
    const { fake, user } = await open()
    await replace(user, name(), '  דנה כהן  ')
    await replace(user, reminder(), ' 30 ')
    await user.click(saveDetails())

    expect(await screen.findByText('הפרופיל נשמר.')).toBeInTheDocument()
    expect(fake.updateMyProfile).toHaveBeenCalledExactlyOnceWith({ display_name: 'דנה כהן', default_remind_min: 30 })
    expect(screen.getByRole('button', { name: 'דנה כהן' })).toBeInTheDocument()
    // The fields show what was saved, not what was typed.
    expect(name()).toHaveValue('דנה כהן')
    expect(reminder()).toHaveValue('30')
  })

  it('takes the reasons away once the form is good, and the message about a name that is taken too', async () => {
    const { fake, user } = await open()
    await replace(user, name(), '')
    await user.click(saveDetails())
    expect(details().getByText('הזינו שם.')).toBeInTheDocument()
    await replace(user, name(), 'דנה כהן')
    await user.click(saveDetails())
    await screen.findByText('הפרופיל נשמר.')
    expect(screen.queryByText('הזינו שם.')).not.toBeInTheDocument()
    expect(name()).toBeValid()

    fake.updateMyProfile.mockRejectedValueOnce(TAKEN)
    await replace(user, name(), 'אבי לוי')
    await user.click(saveDetails())
    await details().findByText(PROFILE_MESSAGES.name_taken)
    fake.updateMyProfile.mockResolvedValue({ ...DANA, display_name: 'נועה' })
    await replace(user, name(), 'נועה')
    await user.click(saveDetails())
    await screen.findByText('הפרופיל נשמר.')
    expect(screen.queryByText(PROFILE_MESSAGES.name_taken)).not.toBeInTheDocument()
    expect(name()).toBeValid()
  })

  it('may be a reminder of nought, which is a reminder at the time of the task', async () => {
    const { fake, user } = await open()
    await replace(user, reminder(), '0')
    await user.click(saveDetails())
    await screen.findByText('הפרופיל נשמר.')
    expect(fake.updateMyProfile).toHaveBeenCalledExactlyOnceWith({ display_name: 'דנה', default_remind_min: 0 })
  })

  it('is the reminder that the next new task starts with', async () => {
    stubViewport('wide')
    const { user, router } = await open({ dataRouter: true })
    await replace(user, reminder(), '45')
    await user.click(saveDetails())
    await screen.findByText('הפרופיל נשמר.')

    await act(async () => {
      await router!.navigate('/tasks/new')
    })
    await findCard()
    expect(card().getByLabelText('תזכורת')).toHaveValue('45')
  })

  it.each([
    ['name', name],
    ['reminder', reminder],
  ])('takes the message away when the person changes the %s after saving', async (_which, field) => {
    const { user } = await open()
    await user.click(saveDetails())
    await screen.findByText('הפרופיל נשמר.')
    await user.type(field(), '1')
    expect(screen.queryByText('הפרופיל נשמר.')).not.toBeInTheDocument()
  })

  it('asks again, naming the field, when the name is empty, too long, or the reminder is not a number of minutes', async () => {
    const { fake, user } = await open()

    await replace(user, name(), '   ')
    await user.click(saveDetails())
    expect(details().getByText('הזינו שם.')).toBeInTheDocument()
    expect(name()).toHaveFocus()
    expect(name()).toBeInvalid()

    await replace(user, name(), 'א'.repeat(61))
    await user.click(saveDetails())
    expect(details().getByText('השם ארוך מדי: עד 60 תווים.')).toBeInTheDocument()

    await replace(user, name(), 'דנה')
    await replace(user, reminder(), '1441')
    await user.click(saveDetails())
    expect(details().getByText('התזכורת היא מספר שלם של דקות, מ-0 עד 1440.')).toBeInTheDocument()
    expect(reminder()).toHaveFocus()
    expect(reminder()).toBeInvalid()
    expect(name()).toBeValid()

    expect(fake.updateMyProfile).not.toHaveBeenCalled()
  })

  it('names both fields at once, and puts the cursor on the first', async () => {
    const { user } = await open()
    await replace(user, name(), '')
    await replace(user, reminder(), 'abc')
    await user.click(saveDetails())
    expect(details().getByText('הזינו שם.')).toBeInTheDocument()
    expect(details().getByText('התזכורת היא מספר שלם של דקות, מ-0 עד 1440.')).toBeInTheDocument()
    expect(name()).toHaveFocus()
  })

  it('says that the name is taken next to the name, keeps what was typed, and leaves the user menu alone', async () => {
    const { fake, user } = await open()
    fake.updateMyProfile.mockRejectedValue(TAKEN)
    await replace(user, name(), 'אבי לוי')
    await user.click(saveDetails())

    const message = await details().findByText(PROFILE_MESSAGES.name_taken)
    expect(message).toBeInTheDocument()
    expect(name()).toHaveAccessibleDescription(PROFILE_MESSAGES.name_taken)
    expect(name()).toBeInvalid()
    expect(name()).toHaveFocus()
    expect(name()).toHaveValue('אבי לוי')
    expect(screen.getByRole('button', { name: 'דנה' })).toBeInTheDocument()
    expect(saveDetails()).toBeEnabled()
  })

  it.each([
    ['a server that cannot be reached', new TypeError('Failed to fetch'), PROFILE_MESSAGES.network],
    ['a session that has ended', Object.assign(new Error('JWT expired'), { code: 'PGRST301', status: 401 }), PROFILE_MESSAGES.session],
    ['a refusal of the database', Object.assign(new Error('bad'), { code: '22023', status: 400 }), PROFILE_MESSAGES.invalid],
    ['a failure that nobody foresaw', new Error('boom'), PROFILE_MESSAGES.generic],
  ])('says what is wrong after %s, and keeps what was typed', async (_what, error, sentence) => {
    const { fake, user } = await open()
    fake.updateMyProfile.mockRejectedValue(error)
    await replace(user, name(), 'דנה כהן')
    await user.click(saveDetails())
    expect(await details().findByRole('alert')).toHaveTextContent(sentence)
    expect(name()).toHaveValue('דנה כהן')
    expect(screen.queryByText('הפרופיל נשמר.')).not.toBeInTheDocument()
  })

  it('shows that it is working, and sends one request for a double click', async () => {
    const { fake, user } = await open()
    let release: (profile: Profile) => void = () => undefined
    fake.updateMyProfile.mockReturnValue(new Promise<Profile>((resolve) => (release = resolve)))
    await user.dblClick(saveDetails())
    expect(await details().findByRole('button', { name: 'שומר…' })).toBeDisabled()
    release({ ...DANA })
    await screen.findByText('הפרופיל נשמר.')
    expect(fake.updateMyProfile).toHaveBeenCalledTimes(1)
  })

  it('is not mixed up with the password: saving the profile does not touch it', async () => {
    const { fake, user } = await open()
    await user.type(newPassword(), NEW_PASSWORD)
    await user.click(saveDetails())
    await screen.findByText('הפרופיל נשמר.')
    expect(fake.changePassword).not.toHaveBeenCalled()
    expect(newPassword()).toHaveValue(NEW_PASSWORD)
  })
})

describe('the password', () => {
  it('has a form of its own, with fields that a password manager can fill', async () => {
    await open()
    for (const field of [newPassword(), confirmation()]) {
      expect(field).toHaveAttribute('type', 'password')
      expect(field).toHaveAttribute('autocomplete', 'new-password')
      expect(field).toHaveAttribute('dir', 'ltr')
    }
    // The fields of the profile are not in it, and the password is not in the profile.
    expect(passwordForm().queryByLabelText('שם תצוגה')).not.toBeInTheDocument()
    expect(details().queryByLabelText('סיסמה חדשה')).not.toBeInTheDocument()
  })

  it('is changed with the same action as the first password, and the fields are emptied once it is', async () => {
    const { fake, store, user } = await open()
    await user.type(newPassword(), NEW_PASSWORD)
    await user.type(confirmation(), NEW_PASSWORD)
    await user.click(changePassword())

    expect(await screen.findByText('הסיסמה הוחלפה.')).toBeInTheDocument()
    expect(fake.changePassword).toHaveBeenCalledExactlyOnceWith(NEW_PASSWORD)
    // The person was never asked to choose one, so nothing is said to the database about it.
    expect(fake.clearMustChangePassword).not.toHaveBeenCalled()
    expect(fake.updateMyProfile).not.toHaveBeenCalled()
    expect(newPassword()).toHaveValue('')
    expect(confirmation()).toHaveValue('')
    expect(JSON.stringify(store.getState())).not.toContain(NEW_PASSWORD)
    expect(document.body.textContent).not.toContain(NEW_PASSWORD)
  })

  it.each([
    ['new password', newPassword],
    ['confirmation', confirmation],
  ])('takes the message away when the person starts another one in the field of the %s', async (_which, field) => {
    const { user } = await open()
    await user.type(newPassword(), NEW_PASSWORD)
    await user.type(confirmation(), NEW_PASSWORD)
    await user.click(changePassword())
    await screen.findByText('הסיסמה הוחלפה.')
    await user.type(field(), 'x')
    expect(screen.queryByText('הסיסמה הוחלפה.')).not.toBeInTheDocument()
  })

  it('asks again, with the field and the reason, and does not call the server', async () => {
    const { fake, user } = await open()
    await user.type(newPassword(), 'short')
    await user.type(confirmation(), 'short')
    await user.click(changePassword())
    expect(passwordForm().getByText('הסיסמה קצרה מדי: לפחות 10 תווים.')).toBeInTheDocument()
    expect(newPassword()).toHaveFocus()

    await user.clear(newPassword())
    await user.clear(confirmation())
    await user.type(newPassword(), NEW_PASSWORD)
    await user.type(confirmation(), 'another-one-of-mine')
    await user.click(changePassword())
    expect(passwordForm().getByText('שתי הסיסמאות אינן זהות.')).toBeInTheDocument()
    expect(confirmation()).toHaveFocus()
    expect(fake.changePassword).not.toHaveBeenCalled()
  })

  it('says, in its own section, that the password is the one the person has', async () => {
    const { fake, user } = await open()
    fake.changePassword.mockRejectedValue(SAME)
    await user.type(newPassword(), NEW_PASSWORD)
    await user.type(confirmation(), NEW_PASSWORD)
    await user.click(changePassword())
    expect(await passwordForm().findByRole('alert')).toHaveTextContent(PASSWORD_MESSAGES.same_password)
    expect(details().queryByRole('alert')).not.toBeInTheDocument()
    expect(newPassword()).toHaveValue(NEW_PASSWORD)
    expect(screen.queryByText('הסיסמה הוחלפה.')).not.toBeInTheDocument()
  })

  it('takes the message of the server away when the next try works', async () => {
    const { fake, user } = await open()
    fake.changePassword.mockRejectedValueOnce(SAME)
    await user.type(newPassword(), NEW_PASSWORD)
    await user.type(confirmation(), NEW_PASSWORD)
    await user.click(changePassword())
    expect(await passwordForm().findByRole('alert')).toHaveTextContent(PASSWORD_MESSAGES.same_password)

    await user.click(changePassword())
    expect(await screen.findByText('הסיסמה הוחלפה.')).toBeInTheDocument()
    expect(passwordForm().queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows that it is working, and sends one request for a double click', async () => {
    const { fake, user } = await open()
    let release: () => void = () => undefined
    fake.changePassword.mockReturnValue(new Promise<void>((resolve) => (release = resolve)))
    await user.type(newPassword(), NEW_PASSWORD)
    await user.type(confirmation(), NEW_PASSWORD)
    await user.dblClick(changePassword())
    expect(await passwordForm().findByRole('button', { name: 'שומר…' })).toBeDisabled()
    release()
    await screen.findByText('הסיסמה הוחלפה.')
    expect(fake.changePassword).toHaveBeenCalledTimes(1)
  })
})
