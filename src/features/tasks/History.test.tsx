import { act, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { card, findCard, openCard, task } from '../../test/cardHarness'
import type { FakeBackend } from '../../test/fakeBackend'
import { DANA, OWNER } from '../../test/fakeGateway'
import { networkError } from '../../test/fakeTasksGateways'
import { pictureFile, stubImageApis } from '../../test/images'
import { formatDue } from './display'
import { SYNC_MESSAGES } from './errors'
import type { TaskEvent, TaskEventType } from './gateways'

let counter = 0

/** An event of the task "a", a minute ago, made by Dana. */
function event(type: TaskEventType, changes: Record<string, [unknown, unknown]> = {}, patch: Partial<TaskEvent> = {}): TaskEvent {
  return { id: ++counter, task_id: 'a', actor_id: DANA.id, type, changes, at: new Date(Date.now() - 60_000).toISOString(), ...patch }
}

function openWith(events: TaskEvent[], options: { backend?: (fake: FakeBackend) => void } = {}) {
  return openCard('/tasks/a', [task('a')], {
    backend: (fake) => {
      fake.tasks.events.push(...events)
      options.backend?.(fake)
    },
  })
}

const region = () => card().getByRole('region', { name: 'היסטוריה' })
const list = () => within(region()).getByRole('list', { name: 'היסטוריית המשימה' })

/** Each entry of the history as it is shown: who, when, and the lines. */
function shown() {
  return [...list().children].map((item) => ({
    who: item.querySelector('.history-who')?.textContent,
    when: item.querySelector('time')?.textContent,
    at: item.querySelector('time')?.getAttribute('datetime'),
    lines: [...item.querySelectorAll('.history-line')].map((line) => line.textContent),
  }))
}

async function loaded() {
  await findCard()
  await waitFor(() => expect(within(region()).queryByText('טוען היסטוריה…')).not.toBeInTheDocument())
}

describe('the history part of the card', () => {
  it('is not there for a new task, which has no history yet, and the server is not asked for one', async () => {
    const load = vi.fn()
    openCard('/tasks/new', [], {
      backend: (fake) => {
        fake.backend.tasks.loadHistory = load
      },
    })
    await findCard()
    await act(async () => undefined)
    expect(card().queryByRole('region', { name: 'היסטוריה' })).not.toBeInTheDocument()
    expect(load).not.toHaveBeenCalled()
  })

  it('says that it is loading, and then shows the history', async () => {
    let answer!: (events: TaskEvent[]) => void
    const pending = new Promise<TaskEvent[]>((resolve) => {
      answer = resolve
    })
    openWith([], {
      backend: (fake) => {
        vi.spyOn(fake.backend.tasks, 'loadHistory').mockReturnValueOnce(pending)
      },
    })
    await findCard()
    expect(within(region()).getByText('טוען היסטוריה…')).toBeInTheDocument()

    answer([event('created')])
    expect(await within(region()).findByText('המשימה נוצרה')).toBeInTheDocument()
    expect(within(region()).queryByText('טוען היסטוריה…')).not.toBeInTheDocument()
  })

  it('says that there is no history yet', async () => {
    openWith([])
    await loaded()
    expect(within(region()).getByText('אין היסטוריה עדיין.')).toBeInTheDocument()
    expect(within(region()).queryByRole('list')).not.toBeInTheDocument()
  })

  it('shows who did what and when, newest first', async () => {
    const created = event('created', {}, { actor_id: OWNER.id, at: new Date(Date.now() - 3 * 86_400_000).toISOString() })
    const status = event('status', { status_key: ['processing', 'completed'] }, { at: new Date(Date.now() - 2 * 3_600_000).toISOString() })
    const done = event('done', { done_at: [null, new Date().toISOString()] })
    openWith([created, status, done])
    await loaded()

    const entries = shown()
    expect(entries.map((entry) => [entry.who, entry.lines])).toEqual([
      ['דנה', ['המשימה סומנה כבוצעה']],
      ['דנה', ['סטטוס: מ-בטיפול ל-הושלמו']],
      ['הבעלים', ['המשימה נוצרה']],
    ])
    for (const entry of entries) expect(entry.when).toBe(formatDue(entry.at!, new Date()))
    expect(entries.map((entry) => entry.at)).toEqual([done.at, status.at, created.at])
  })

  it('puts the newest first even when the server sends them in another order', async () => {
    const older = event('created', {}, { id: 3 })
    const newer = event('done', {}, { id: 9 })
    const middle = event('updated', { notes: ['', 'x'] }, { id: 5 })
    openWith([], {
      backend: (fake) => {
        vi.spyOn(fake.backend.tasks, 'loadHistory').mockResolvedValue([older, newer, middle])
      },
    })
    await loaded()
    expect(shown().map((entry) => entry.lines[0])).toEqual(['המשימה סומנה כבוצעה', 'הערות: נקבע ל-x', 'המשימה נוצרה'])
  })

  it('names the system for a change that nobody made, and another user for somebody who is not known', async () => {
    openWith([event('updated', { notes: ['', 'a'] }, { id: 21, actor_id: null }), event('updated', { notes: ['', 'b'] }, { id: 20, actor_id: 'u-nobody' })])
    await loaded()
    expect(shown().map((entry) => entry.who)).toEqual(['המערכת', 'משתמש אחר'])
  })

  it('shows a line for each field that an update changed, with the names of the fields in Hebrew', async () => {
    openWith([event('updated', { notes: ['', 'חשוב'], title: ['לחזור', 'לחזור מחר'], no_glassix: [false, true] })])
    await loaded()
    expect(shown()[0].lines).toEqual(['כותרת: מ-לחזור ל-לחזור מחר', 'הערות: נקבע ל-חשוב', 'אין שיחה ב-Glassix: מ-לא ל-כן'])
  })

  it('names the people of an assignment and shortens a long text', async () => {
    const long = `${'מילה '.repeat(30)}סוף`
    openWith([event('assigned', { assignee_id: [DANA.id, OWNER.id] }, { id: 31 }), event('updated', { notes: [long, ''] }, { id: 30 })])
    await loaded()
    const [assigned, notes] = shown()
    expect(assigned.lines).toEqual(['שיוך: מ-דנה ל-הבעלים'])
    expect(notes.lines[0]).toMatch(/^הערות: הוסר \(היה מילה מילה .*…\)$/)
    expect(notes.lines[0].length).toBeLessThan(90)
  })

  it('says why the history could not be loaded, and loads it again when asked', async () => {
    const { user } = openWith([event('created')], {
      backend: (fake) => {
        vi.spyOn(fake.backend.tasks, 'loadHistory').mockRejectedValueOnce(networkError())
      },
    })
    await findCard()
    expect(await within(region()).findByText(SYNC_MESSAGES.unreachable)).toHaveAttribute('role', 'alert')
    expect(within(region()).queryByRole('list')).not.toBeInTheDocument()

    await user.click(within(region()).getByRole('button', { name: 'נסו שוב' }))
    expect(await within(region()).findByText('המשימה נוצרה')).toBeInTheDocument()
    expect(within(region()).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says that it is loading while it tries again', async () => {
    let answer!: (events: TaskEvent[]) => void
    const pending = new Promise<TaskEvent[]>((resolve) => {
      answer = resolve
    })
    const { user, backend } = openWith([event('created')], {
      backend: (fake) => {
        vi.spyOn(fake.backend.tasks, 'loadHistory').mockRejectedValueOnce(networkError())
      },
    })
    await findCard()
    await within(region()).findByRole('alert')
    vi.spyOn(backend.backend.tasks, 'loadHistory').mockReturnValueOnce(pending)
    await user.click(within(region()).getByRole('button', { name: 'נסו שוב' }))
    expect(within(region()).getByText('טוען היסטוריה…')).toBeInTheDocument()
    expect(within(region()).queryByRole('alert')).not.toBeInTheDocument()
    answer([event('created')])
    expect(await within(region()).findByText('המשימה נוצרה')).toBeInTheDocument()
  })

  describe('while the card is open', () => {
    it('reads the history again when somebody else changes the task, and keeps showing the list while it does', async () => {
      const { backend } = openWith([event('created', {}, { id: 40 })])
      await loaded()
      expect(shown()).toHaveLength(1)

      let answer!: (events: TaskEvent[]) => void
      const pending = new Promise<TaskEvent[]>((resolve) => {
        answer = resolve
      })
      vi.spyOn(backend.backend.tasks, 'loadHistory').mockReturnValueOnce(pending)
      const row = { ...backend.tasks.rows.get('a')!, notes: 'שונה', updated_at: new Date().toISOString() }
      act(() => backend.tasks.pushRemote(row))
      await waitFor(() => expect(backend.backend.tasks.loadHistory).toHaveBeenCalledTimes(1))
      expect(within(region()).queryByText('טוען היסטוריה…')).not.toBeInTheDocument()
      expect(shown()).toHaveLength(1)

      answer([event('updated', { notes: ['', 'שונה'] }, { id: 41, actor_id: OWNER.id }), event('created', {}, { id: 40 })])
      await waitFor(() => expect(shown()).toHaveLength(2))
      expect(shown()[0]).toMatchObject({ who: 'הבעלים', lines: ['הערות: נקבע ל-שונה'] })
    })

    it('keeps the list it has when reading it again fails, without a word', async () => {
      const { backend } = openWith([event('created', {}, { id: 50 })])
      await loaded()
      vi.spyOn(backend.backend.tasks, 'loadHistory').mockRejectedValueOnce(networkError())
      act(() => backend.tasks.pushRemote({ ...backend.tasks.rows.get('a')!, notes: 'שונה', updated_at: new Date().toISOString() }))
      await waitFor(() => expect(backend.backend.tasks.loadHistory).toHaveBeenCalledTimes(1))
      await act(async () => undefined)
      expect(shown()).toHaveLength(1)
      expect(within(region()).queryByRole('alert')).not.toBeInTheDocument()
    })

    it('does not read it again for a change that is only in the fields that the person is typing', async () => {
      const { user, backend } = openWith([event('created')])
      await loaded()
      await user.type(card().getByLabelText('הערות'), 'abc')
      await act(async () => undefined)
      expect(backend.tasks.calls.loadHistory).toBe(1)
    })

    it('reads it again after a picture is added, which the server writes on the history', async () => {
      const images = stubImageApis()
      const { user, backend } = openWith([event('created')])
      await loaded()
      await user.upload(card().getByLabelText('מהגלריה'), pictureFile(images))
      await waitFor(() => expect(backend.tasks.calls.loadHistory).toBe(2))
      await waitFor(() => expect(screen.getByText('נוספה תמונה')).toBeInTheDocument())
      expect(shown()[0]).toMatchObject({ who: 'דנה', lines: ['נוספה תמונה'] })
    })
  })
})
