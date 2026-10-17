import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { card, findCard, lastUpsert, openCard, task, type } from '../../test/cardHarness'
import { stubClipboard } from '../../test/clipboard'
import { DANA, OWNER } from '../../test/fakeGateway'
import { TASK_MESSAGES } from './validation'

const HOUR = 3_600_000
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString()

describe('a new task', () => {
  it('has a name, and is for the person who is making it', async () => {
    openCard('/tasks/new')
    expect(await screen.findByRole('dialog', { name: 'משימה חדשה' })).toBeInTheDocument()
    expect(card().getByLabelText('שיוך')).toHaveValue(DANA.id)
    expect(card().getByLabelText('סוג')).toHaveValue('general')
    expect(card().getByLabelText('עדיפות')).toHaveValue('normal')
    expect(card().getByLabelText('סטטוס')).toHaveValue('processing')
    expect(card().queryByRole('alert')).not.toBeInTheDocument()
  })

  it('saves with only an order number: the title is made from it, and the "#" is not kept', async () => {
    const { user, backend } = openCard('/tasks/new')
    await findCard()
    await type(user, 'מספר הזמנה', '#1234')
    await user.click(card().getByLabelText('אין שיחה ב-Glassix'))
    await user.click(card().getByRole('button', { name: 'שמירה' }))

    await waitFor(() => expect(lastUpsert(backend)?.patch).toMatchObject({ title: 'טיפול בהזמנה #1234', order_number: '1234', no_glassix: true }))
    expect(lastUpsert(backend)?.patch).toMatchObject({ assignee_id: DANA.id, kind: 'general', status_key: 'processing' })
    expect(backend.tasks.upserts).toHaveLength(1)
  })

  it('closes and shows the list after it is saved, with the new task in it', async () => {
    const { user } = openCard('/tasks/new')
    await findCard()
    await type(user, 'כותרת', 'להתקשר ללקוח')
    await type(user, 'שם לקוח', 'משה')
    await user.click(card().getByLabelText('אין שיחה ב-Glassix'))
    await user.click(card().getByRole('button', { name: 'שמירה' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'להתקשר ללקוח' })).toBeInTheDocument()
  })

  it('shows what is missing when it is saved empty, puts the focus on the title, and queues nothing', async () => {
    const { user, backend } = openCard('/tasks/new')
    await findCard()
    await user.click(card().getByRole('button', { name: 'שמירה' }))

    expect(card().getByText(TASK_MESSAGES.title)).toHaveAttribute('role', 'alert')
    expect(card().getByText(TASK_MESSAGES.contact)).toHaveAttribute('role', 'alert')
    expect(card().getByText(TASK_MESSAGES.glassix)).toHaveAttribute('role', 'alert')
    expect(card().getByLabelText('כותרת')).toHaveFocus()
    expect(card().getByLabelText('כותרת')).toBeInvalid()
    expect(backend.tasks.upserts).toHaveLength(0)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('takes away each message when what it asks for is mended', async () => {
    const { user } = openCard('/tasks/new')
    await findCard()
    await user.click(card().getByRole('button', { name: 'שמירה' }))
    await type(user, 'כותרת', 'משהו')
    expect(card().queryByText(TASK_MESSAGES.title)).not.toBeInTheDocument()
    expect(card().getByText(TASK_MESSAGES.glassix)).toBeInTheDocument()
    await user.click(card().getByLabelText('אין שיחה ב-Glassix'))
    expect(card().queryByText(TASK_MESSAGES.glassix)).not.toBeInTheDocument()
    await type(user, 'שם לקוח', 'משה')
    expect(card().queryByText(TASK_MESSAGES.contact)).not.toBeInTheDocument()
  })

  it('puts the focus on the first field that is wrong, in the order of the card: title, date, customer, Glassix', async () => {
    const { user } = openCard('/tasks/new')
    await findCard()
    fireEvent.change(card().getByLabelText('שעה'), { target: { value: '14:30' } })
    await user.click(card().getByRole('button', { name: 'שמירה' }))
    expect(card().getByLabelText('כותרת')).toHaveFocus()

    await type(user, 'כותרת', 'משהו')
    await user.click(card().getByRole('button', { name: 'שמירה' }))
    expect(card().getByLabelText('תאריך')).toHaveFocus()

    fireEvent.change(card().getByLabelText('תאריך'), { target: { value: '2026-10-20' } })
    await user.click(card().getByRole('button', { name: 'שמירה' }))
    expect(card().getByLabelText('שם לקוח')).toHaveFocus()

    await type(user, 'שם לקוח', 'משה')
    await user.click(card().getByRole('button', { name: 'שמירה' }))
    expect(card().getByLabelText('מזהה שיחת Glassix')).toHaveFocus()
  })

  it('says that a time needs a date, and puts the focus on the date', async () => {
    const { user, backend } = openCard('/tasks/new')
    await findCard()
    await type(user, 'כותרת', 'משהו')
    await type(user, 'שם לקוח', 'משה')
    await user.click(card().getByLabelText('אין שיחה ב-Glassix'))
    fireEvent.change(card().getByLabelText('שעה'), { target: { value: '14:30' } })
    await user.click(card().getByRole('button', { name: 'שמירה' }))
    expect(card().getByText(TASK_MESSAGES.dueNeedsDate)).toHaveAttribute('role', 'alert')
    expect(card().getByLabelText('תאריך')).toHaveFocus()
    expect(backend.tasks.upserts).toHaveLength(0)
  })

  it('does not save without a Glassix id or the tick, and saves with either', async () => {
    const { user, backend } = openCard('/tasks/new')
    await findCard()
    await type(user, 'כותרת', 'משהו')
    await type(user, 'שם לקוח', 'משה')
    await user.click(card().getByRole('button', { name: 'שמירה' }))
    expect(card().getByText(TASK_MESSAGES.glassix)).toBeInTheDocument()
    expect(card().getByLabelText('מזהה שיחת Glassix')).toHaveFocus()
    expect(backend.tasks.upserts).toHaveLength(0)

    await type(user, 'מזהה שיחת Glassix', 'gx-77')
    await user.click(card().getByRole('button', { name: 'שמירה' }))
    await waitFor(() => expect(lastUpsert(backend)?.patch).toMatchObject({ glassix_conversation_id: 'gx-77', no_glassix: false }))
  })

  it('does not save a pickup without the name of the product, and saves with it', async () => {
    const { user, backend } = openCard('/tasks/new')
    await findCard()
    await user.selectOptions(card().getByLabelText('סוג'), 'pickup')
    await type(user, 'כותרת', 'לאסוף')
    await type(user, 'שם לקוח', 'משה')
    await user.click(card().getByLabelText('אין שיחה ב-Glassix'))
    await user.click(card().getByRole('button', { name: 'שמירה' }))
    expect(card().getByText(TASK_MESSAGES.product)).toHaveAttribute('role', 'alert')
    expect(card().getByLabelText('שם מוצר')).toHaveFocus()
    expect(backend.tasks.upserts).toHaveLength(0)

    await type(user, 'שם מוצר', 'מקרר')
    await type(user, 'מק״ט', 'SKU-9')
    await user.click(card().getByRole('button', { name: 'שמירה' }))
    await waitFor(() => expect(lastUpsert(backend)?.patch).toMatchObject({ kind: 'pickup', product_name: 'מקרר', product_sku: 'SKU-9' }))
  })

  it('sends the date and the time as a moment on the wall in Jerusalem', async () => {
    const { user, backend } = openCard('/tasks/new')
    await findCard()
    await type(user, 'כותרת', 'משהו')
    await type(user, 'שם לקוח', 'משה')
    await user.click(card().getByLabelText('אין שיחה ב-Glassix'))
    fireEvent.change(card().getByLabelText('תאריך'), { target: { value: '2026-10-20' } })
    fireEvent.change(card().getByLabelText('שעה'), { target: { value: '14:30' } })
    await user.click(card().getByRole('button', { name: 'שמירה' }))
    await waitFor(() => expect(lastUpsert(backend)?.patch).toMatchObject({ due_at: '2026-10-20T11:30:00.000Z' }))
  })

  it('has no button for done and none for deleting, because the task does not exist yet', async () => {
    openCard('/tasks/new')
    await findCard()
    expect(card().queryByRole('button', { name: 'בוצע' })).not.toBeInTheDocument()
    expect(card().queryByRole('button', { name: 'מחק משימה' })).not.toBeInTheDocument()
  })
})

describe('the card of a task', () => {
  const a = task('a', {
    title: 'לחזור ללקוח',
    notes: 'הערה ישנה',
    customer_phone: '050-123-4567',
    order_number: '10442',
    glassix_conversation_id: 'gx-77',
    due_at: '2026-10-16T06:00:00.000Z',
    priority: 'high',
    status_key: 'cargo',
  })

  it('has the name of the task, and shows its fields', async () => {
    openCard('/tasks/a', [a])
    expect(await screen.findByRole('dialog', { name: 'לחזור ללקוח' })).toBeInTheDocument()
    expect(card().getByLabelText('כותרת')).toHaveValue('לחזור ללקוח')
    expect(card().getByLabelText('הערות')).toHaveValue('הערה ישנה')
    expect(card().getByLabelText('שם לקוח')).toHaveValue('רונית כהן')
    expect(card().getByLabelText('טלפון')).toHaveValue('050-123-4567')
    expect(card().getByLabelText('מספר הזמנה')).toHaveValue('10442')
    expect(card().getByLabelText('מזהה שיחת Glassix')).toHaveValue('gx-77')
    expect(card().getByLabelText('תאריך')).toHaveValue('2026-10-16')
    expect(card().getByLabelText('שעה')).toHaveValue('09:00')
    expect(card().getByLabelText('עדיפות')).toHaveValue('high')
    expect(card().getByLabelText('סטטוס')).toHaveValue('cargo')
    expect(card().getByLabelText('שיוך')).toHaveValue(DANA.id)
    for (const label of ['טלפון', 'מספר הזמנה', 'מזהה שיחת Glassix']) expect(card().getByLabelText(label)).toHaveAttribute('dir', 'ltr')
    expect(card().getByLabelText('שם לקוח')).not.toHaveAttribute('dir')
    expect(card().getByLabelText('כותרת')).toHaveFocus()
    expect(card().queryByRole('alert')).not.toBeInTheDocument()
    expect(card().queryByText(/^עודכן על ידי/)).not.toBeInTheDocument()
  })

  it('sends a patch with exactly the field that was changed', async () => {
    const { user, backend } = openCard('/tasks/a', [a])
    await findCard()
    await user.clear(card().getByLabelText('הערות'))
    await user.type(card().getByLabelText('הערות'), 'הערה חדשה')
    await user.click(card().getByRole('button', { name: 'שמירה' }))
    await waitFor(() => expect(backend.tasks.upserts).toHaveLength(1))
    expect(lastUpsert(backend)).toEqual({ id: 'a', patch: { notes: 'הערה חדשה' } })
  })

  it('sends each kind of field that is changed: the lists, the date and the time, the numbers and the ticks', async () => {
    const { user, backend } = openCard('/tasks/a', [a])
    await findCard()
    await user.selectOptions(card().getByLabelText('סוג'), 'delivery')
    await user.selectOptions(card().getByLabelText('שיוך'), OWNER.id)
    await user.selectOptions(card().getByLabelText('עדיפות'), 'urgent')
    await user.selectOptions(card().getByLabelText('סטטוס'), 'abroad')
    await user.selectOptions(card().getByLabelText('משך'), '60')
    await user.selectOptions(card().getByLabelText('תזכורת'), '10')
    fireEvent.change(card().getByLabelText('תאריך'), { target: { value: '2026-10-18' } })
    fireEvent.change(card().getByLabelText('שעה'), { target: { value: '15:00' } })
    await user.type(card().getByLabelText('מספר Cargo'), 'CG-5')
    await user.click(card().getByLabelText('נשלח ל-CARGO'))
    await user.click(card().getByRole('button', { name: 'שמירה' }))
    await waitFor(() => expect(backend.tasks.upserts).toHaveLength(1))
    expect(lastUpsert(backend)?.patch).toEqual({
      kind: 'delivery',
      assignee_id: OWNER.id,
      priority: 'urgent',
      status_key: 'abroad',
      duration_min: 60,
      remind_min: 10,
      due_at: '2026-10-18T12:00:00.000Z',
      cargo_number: 'CG-5',
      sent_to_cargo: true,
    })
  })

  it('can take the reminder away', async () => {
    const { user, backend } = openCard('/tasks/a', [task('a', { remind_min: 10 })])
    await findCard()
    expect(card().getByLabelText('תזכורת')).toHaveValue('10')
    await user.selectOptions(card().getByLabelText('תזכורת'), '')
    await user.click(card().getByRole('button', { name: 'שמירה' }))
    await waitFor(() => expect(lastUpsert(backend)?.patch).toEqual({ remind_min: null }))
  })

  it('can take the date away, and the person who it is for', async () => {
    const { user, backend } = openCard('/tasks/a', [a])
    await findCard()
    fireEvent.change(card().getByLabelText('תאריך'), { target: { value: '' } })
    fireEvent.change(card().getByLabelText('שעה'), { target: { value: '' } })
    await user.selectOptions(card().getByLabelText('שיוך'), '')
    await user.click(card().getByRole('button', { name: 'שמירה' }))
    await waitFor(() => expect(lastUpsert(backend)?.patch).toEqual({ due_at: null, assignee_id: null }))
  })

  it('closes without queueing anything when nothing was changed', async () => {
    const { user, backend } = openCard('/tasks/a', [a])
    await findCard()
    await user.click(card().getByRole('button', { name: 'שמירה' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(backend.tasks.upserts).toHaveLength(0)
  })

  it('keeps an order number that has a "#" from the old app as it is, when it is not touched', async () => {
    const { user, backend } = openCard('/tasks/a', [task('a', { order_number: '#555' })])
    await findCard()
    expect(card().getByLabelText('מספר הזמנה')).toHaveValue('#555')
    await type(user, 'הערות', 'x')
    await user.click(card().getByRole('button', { name: 'שמירה' }))
    await waitFor(() => expect(lastUpsert(backend)?.patch).toEqual({ notes: 'x' }))
  })

  it('shows what somebody else changed meanwhile, in the fields that were not touched, and says who', async () => {
    const { user, backend } = openCard('/tasks/a', [a])
    await findCard()
    await user.clear(card().getByLabelText('הערות'))
    await user.type(card().getByLabelText('הערות'), 'הערה שלי')

    backend.tasks.events.push({ id: 99, task_id: 'a', actor_id: OWNER.id, type: 'updated', changes: {}, at: new Date().toISOString() })
    act(() => backend.tasks.pushRemote({ ...a, title: 'כותרת חדשה', notes: 'הערה שלהם', status_key: 'abroad', updated_at: ahead(HOUR) }))

    expect(await card().findByText('עודכן על ידי הבעלים')).toBeInTheDocument()
    expect(card().getByLabelText('כותרת')).toHaveValue('כותרת חדשה')
    expect(card().getByLabelText('סטטוס')).toHaveValue('abroad')
    expect(card().getByLabelText('הערות')).toHaveValue('הערה שלי')

    await user.click(card().getByRole('button', { name: 'שמירה' }))
    await waitFor(() => expect(lastUpsert(backend)?.patch).toEqual({ notes: 'הערה שלי' }))
  })

  it('does not say who made the last change when the card is only opened', async () => {
    openCard('/tasks/a', [a], {
      backend: (fake) => {
        fake.tasks.events.push({ id: 5, task_id: 'a', actor_id: OWNER.id, type: 'created', changes: {}, at: '2026-10-01T08:00:00.000Z' })
      },
    })
    await findCard()
    await act(async () => undefined)
    expect(card().queryByText(/^עודכן על ידי/)).not.toBeInTheDocument()
  })

  it('names the person who made the newest change, and not one who made an older change', async () => {
    const { backend } = openCard('/tasks/a', [a])
    await findCard()
    const at = new Date().toISOString()
    backend.tasks.events.push(
      { id: 90, task_id: 'a', actor_id: null, type: 'updated', changes: {}, at },
      { id: 91, task_id: 'a', actor_id: OWNER.id, type: 'updated', changes: {}, at },
    )
    act(() => backend.tasks.pushRemote({ ...a, notes: 'x', updated_at: ahead(HOUR) }))
    expect(await card().findByText('עודכן על ידי הבעלים')).toBeInTheDocument()
  })

  it('names the system when the change has no person behind it', async () => {
    const { backend } = openCard('/tasks/a', [a])
    await findCard()
    backend.tasks.events.push({ id: 99, task_id: 'a', actor_id: null, type: 'updated', changes: {}, at: new Date().toISOString() })
    act(() => backend.tasks.pushRemote({ ...a, notes: 'x', updated_at: ahead(HOUR) }))
    expect(await card().findByText('עודכן על ידי המערכת')).toBeInTheDocument()
  })

  it('says nothing about who when there is no line of history for the change', async () => {
    const { backend } = openCard('/tasks/a', [a])
    await findCard()
    act(() => backend.tasks.pushRemote({ ...a, notes: 'x', updated_at: ahead(HOUR) }))
    await waitFor(() => expect(card().getByLabelText('הערות')).toHaveValue('x'))
    await act(async () => undefined)
    expect(card().queryByText(/^עודכן על ידי/)).not.toBeInTheDocument()
  })

  it('does not say "updated by" about a change that the person made', async () => {
    const { backend } = openCard('/tasks/a', [a])
    await findCard()
    backend.tasks.events.push({ id: 99, task_id: 'a', actor_id: DANA.id, type: 'updated', changes: {}, at: new Date().toISOString() })
    act(() => backend.tasks.pushRemote({ ...a, title: 'כותרת חדשה', updated_at: ahead(HOUR) }))
    await waitFor(() => expect(card().getByLabelText('כותרת')).toHaveValue('כותרת חדשה'))
    expect(card().queryByText(/^עודכן על ידי/)).not.toBeInTheDocument()
  })

  it('names the person who changed it as "another user" when the directory does not know them', async () => {
    const { backend } = openCard('/tasks/a', [a])
    await findCard()
    backend.tasks.events.push({ id: 99, task_id: 'a', actor_id: 'u-stranger', type: 'updated', changes: {}, at: new Date().toISOString() })
    act(() => backend.tasks.pushRemote({ ...a, notes: 'x', updated_at: ahead(HOUR) }))
    expect(await card().findByText('עודכן על ידי משתמש אחר')).toBeInTheDocument()
  })

  it('still shows what somebody else changed when the history cannot be read, and says nothing about who', async () => {
    const { backend } = openCard('/tasks/a', [a])
    await findCard()
    backend.tasks.failNext(Object.assign(new TypeError('Failed to fetch'), { status: 0 }))
    act(() => backend.tasks.pushRemote({ ...a, notes: 'x', updated_at: ahead(HOUR) }))
    await waitFor(() => expect(card().getByLabelText('הערות')).toHaveValue('x'))
    expect(card().queryByText(/^עודכן על ידי/)).not.toBeInTheDocument()
  })
})

describe('done and delete', () => {
  const a = task('a')

  it('marks the task done, and closes', async () => {
    const { user, backend } = openCard('/tasks/a', [a])
    await findCard()
    await user.click(card().getByRole('button', { name: 'בוצע' }))
    await waitFor(() => expect(lastUpsert(backend)).toMatchObject({ id: 'a', patch: { done_at: expect.any(String) } }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('saves what was typed together with it', async () => {
    const { user, backend } = openCard('/tasks/a', [a])
    await findCard()
    await type(user, 'הערות', 'סיימתי')
    await user.click(card().getByRole('button', { name: 'בוצע' }))
    await waitFor(() => expect(lastUpsert(backend)?.patch).toMatchObject({ notes: 'סיימתי', done_at: expect.any(String) }))
  })

  it('does not mark it done when what was typed is not good enough to save', async () => {
    const { user, backend } = openCard('/tasks/a', [a])
    await findCard()
    await user.clear(card().getByLabelText('כותרת'))
    await user.clear(card().getByLabelText('שם לקוח'))
    await user.click(card().getByRole('button', { name: 'בוצע' }))
    expect(card().getByText(TASK_MESSAGES.title)).toBeInTheDocument()
    expect(backend.tasks.upserts).toHaveLength(0)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('marks a done task as not done', async () => {
    const { user, backend } = openCard('/tasks/a', [task('a', { done_at: new Date(Date.now() - HOUR).toISOString() })])
    await findCard()
    expect(card().queryByRole('button', { name: 'בוצע' })).not.toBeInTheDocument()
    await user.click(card().getByRole('button', { name: 'סימון כלא בוצע' }))
    await waitFor(() => expect(lastUpsert(backend)).toMatchObject({ id: 'a', patch: { done_at: null } }))
  })

  it('asks before it deletes, and does nothing when the answer is no', async () => {
    const { user, backend } = openCard('/tasks/a', [a])
    await findCard()
    await user.click(card().getByRole('button', { name: 'מחק משימה' }))
    expect(card().getByText('למחוק את המשימה?')).toBeInTheDocument()
    expect(backend.tasks.upserts).toHaveLength(0)
    await user.click(card().getByRole('button', { name: 'לא, להשאיר' }))
    expect(card().queryByText('למחוק את המשימה?')).not.toBeInTheDocument()
    expect(backend.tasks.upserts).toHaveLength(0)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('deletes it, softly, when the answer is yes, and closes', async () => {
    const { user, backend } = openCard('/tasks/a', [a])
    await findCard()
    await user.click(card().getByRole('button', { name: 'מחק משימה' }))
    await user.click(card().getByRole('button', { name: 'כן, למחוק' }))
    await waitFor(() => expect(lastUpsert(backend)).toMatchObject({ id: 'a', patch: { deleted_at: expect.any(String) } }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('link', { name: 'משימה a' })).not.toBeInTheDocument())
  })

  it('goes back to the card, and does not close it, when Escape is pressed at the question about deleting', async () => {
    const { user, backend } = openCard('/tasks/a', [a])
    await findCard()
    await user.click(card().getByRole('button', { name: 'מחק משימה' }))
    await user.keyboard('{Escape}')
    expect(card().queryByText('למחוק את המשימה?')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(backend.tasks.upserts).toHaveLength(0)
  })

  it('puts the focus on the safe answer when it asks about deleting', async () => {
    const { user } = openCard('/tasks/a', [a])
    await findCard()
    await user.click(card().getByRole('button', { name: 'מחק משימה' }))
    expect(card().getByRole('button', { name: 'לא, להשאיר' })).toHaveFocus()
  })

  it('gives the focus back to the delete button when the answer is no, so that it is not lost', async () => {
    const { user } = openCard('/tasks/a', [a])
    await findCard()
    await user.click(card().getByRole('button', { name: 'מחק משימה' }))
    await user.click(card().getByRole('button', { name: 'לא, להשאיר' }))
    expect(card().getByRole('button', { name: 'מחק משימה' })).toHaveFocus()
  })

  it('gives it back when the question is left with Escape too', async () => {
    const { user } = openCard('/tasks/a', [a])
    await findCard()
    await user.click(card().getByRole('button', { name: 'מחק משימה' }))
    await user.keyboard('{Escape}')
    expect(card().getByRole('button', { name: 'מחק משימה' })).toHaveFocus()
  })
})

describe('closing', () => {
  const a = task('a')

  it('closes at once with the close button when nothing was typed', async () => {
    const { user } = openCard('/tasks/a', [a])
    await findCard()
    await user.click(card().getByRole('button', { name: 'סגירה' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes with Escape when nothing was typed', async () => {
    const { user } = openCard('/tasks/a', [a])
    await findCard()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('asks before it throws away what was typed, and lets the person go on writing', async () => {
    const { user, backend } = openCard('/tasks/a', [a])
    await findCard()
    await type(user, 'הערות', 'חשוב')
    await user.keyboard('{Escape}')
    expect(card().getByText('יש שינויים שלא נשמרו.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(card().getByRole('button', { name: 'חזרה לעריכה' }))
    expect(card().queryByText('יש שינויים שלא נשמרו.')).not.toBeInTheDocument()
    expect(card().getByLabelText('הערות')).toHaveValue('חשוב')
    expect(backend.tasks.upserts).toHaveLength(0)
  })

  it('puts the focus back in the field the person was in when they go back to editing', async () => {
    const { user } = openCard('/tasks/a', [a])
    await findCard()
    await type(user, 'הערות', 'חשוב')
    await user.keyboard('{Escape}')
    await user.click(card().getByRole('button', { name: 'חזרה לעריכה' }))
    expect(card().getByLabelText('הערות')).toHaveFocus()
  })

  it('puts the focus back on the button that asked, when it was a button', async () => {
    const { user } = openCard('/tasks/a', [a])
    await findCard()
    await type(user, 'הערות', 'חשוב')
    await user.click(card().getByRole('button', { name: 'ביטול' }))
    await user.click(card().getByRole('button', { name: 'חזרה לעריכה' }))
    expect(card().getByRole('button', { name: 'ביטול' })).toHaveFocus()
  })

  it('puts the focus on the title when nothing in the card had it, as after a click on the dark area', async () => {
    const { user } = openCard('/tasks/a', [a])
    await findCard()
    await type(user, 'הערות', 'חשוב')
    await user.click(screen.getByRole('dialog').parentElement as HTMLElement)
    await user.click(card().getByRole('button', { name: 'חזרה לעריכה' }))
    expect(card().getByLabelText('כותרת')).toHaveFocus()
  })

  it('closes without saving when the person says so', async () => {
    const { user, backend } = openCard('/tasks/a', [a])
    await findCard()
    await type(user, 'הערות', 'חשוב')
    await user.click(card().getByRole('button', { name: 'ביטול' }))
    await user.click(card().getByRole('button', { name: 'סגירה בלי שמירה' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(backend.tasks.upserts).toHaveLength(0)
  })

  it('gives the focus back to the link that opened it', async () => {
    const { user } = openCard('/tasks', [a])
    await user.click(await screen.findByRole('link', { name: 'משימה a' }))
    await findCard()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('link', { name: 'משימה a' })).toHaveFocus()
  })
})

describe('leaving the card by the history', () => {
  const a = task('a')
  /** The card of a, opened from the list, so that there is a page to go back to, as when a person taps a task. */
  async function openFromList() {
    const app = openCard('/tasks', [a], { dataRouter: true })
    await app.user.click(await screen.findByRole('link', { name: 'משימה a' }))
    await findCard()
    return { ...app, router: app.router! }
  }
  const back = (router: { navigate(delta: number): Promise<void> }) => act(() => router.navigate(-1))
  /** Whether the router still holds a navigation back, which it does until it is told to let it go or to leave it. */
  const holdsBack = (router: { state: { blockers: Map<string, { state: string }> } }) => [...router.state.blockers.values()].some((blocker) => blocker.state !== 'unblocked')

  it('goes back at once when nothing was typed', async () => {
    const { router } = await openFromList()
    await back(router)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/tasks')
  })

  it('asks before it throws away what was typed, stays on the card, and keeps the text', async () => {
    const { user, router } = await openFromList()
    await type(user, 'הערות', 'חשוב')
    await back(router)
    expect(router.state.location.pathname).toBe('/tasks/a')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(card().getByText('יש שינויים שלא נשמרו.')).toBeInTheDocument()
    expect(card().getByLabelText('הערות')).toHaveValue('חשוב')
  })

  it('puts the focus on the safe answer, as the other questions of the card do', async () => {
    const { user, router } = await openFromList()
    await type(user, 'הערות', 'חשוב')
    await back(router)
    expect(card().getByRole('button', { name: 'חזרה לעריכה' })).toHaveFocus()
  })

  it('goes back, without saving, when the person says that the changes may go', async () => {
    const { user, router, backend } = await openFromList()
    await type(user, 'הערות', 'חשוב')
    await back(router)
    await user.click(card().getByRole('button', { name: 'סגירה בלי שמירה' }))
    // The Back that was held is made again once the router has put the address back, which takes a few ticks.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(router.state.location.pathname).toBe('/tasks')
    expect(backend.tasks.upserts).toHaveLength(0)
  })

  it('stays, with the text, when the person goes on writing, and asks again at the next Back', async () => {
    const { user, router } = await openFromList()
    await type(user, 'הערות', 'חשוב')
    await back(router)
    expect(holdsBack(router)).toBe(true)
    await user.click(card().getByRole('button', { name: 'חזרה לעריכה' }))
    expect(card().queryByText('יש שינויים שלא נשמרו.')).not.toBeInTheDocument()
    expect(card().getByLabelText('הערות')).toHaveValue('חשוב')
    expect(router.state.location.pathname).toBe('/tasks/a')
    expect(holdsBack(router)).toBe(false)

    await back(router)
    expect(card().getByText('יש שינויים שלא נשמרו.')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/tasks/a')
  })

  it('goes on writing when Escape answers the question, and the Back that was held is let go of', async () => {
    const { user, router } = await openFromList()
    await type(user, 'הערות', 'חשוב')
    await back(router)
    await user.keyboard('{Escape}')
    expect(card().queryByText('יש שינויים שלא נשמרו.')).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/tasks/a')
    expect(holdsBack(router)).toBe(false)
    // Nothing is held any more: the question is asked afresh by the next way out.
    await user.keyboard('{Escape}')
    expect(card().getByText('יש שינויים שלא נשמרו.')).toBeInTheDocument()
  })

  // The card has changes in it, and leaves by its own doing: that is not a way out for the guard to hold back.
  it.each([
    ['saving', async (user: Awaited<ReturnType<typeof openFromList>>['user']) => user.click(card().getByRole('button', { name: 'שמירה' }))],
    ['done', async (user: Awaited<ReturnType<typeof openFromList>>['user']) => user.click(card().getByRole('button', { name: 'בוצע' }))],
    [
      'deleting',
      async (user: Awaited<ReturnType<typeof openFromList>>['user']) => {
        await user.click(card().getByRole('button', { name: 'מחק משימה' }))
        await user.click(card().getByRole('button', { name: 'כן, למחוק' }))
      },
    ],
  ])('does not hold back the card that leaves by itself: %s', async (_how, leaveBy) => {
    const { user, router } = await openFromList()
    await type(user, 'הערות', 'חשוב')
    await leaveBy(user)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/tasks')
  })

  it('does not hold back the sign-out: a person who is signed out is not asked about a card', async () => {
    const { user, router, store } = await openFromList()
    await type(user, 'הערות', 'חשוב')
    await act(() => store.getState().signOut())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('does not hold back the way out of the card that the person closed after the question', async () => {
    const { user, router } = await openFromList()
    await type(user, 'הערות', 'חשוב')
    await user.keyboard('{Escape}')
    await user.click(card().getByRole('button', { name: 'סגירה בלי שמירה' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/tasks')
  })
})

describe('leaving the page while the card has changes in it', () => {
  const a = task('a')
  const leave = () => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event
  }

  it('asks the browser to ask first, while there is something typed, and only then', async () => {
    const { user } = openCard('/tasks/a', [a])
    await findCard()
    expect(leave().defaultPrevented).toBe(false)
    await type(user, 'הערות', 'חשוב')
    expect(leave().defaultPrevented).toBe(true)
    await user.clear(card().getByLabelText('הערות'))
    expect(leave().defaultPrevented).toBe(false)
  })

  it('does not ask once the card is closed', async () => {
    const { user } = openCard('/tasks/a', [a])
    await findCard()
    await type(user, 'הערות', 'חשוב')
    await user.click(card().getByRole('button', { name: 'שמירה' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(leave().defaultPrevented).toBe(false)
  })

  it('does not ask in the Windows app: there the window could not be closed, or the app left, with a card open', async () => {
    window.mokedDesktop = { showWindow: () => undefined }
    try {
      const { user } = openCard('/tasks/a', [a])
      await findCard()
      await type(user, 'הערות', 'חשוב')
      expect(leave().defaultPrevented).toBe(false)
    } finally {
      delete window.mokedDesktop
    }
  })
})

describe('opening again', () => {
  it('opens the same card again after it was closed, which means that the page went back to the list', async () => {
    const { user } = openCard('/tasks', [task('a')])
    await user.click(await screen.findByRole('link', { name: 'משימה a' }))
    await findCard()
    await user.click(card().getByRole('button', { name: 'סגירה' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'משימה a' }))
    expect(await screen.findByRole('dialog', { name: 'משימה a' })).toBeInTheDocument()
  })
})

describe('what is not there', () => {
  it('says so for a task that is not in the list', async () => {
    const { user } = openCard('/tasks/nope', [task('a')])
    expect(await screen.findByText('המשימה לא נמצאה ברשימה.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'סגירה' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('says that the tasks are loading, until they are', async () => {
    let release: () => void = () => undefined
    openCard('/tasks/a', [task('a')], {
      backend: (fake) => {
        const load = fake.tasks.gateway.loadInitial
        fake.tasks.gateway.loadInitial = (now) => new Promise((resolve) => (release = () => resolve(load(now))))
      },
    })
    expect(await screen.findByText('טוען את המשימה…')).toBeInTheDocument()
    await act(async () => release())
    expect(await screen.findByLabelText('כותרת')).toHaveValue('משימה a')
  })

  it('says so when the task is deleted by somebody else while it is open', async () => {
    const { backend } = openCard('/tasks/a', [task('a')])
    await findCard()
    act(() => backend.tasks.pushRemote({ ...task('a'), deleted_at: ahead(-HOUR), updated_at: ahead(HOUR) }))
    expect(await screen.findByText('המשימה נמחקה.')).toBeInTheDocument()
    expect(screen.queryByLabelText('כותרת')).not.toBeInTheDocument()
  })
})

describe('the parts of the card', () => {
  it('shows the fields of a delivery for a delivery, those of a pickup for a pickup, and none for the rest', async () => {
    const { user } = openCard('/tasks/new')
    await findCard()
    expect(card().queryByLabelText('מספר Cargo')).not.toBeInTheDocument()
    expect(card().queryByLabelText('שם מוצר')).not.toBeInTheDocument()
    await user.selectOptions(card().getByLabelText('סוג'), 'delivery')
    expect(card().getByLabelText('מספר Cargo')).toBeInTheDocument()
    expect(card().getByLabelText('נשלח ל-CARGO')).toBeInTheDocument()
    expect(card().queryByLabelText('שם מוצר')).not.toBeInTheDocument()
    await user.selectOptions(card().getByLabelText('סוג'), 'pickup')
    expect(card().getByLabelText('שם מוצר')).toBeInTheDocument()
    expect(card().getByLabelText('מק״ט')).toBeInTheDocument()
    expect(card().queryByLabelText('מספר Cargo')).not.toBeInTheDocument()
  })

  it('keeps the details of the order folded until they are asked for', async () => {
    const { user } = openCard('/tasks/new')
    await findCard()
    const details = card().getByText('פרטי הזמנה').closest('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    await user.click(card().getByText('פרטי הזמנה'))
    expect(details.open).toBe(true)
    expect(card().getByLabelText('שיטת משלוח')).toBeInTheDocument()
    expect(card().getByLabelText('סטטוס משלוח')).toBeInTheDocument()
    expect(card().getByLabelText('תאריך הזמנה')).toBeInTheDocument()
    expect(card().getByLabelText('חיוב')).toBeInTheDocument()
    expect(card().getByLabelText('כתובת למשלוח')).toBeInTheDocument()
  })

  it('sends the details of the order that were filled in', async () => {
    const { user, backend } = openCard('/tasks/a', [task('a')])
    await findCard()
    await user.click(card().getByText('פרטי הזמנה'))
    await user.selectOptions(card().getByLabelText('שיטת משלוח'), 'CARGO')
    await type(user, 'כתובת למשלוח', 'הרצל 1, חיפה')
    await user.click(card().getByRole('button', { name: 'שמירה' }))
    await waitFor(() => expect(lastUpsert(backend)?.patch).toEqual({ ship_method: 'CARGO', ship_to: 'הרצל 1, חיפה' }))
  })

  it('lists the people who are active, and keeps a person who is not, if the task is theirs', async () => {
    openCard('/tasks/a', [task('a', { assignee_id: 'u-old' })], {
      backend: (fake) => {
        fake.directory.profiles = [OWNER, DANA, { ...OWNER, id: 'u-old', display_name: 'ישן', is_active: false }, { ...OWNER, id: 'u-gone', display_name: 'עזב', is_active: false }]
      },
    })
    await findCard()
    const options = within(card().getByLabelText('שיוך')).getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual(['ללא שיוך', 'הבעלים', 'דנה', 'ישן (לא פעיל)'])
    expect(card().getByLabelText('שיוך')).toHaveValue('u-old')
  })

  it('lists the statuses that are in use, and keeps the status of the task, if it is not in use or not known', async () => {
    openCard('/tasks/a', [task('a', { status_key: 'old-status' })], {
      backend: (fake) => {
        fake.directory.statuses = [...fake.directory.statuses, { key: 'retired', name_he: 'הוסר', color: '#000000', sort: 30, is_active: false }]
      },
    })
    await findCard()
    const options = within(card().getByLabelText('סטטוס')).getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual(['בטיפול', 'הושלמו', 'Send to CARGO', 'הזמנת חו"ל', 'old-status'])
    expect(card().getByLabelText('סטטוס')).toHaveValue('old-status')
  })

  it('keeps a person who is not known to the directory at all, and says so', async () => {
    openCard('/tasks/a', [task('a', { assignee_id: 'u-unknown' })])
    await findCard()
    expect(card().getByLabelText('שיוך')).toHaveValue('u-unknown')
    expect(within(card().getByLabelText('שיוך')).getByRole('option', { name: 'משתמש לא ידוע' })).toBeInTheDocument()
  })

  it('keeps the status of the task when that status is no longer in use', async () => {
    openCard('/tasks/a', [task('a', { status_key: 'retired' })], {
      backend: (fake) => {
        fake.directory.statuses = [...fake.directory.statuses, { key: 'retired', name_he: 'הוסר', color: '#000000', sort: 30, is_active: false }]
      },
    })
    await findCard()
    expect(card().getByLabelText('סטטוס')).toHaveValue('retired')
    expect(within(card().getByLabelText('סטטוס')).getByRole('option', { name: 'הוסר' })).toBeInTheDocument()
  })

  it('puts a duration that the list does not have where it belongs in the order', async () => {
    openCard('/tasks/a', [task('a', { duration_min: 37 })])
    await findCard()
    const options = within(card().getByLabelText('משך')).getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual(['15 דקות', '30 דקות', '37 דקות', '45 דקות', '60 דקות', '90 דקות', '120 דקות', '180 דקות', '240 דקות'])
  })

  it('keeps a shipping method that the settings do not have, when the task has it', async () => {
    openCard('/tasks/a', [task('a', { ship_method: 'שליח ישן' })])
    await findCard()
    expect(card().getByLabelText('שיטת משלוח')).toHaveValue('שליח ישן')
    expect(within(card().getByLabelText('שיטת משלוח')).getByRole('option', { name: 'שליח ישן' })).toBeInTheDocument()
  })

  it('keeps a duration and a reminder that the lists do not have', async () => {
    openCard('/tasks/a', [task('a', { duration_min: 37, remind_min: 7 })])
    await findCard()
    expect(card().getByLabelText('משך')).toHaveValue('37')
    expect(card().getByLabelText('תזכורת')).toHaveValue('7')
    expect(within(card().getByLabelText('משך')).getByRole('option', { name: '37 דקות' })).toBeInTheDocument()
    expect(within(card().getByLabelText('תזכורת')).getByRole('option', { name: '7 דקות לפני' })).toBeInTheDocument()
  })
})

describe('Glassix', () => {
  it('has a button that opens the conversation, with the id encoded in the address', async () => {
    openCard('/tasks/a', [task('a', { glassix_conversation_id: 'a b/c', no_glassix: false })])
    await findCard()
    const link = card().getByRole('link', { name: 'פתח שיחה' })
    expect(link).toHaveAttribute('href', 'https://glassix.example/conversations/a%20b%2Fc')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('follows the id as it is typed', async () => {
    const { user } = openCard('/tasks/new')
    await findCard()
    expect(card().queryByRole('link', { name: 'פתח שיחה' })).not.toBeInTheDocument()
    await type(user, 'מזהה שיחת Glassix', 'gx-5')
    expect(card().getByRole('link', { name: 'פתח שיחה' })).toHaveAttribute('href', 'https://glassix.example/conversations/gx-5')
  })

  it.each(['', 'javascript:alert({id})', 'http://insecure.example/{id}', 'https://no-id.example/'])(
    'has no button when the address of conversations in the settings is %j',
    async (template) => {
      openCard('/tasks/a', [task('a', { glassix_conversation_id: 'gx-1', no_glassix: false })], {
        backend: (fake) => {
          fake.directory.settings = { ...fake.directory.settings, glassix_url_template: template }
        },
      })
      await findCard()
      expect(card().getByLabelText('מזהה שיחת Glassix')).toHaveValue('gx-1')
      expect(card().queryByRole('link', { name: 'פתח שיחה' })).not.toBeInTheDocument()
    },
  )
})

describe('copying', () => {
  it('copies the phone, the order, the Glassix id and the Cargo number as they stand in the fields', async () => {
    const { user } = openCard('/tasks/a', [
      task('a', { kind: 'delivery', customer_phone: '050-123-4567', order_number: '10442', glassix_conversation_id: 'gx-77', cargo_number: 'CG-9', no_glassix: false }),
    ])
    await findCard()
    const writeText = stubClipboard()
    await user.click(card().getByRole('button', { name: 'העתקת טלפון: 050-123-4567' }))
    await user.click(card().getByRole('button', { name: 'העתקת מספר הזמנה: 10442' }))
    await user.click(card().getByRole('button', { name: 'העתקת מזהה Glassix: gx-77' }))
    await user.click(card().getByRole('button', { name: 'העתקת מספר Cargo: CG-9' }))
    expect(writeText.mock.calls.map((call) => call[0])).toEqual(['050-123-4567', '10442', 'gx-77', 'CG-9'])
  })

  it('copies a value without the spaces that surround it', async () => {
    const { user } = openCard('/tasks/a', [task('a', { order_number: ' 10442 ' })])
    await findCard()
    const writeText = stubClipboard()
    await user.click(card().getByRole('button', { name: 'העתקת מספר הזמנה: 10442' }))
    expect(writeText).toHaveBeenCalledWith('10442')
  })

  it('has a link that dials the phone, as it stands in the field', async () => {
    const { user } = openCard('/tasks/a', [task('a', { customer_phone: '050-123-4567' })])
    await findCard()
    expect(card().getByRole('link', { name: 'חיוג אל 050-123-4567' })).toHaveAttribute('href', 'tel:0501234567')
    await user.clear(card().getByLabelText('טלפון'))
    expect(card().queryByRole('link', { name: /חיוג/ })).not.toBeInTheDocument()
  })

  it('has no button to copy a field that is empty', async () => {
    openCard('/tasks/new')
    await findCard()
    expect(card().queryByRole('button', { name: /^העתקת/ })).not.toBeInTheDocument()
  })
})

describe('for people who cannot see or use a mouse', () => {
  it('gives every field a name, and every message the role of an alert', async () => {
    const { user } = openCard('/tasks/new')
    await findCard()
    await user.selectOptions(card().getByLabelText('סוג'), 'pickup')
    await user.click(card().getByText('פרטי הזמנה'))
    const fields = within(screen.getByRole('dialog')).getAllByRole('textbox')
    const everyField = [...fields, ...card().getAllByRole('combobox'), ...card().getAllByRole('checkbox')]
    expect(everyField.length).toBeGreaterThan(15)
    for (const field of everyField) expect(field, field.outerHTML).toHaveAccessibleName()
    expect(card().getByLabelText('תאריך')).toHaveAccessibleName('תאריך')
    expect(card().getByLabelText('שעה')).toHaveAccessibleName('שעה')

    await user.click(card().getByRole('button', { name: 'שמירה' }))
    const messages = Object.values(TASK_MESSAGES).filter((text) => card().queryByText(text))
    expect(messages.length).toBeGreaterThanOrEqual(3)
    for (const text of messages) expect(card().getByText(text)).toHaveAttribute('role', 'alert')
  })

  it('is a form that is sent by the program, not by the browser', async () => {
    openCard('/tasks/new')
    await findCard()
    const form = screen.getByRole('dialog').querySelector('form') as HTMLFormElement
    const submit = new Event('submit', { bubbles: true, cancelable: true })
    form.dispatchEvent(submit)
    expect(submit.defaultPrevented).toBe(true)
  })

  it('links each message to its field, so that it is read with it', async () => {
    const { user } = openCard('/tasks/new')
    await findCard()
    await user.click(card().getByRole('button', { name: 'שמירה' }))
    expect(card().getByLabelText('כותרת')).toHaveAccessibleDescription(TASK_MESSAGES.title)
    expect(card().getByLabelText('מזהה שיחת Glassix')).toHaveAccessibleDescription(TASK_MESSAGES.glassix)
  })

  it('has a close button with a name, and a heading for each part', async () => {
    openCard('/tasks/new')
    await findCard()
    expect(card().getByRole('button', { name: 'סגירה' })).toBeInTheDocument()
    for (const name of ['המשימה', 'לקוח והתקשרות']) expect(card().getByRole('heading', { level: 3, name })).toBeInTheDocument()
  })
})
