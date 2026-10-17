import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { NotificationBanner } from './NotificationBanner'
import { NOTIFICATION_MESSAGES, REMINDER_PROBLEM, RemindersContext, type RemindersValue } from './remindersContext'

// The Today screen says what the device lets the app do about notifications, and asks for the
// permission when it has not been asked. When all is well it says nothing.

function mount(over: Partial<RemindersValue> = {}) {
  const value: RemindersValue = {
    active: [],
    snoozed: {},
    snooze: vi.fn(),
    permission: 'granted',
    requestPermission: vi.fn(async () => undefined),
    exactAlarms: 'unsupported',
    openExactAlarmSettings: vi.fn(),
    problem: null,
    ...over,
  }
  const view = render(
    <RemindersContext value={value}>
      <NotificationBanner />
    </RemindersContext>,
  )
  return { value, view }
}

describe('NotificationBanner', () => {
  it('asks to turn the notifications on when the person has not been asked, and asks the device when the button is pressed', async () => {
    const { value } = mount({ permission: 'prompt' })
    expect(screen.getByText(NOTIFICATION_MESSAGES.prompt)).toBeInTheDocument()
    expect(value.requestPermission).not.toHaveBeenCalled()
    await userEvent.setup().click(screen.getByRole('button', { name: 'הפעלת התראות' }))
    expect(value.requestPermission).toHaveBeenCalledTimes(1)
  })

  it('explains where to turn them on when they are blocked, and says that the strip still works, with no button to press', () => {
    mount({ permission: 'denied' })
    expect(screen.getByText(NOTIFICATION_MESSAGES.denied)).toBeInTheDocument()
    expect(NOTIFICATION_MESSAGES.denied).toContain('בהגדרות')
    expect(NOTIFICATION_MESSAGES.denied).toContain('התזכורות ממשיכות להופיע')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('says shortly that the device cannot show notifications, with no button to press', () => {
    mount({ permission: 'unsupported' })
    expect(screen.getByText(NOTIFICATION_MESSAGES.unsupported)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('says nothing when the notifications are on', () => {
    const { view } = mount({ permission: 'granted' })
    expect(view.container).toBeEmptyDOMElement()
  })

  it('says nothing while the permission is still being read', () => {
    const { view } = mount({ permission: null })
    expect(view.container).toBeEmptyDOMElement()
  })

  it.each(['granted', 'unsupported'] as const)('says nothing about timing when the exact alarms are %s', (exactAlarms) => {
    const { view } = mount({ permission: 'granted', exactAlarms })
    expect(view.container).toBeEmptyDOMElement()
  })

  it('says that a reminder may come a few minutes late when the exact alarms are refused, and opens their settings', async () => {
    const { value } = mount({ permission: 'granted', exactAlarms: 'denied' })
    expect(screen.getByText(NOTIFICATION_MESSAGES.approximate)).toBeInTheDocument()
    expect(value.openExactAlarmSettings).not.toHaveBeenCalled()
    await userEvent.setup().click(screen.getByRole('button', { name: 'פתיחת ההגדרות' }))
    expect(value.openExactAlarmSettings).toHaveBeenCalledTimes(1)
  })

  it('says only that they are blocked when the permission is refused, even though the exact alarms are refused too', () => {
    mount({ permission: 'denied', exactAlarms: 'denied' })
    expect(screen.getByText(NOTIFICATION_MESSAGES.denied)).toBeInTheDocument()
    expect(screen.queryByText(NOTIFICATION_MESSAGES.approximate)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'פתיחת ההגדרות' })).not.toBeInTheDocument()
  })

  it('does not ask about the timing before the person has answered the question about the permission', () => {
    mount({ permission: 'prompt', exactAlarms: 'denied' })
    expect(screen.getByText(NOTIFICATION_MESSAGES.prompt)).toBeInTheDocument()
    expect(screen.queryByText(NOTIFICATION_MESSAGES.approximate)).not.toBeInTheDocument()
  })

  it('shows the problem of planning on the device as an alert, whatever the permission is', () => {
    mount({ permission: 'granted', problem: REMINDER_PROBLEM })
    expect(screen.getByRole('alert')).toHaveTextContent(REMINDER_PROBLEM)
  })

  it('shows the problem next to the question when both are there', () => {
    mount({ permission: 'prompt', problem: REMINDER_PROBLEM })
    expect(screen.getByRole('alert')).toHaveTextContent(REMINDER_PROBLEM)
    expect(screen.getByText(NOTIFICATION_MESSAGES.prompt)).toBeInTheDocument()
  })

  it('has no alert when there is no problem', () => {
    mount({ permission: 'prompt' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
