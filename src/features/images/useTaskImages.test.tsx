import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { pictureFile, stubImageApis } from '../../test/images'
import type { Attachment, AttachmentsGateway } from '../tasks/gateways'
import { TasksContext, type TasksContextValue } from '../tasks/tasksContext'
import { useTaskImages } from './useTaskImages'

function gateway(list: Attachment[] = []) {
  const source = {
    list: vi.fn(async () => list),
    add: vi.fn(),
    remove: vi.fn(),
    signedUrl: vi.fn(),
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TasksContext value={{ tasks: {}, directory: {}, attachments: source as unknown as AttachmentsGateway, history: async () => [] } as unknown as TasksContextValue}>
      {children}
    </TasksContext>
  )
  return { source, wrapper }
}

describe('useTaskImages', () => {
  it('has no pictures for a task that is not saved, asks for none, and adds none', async () => {
    const images = stubImageApis()
    const { source, wrapper } = gateway()
    const { result } = renderHook(() => useTaskImages(null), { wrapper })

    act(() => result.current.add([pictureFile(images)], 'image'))
    await act(async () => undefined)

    expect(result.current).toMatchObject({ items: null, loadFailure: null, uploading: 0, problems: [] })
    expect(source.list).not.toHaveBeenCalled()
    expect(source.add).not.toHaveBeenCalled()
    expect(images.decode).not.toHaveBeenCalled()
  })

  it('loads the pictures of a saved task', async () => {
    const { source, wrapper } = gateway([])
    const { result } = renderHook(() => useTaskImages('a'), { wrapper })
    expect(result.current.items).toBeNull()
    await waitFor(() => expect(result.current.items).toEqual([]))
    expect(source.list).toHaveBeenCalledWith('a')
  })
})
