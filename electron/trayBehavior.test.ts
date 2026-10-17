// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createTrayBehavior, SHOW_WINDOW_CHANNEL, wireTray, type WindowLike } from './trayBehavior'

// What the Windows app does to stay in the tray, apart from Electron itself: closing the window hides
// it, the icon brings it back, and the app is left from the menu of the icon. Pretend windows, frames
// and a pretend tray stand in for Electron's.

function pretendWindow(state: { minimized?: boolean; visible?: boolean } = {}) {
  const calls: string[] = []
  const window: WindowLike = {
    isMinimized: () => state.minimized ?? false,
    isVisible: () => state.visible ?? true,
    restore: vi.fn(() => void calls.push('restore')),
    show: vi.fn(() => void calls.push('show')),
    hide: vi.fn(() => void calls.push('hide')),
    focus: vi.fn(() => void calls.push('focus')),
  }
  return { window, calls }
}

interface Options {
  /** False for the smoke test and the demo. */
  stayInTray?: boolean
  state?: { minimized?: boolean; visible?: boolean }
  noWindow?: boolean
  /** The frame tree node of the main frame of the window; null when the window has none. */
  mainFrame?: number | null
}

function setup(options: Options = {}) {
  const pretend = pretendWindow(options.state)
  const quit = vi.fn()
  const behavior = createTrayBehavior({
    window: () => (options.noWindow ? null : pretend.window),
    mainFrame: () => (options.mainFrame === null ? null : { frameTreeNodeId: options.mainFrame ?? 1 }),
    stayInTray: options.stayInTray ?? true,
    quit,
  })
  return { ...pretend, quit, behavior }
}

const closing = () => ({ preventDefault: vi.fn() })

describe('closing the window', () => {
  it('hides the window instead of closing it, so that the reminders go on', () => {
    const { behavior, window } = setup()
    const event = closing()
    behavior.onClose(event)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(window.hide).toHaveBeenCalledTimes(1)
  })

  it('lets it close after the app was asked to quit, and quits', () => {
    const { behavior, window, quit } = setup()
    behavior.requestQuit()
    expect(quit).toHaveBeenCalledTimes(1)
    const event = closing()
    behavior.onClose(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(window.hide).not.toHaveBeenCalled()
  })

  it('lets it close when the system is quitting the app (a shutdown, an update), without quitting again', () => {
    const { behavior, window, quit } = setup()
    behavior.noteQuitting()
    const event = closing()
    behavior.onClose(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(window.hide).not.toHaveBeenCalled()
    expect(quit).not.toHaveBeenCalled()
  })

  it('does not hide anything when the app is not meant to stay in the tray (the smoke test and the demo)', () => {
    const { behavior, window } = setup({ stayInTray: false })
    const event = closing()
    behavior.onClose(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(window.hide).not.toHaveBeenCalled()
  })

  it('does not fail when the window is already gone', () => {
    const { behavior } = setup({ noWindow: true })
    expect(() => behavior.onClose(closing())).not.toThrow()
  })
})

describe('bringing the window back', () => {
  it('restores a minimised window and puts it in front', () => {
    const { behavior, calls } = setup({ state: { minimized: true, visible: true } })
    behavior.show()
    expect(calls).toEqual(['restore', 'focus'])
  })

  it('shows a window that is hidden, and puts it in front', () => {
    const { behavior, calls } = setup({ state: { visible: false } })
    behavior.show()
    expect(calls).toEqual(['show', 'focus'])
  })

  it('only puts a window that is already there in front', () => {
    const { behavior, calls } = setup()
    behavior.show()
    expect(calls).toEqual(['focus'])
  })

  it('restores and shows a window that is both minimised and hidden', () => {
    const { behavior, calls } = setup({ state: { minimized: true, visible: false } })
    behavior.show()
    expect(calls).toEqual(['restore', 'show', 'focus'])
  })

  it('does nothing, and does not fail, when there is no window', () => {
    const { behavior } = setup({ noWindow: true })
    expect(() => behavior.show()).not.toThrow()
  })
})

describe('the menu of the icon', () => {
  it('has "open" and "quit", in this order', () => {
    const { behavior } = setup()
    expect(behavior.menu().map((item) => item.label)).toEqual(['פתיחה', 'יציאה'])
  })

  it('opens the window with "open", and quits with "quit"', () => {
    const { behavior, calls, quit } = setup({ state: { visible: false } })
    const [open, leave] = behavior.menu()
    open.click()
    expect(calls).toEqual(['show', 'focus'])
    expect(quit).not.toHaveBeenCalled()
    leave.click()
    expect(quit).toHaveBeenCalledTimes(1)
  })
})

describe('the message that asks for the window', () => {
  it('has the name that the preload sends it under', () => {
    expect(SHOW_WINDOW_CHANNEL).toBe('moked:show-window')
  })

  it('shows the window when it comes from the main frame of the window of the app', () => {
    const { behavior, calls } = setup({ state: { visible: false }, mainFrame: 7 })
    behavior.onShowRequest({ senderFrame: { frameTreeNodeId: 7 } })
    expect(calls).toEqual(['show', 'focus'])
  })

  it('ignores it from another frame, even one of the same window', () => {
    const { behavior, calls } = setup({ state: { visible: false }, mainFrame: 7 })
    behavior.onShowRequest({ senderFrame: { frameTreeNodeId: 8 } })
    expect(calls).toEqual([])
  })

  it('ignores it from a frame that is not there, or when the window has no main frame', () => {
    const hidden = { state: { visible: false } }
    const noSender = setup({ ...hidden, mainFrame: 7 })
    noSender.behavior.onShowRequest({ senderFrame: null })
    const noMain = setup({ ...hidden, mainFrame: null })
    noMain.behavior.onShowRequest({ senderFrame: { frameTreeNodeId: 7 } })
    const neither = setup({ ...hidden, mainFrame: null })
    neither.behavior.onShowRequest({ senderFrame: null })
    expect([noSender.calls, noMain.calls, neither.calls]).toEqual([[], [], []])
  })
})

describe('the icon in the tray', () => {
  function pretendTray() {
    const record: { tooltip?: string; menu?: unknown; click?: () => void } = {}
    const tray = {
      setToolTip: (text: string) => void (record.tooltip = text),
      setContextMenu: (menu: unknown) => void (record.menu = menu),
      on: (_event: 'click', listener: () => void) => void (record.click = listener),
    }
    return { tray, record }
  }

  it('has the title of the app as its tooltip', () => {
    const { behavior } = setup()
    const { tray, record } = pretendTray()
    wireTray(tray, behavior, { tooltip: 'יומן משימות מוקד', buildMenu: (items) => items })
    expect(record.tooltip).toBe('יומן משימות מוקד')
  })

  it('has the menu that is built from the items of the behavior', () => {
    const { behavior } = setup()
    const { tray, record } = pretendTray()
    wireTray(tray, behavior, { tooltip: '', buildMenu: (items) => ({ labels: items.map((item) => item.label) }) })
    expect(record.menu).toEqual({ labels: ['פתיחה', 'יציאה'] })
  })

  it('shows the window on a click', () => {
    const { behavior, calls, quit } = setup({ state: { visible: false } })
    const { tray, record } = pretendTray()
    wireTray(tray, behavior, { tooltip: '', buildMenu: (items) => items })
    expect(calls).toEqual([])
    record.click?.()
    expect(calls).toEqual(['show', 'focus'])
    expect(quit).not.toHaveBeenCalled()
  })
})
