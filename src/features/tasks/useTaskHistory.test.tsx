import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { networkError } from '../../test/fakeTasksGateways'
import type { TaskEvent } from './gateways'
import { SYNC_MESSAGES } from './errors'
import { TasksContext, type TasksContextValue } from './tasksContext'
import { useTaskHistory } from './useTaskHistory'

const created = (id: number): TaskEvent => ({ id, task_id: 'a', actor_id: null, type: 'created', changes: {}, at: '2026-10-12T07:03:00.000Z' })

/** A history that is read through a function that the test controls. */
function setup(read: (taskId: string) => Promise<TaskEvent[]>) {
  const history = vi.fn(read)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TasksContext value={{ tasks: {}, directory: {}, attachments: {}, history } as unknown as TasksContextValue}>{children}</TasksContext>
  )
  return { history, wrapper }
}

describe('useTaskHistory', () => {
  it('has no history for a task that is not saved, and reads none', async () => {
    const { history, wrapper } = setup(async () => [created(1)])
    const { result } = renderHook(() => useTaskHistory(null, 'v1'), { wrapper })
    await act(async () => undefined)
    expect(result.current).toMatchObject({ events: null, failure: null })
    expect(history).not.toHaveBeenCalled()
  })

  it('reads the history of the task and gives it as the server did', async () => {
    const { history, wrapper } = setup(async () => [created(2), created(1)])
    const { result } = renderHook(() => useTaskHistory('a', 'v1'), { wrapper })
    expect(result.current).toMatchObject({ events: null, failure: null })
    await waitFor(() => expect(result.current.events).toEqual([created(2), created(1)]))
    expect(history).toHaveBeenCalledWith('a')
    expect(history).toHaveBeenCalledTimes(1)
  })

  it('says why the first reading failed, and reads again on request', async () => {
    let fail = true
    const { history, wrapper } = setup(async () => {
      if (fail) throw networkError()
      return [created(1)]
    })
    const { result } = renderHook(() => useTaskHistory('a', 'v1'), { wrapper })
    await waitFor(() => expect(result.current.failure).toBe(SYNC_MESSAGES.unreachable))
    expect(result.current.events).toBeNull()

    fail = false
    act(() => result.current.retry())
    // While it is read again there is nothing to say about the failure.
    expect(result.current.failure).toBeNull()
    await waitFor(() => expect(result.current.events).toEqual([created(1)]))
    expect(result.current.failure).toBeNull()
    expect(history).toHaveBeenCalledTimes(2)
  })

  it('reads again when the version changes, keeps the list while it does, and does not read again for the same version', async () => {
    const answers = [[created(1)], [created(2), created(1)]]
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { history, wrapper } = setup(async () => {
      const next = answers.shift()!
      if (answers.length === 0) await gate
      return next
    })
    const { result, rerender } = renderHook(({ version }) => useTaskHistory('a', version), { wrapper, initialProps: { version: 'v1' } })
    await waitFor(() => expect(result.current.events).toEqual([created(1)]))

    rerender({ version: 'v1' })
    expect(history).toHaveBeenCalledTimes(1)

    rerender({ version: 'v2' })
    await waitFor(() => expect(history).toHaveBeenCalledTimes(2))
    expect(result.current.events).toEqual([created(1)])
    await act(async () => release())
    await waitFor(() => expect(result.current.events).toEqual([created(2), created(1)]))
  })

  it('keeps the list that it has when a new reading fails, and says nothing about the failure', async () => {
    let fail = false
    const { history, wrapper } = setup(async () => {
      if (fail) throw networkError()
      return [created(1)]
    })
    const { result, rerender } = renderHook(({ version }) => useTaskHistory('a', version), { wrapper, initialProps: { version: 'v1' } })
    await waitFor(() => expect(result.current.events).toEqual([created(1)]))

    fail = true
    rerender({ version: 'v2' })
    await waitFor(() => expect(history).toHaveBeenCalledTimes(2))
    await act(async () => undefined)
    expect(result.current.events).toEqual([created(1)])
    expect(result.current.failure).toBeNull()
  })

  it('forgets the list when it is asked for no task any more', async () => {
    const { wrapper } = setup(async () => [created(1)])
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useTaskHistory(id, 'v1'), { wrapper, initialProps: { id: 'a' as string | null } })
    await waitFor(() => expect(result.current.events).toEqual([created(1)]))
    rerender({ id: null })
    expect(result.current.events).toBeNull()
  })

  it('does not take the answer of a reading that is no longer the latest', async () => {
    const waiting = new Map<string, (events: TaskEvent[]) => void>()
    const { wrapper } = setup((taskId) => new Promise((resolve) => waiting.set(taskId + waiting.size, resolve)))
    const { result, rerender } = renderHook(({ version }) => useTaskHistory('a', version), { wrapper, initialProps: { version: 'v1' } })
    rerender({ version: 'v2' })
    await waitFor(() => expect(waiting.size).toBe(2))

    await act(async () => waiting.get('a1')!([created(2)]))
    await act(async () => waiting.get('a0')!([created(1)]))
    expect(result.current.events).toEqual([created(2)])
  })
})
