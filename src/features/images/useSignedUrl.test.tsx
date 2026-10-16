import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AttachmentsGateway } from '../tasks/gateways'
import { TasksContext, type TasksContextValue } from '../tasks/tasksContext'
import { useSignedUrl } from './useSignedUrl'

/** A gateway whose answers are given by hand. */
function gateway() {
  const waiting = new Map<string, { resolve(url: string): void; reject(error: unknown): void }>()
  const signedUrl = vi.fn(
    (path: string) =>
      new Promise<string>((resolve, reject) => {
        waiting.set(path, { resolve, reject })
      }),
  )
  return {
    signedUrl,
    source: { list: vi.fn(), add: vi.fn(), remove: vi.fn(), signedUrl } as unknown as AttachmentsGateway,
    answer: (path: string, url = `https://files.example/${path}`) => act(async () => waiting.get(path)?.resolve(url)),
    refuse: (path: string) => act(async () => waiting.get(path)?.reject(new Error('refused'))),
  }
}

function Probe({ path }: { path: string | null }) {
  const { url, failed } = useSignedUrl(path)
  return <p data-testid="out">{failed ? 'failed' : (url ?? 'waiting')}</p>
}

const tree = (source: AttachmentsGateway, path: string | null) => (
  <TasksContext value={{ tasks: {}, directory: {}, attachments: source, history: async () => [] } as unknown as TasksContextValue}>
    <Probe path={path} />
  </TasksContext>
)
const shown = () => screen.getByTestId('out').textContent

describe('useSignedUrl', () => {
  it('waits for the address, then gives it', async () => {
    const fake = gateway()
    render(tree(fake.source, 't/1.jpg'))
    expect(shown()).toBe('waiting')
    await fake.answer('t/1.jpg')
    expect(shown()).toBe('https://files.example/t/1.jpg')
  })

  it('gives an address that is already known at the first render, with no waiting', async () => {
    const fake = gateway()
    const first = render(tree(fake.source, 't/1.jpg'))
    await fake.answer('t/1.jpg')
    first.unmount()

    render(tree(fake.source, 't/1.jpg'))
    expect(shown()).toBe('https://files.example/t/1.jpg')
    expect(fake.signedUrl).toHaveBeenCalledTimes(1)
  })

  it('says that it failed when the server did not give the address', async () => {
    const fake = gateway()
    render(tree(fake.source, 't/1.jpg'))
    await fake.refuse('t/1.jpg')
    expect(shown()).toBe('failed')
  })

  it('asks for nothing when there is no path', () => {
    const fake = gateway()
    render(tree(fake.source, null))
    expect(shown()).toBe('waiting')
    expect(fake.signedUrl).not.toHaveBeenCalled()
  })

  it('switches to the address of a new path at once, and never shows the old one for it', async () => {
    const fake = gateway()
    const view = render(tree(fake.source, 't/1.jpg'))
    await fake.answer('t/1.jpg')
    view.rerender(tree(fake.source, 't/2.jpg'))
    expect(shown()).toBe('waiting')
    await fake.answer('t/2.jpg')
    expect(shown()).toBe('https://files.example/t/2.jpg')
  })

  it('ignores the late answer for a path that is no longer shown', async () => {
    const fake = gateway()
    const view = render(tree(fake.source, 't/1.jpg'))
    view.rerender(tree(fake.source, 't/2.jpg'))
    await fake.answer('t/2.jpg')
    await fake.answer('t/1.jpg')
    expect(shown()).toBe('https://files.example/t/2.jpg')
  })

  it('does not show a failure of a path that is no longer shown', async () => {
    const fake = gateway()
    const view = render(tree(fake.source, 't/1.jpg'))
    view.rerender(tree(fake.source, 't/2.jpg'))
    await fake.refuse('t/1.jpg')
    expect(shown()).toBe('waiting')
  })

  it('asks the gateway that it has now, when the gateway is replaced', async () => {
    const before = gateway()
    const after = gateway()
    const view = render(tree(before.source, 't/1.jpg'))
    await before.answer('t/1.jpg', 'https://before.example/1')
    view.rerender(tree(after.source, 't/1.jpg'))
    expect(shown()).toBe('waiting')
    await after.answer('t/1.jpg', 'https://after.example/1')
    expect(shown()).toBe('https://after.example/1')
  })

  it('keeps showing the address it gave, when the page is drawn again later', async () => {
    const fake = gateway()
    const view = render(tree(fake.source, 't/1.jpg'))
    await fake.answer('t/1.jpg')
    view.rerender(tree(fake.source, 't/1.jpg'))
    expect(shown()).toBe('https://files.example/t/1.jpg')
    expect(fake.signedUrl).toHaveBeenCalledTimes(1)
  })
})
