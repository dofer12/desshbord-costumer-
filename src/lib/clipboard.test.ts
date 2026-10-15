import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from './clipboard'

type Clipboard = { writeText: (text: string) => Promise<void> }

function stubClipboard(clipboard: Clipboard | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })
}

function stubExecCommand(result: boolean | Error) {
  const exec = vi.fn(() => {
    if (result instanceof Error) throw result
    return result
  })
  Object.defineProperty(document, 'execCommand', { value: exec, configurable: true })
  return exec
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
  Reflect.deleteProperty(document, 'execCommand')
})

describe('copyText', () => {
  it('writes the text to the clipboard and says that it worked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard({ writeText })
    await expect(copyText('050-1234567')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('050-1234567')
  })

  it('does not touch the page when the clipboard works', async () => {
    stubClipboard({ writeText: vi.fn().mockResolvedValue(undefined) })
    const exec = stubExecCommand(true)
    await copyText('x')
    expect(exec).not.toHaveBeenCalled()
  })

  it('selects the text in a field that is only there for a moment when there is no clipboard API', async () => {
    stubClipboard(undefined)
    let copied = ''
    const exec = vi.fn((command: string) => {
      copied = document.querySelector('textarea')?.value ?? ''
      return command === 'copy'
    })
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true })
    await expect(copyText('ORD-77')).resolves.toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
    expect(copied).toBe('ORD-77')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('gives the focus back to what had it, when it had to select', async () => {
    stubClipboard(undefined)
    stubExecCommand(true)
    const button = document.createElement('button')
    document.body.append(button)
    button.focus()
    await copyText('x')
    expect(document.activeElement).toBe(button)
    button.remove()
  })

  it('falls back to selecting when the clipboard refuses', async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError')) })
    const exec = stubExecCommand(true)
    await expect(copyText('x')).resolves.toBe(true)
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('says that it failed, and leaves nothing behind, when nothing works', async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error('no')) })
    stubExecCommand(new Error('not supported'))
    await expect(copyText('x')).resolves.toBe(false)
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('says that it failed when the browser has no way at all', async () => {
    stubClipboard(undefined)
    await expect(copyText('x')).resolves.toBe(false)
  })

  it('says that it failed when selecting is refused', async () => {
    stubClipboard(undefined)
    stubExecCommand(false)
    await expect(copyText('x')).resolves.toBe(false)
  })
})
