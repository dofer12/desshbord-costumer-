// What the Windows app does to stay in the tray, apart from Electron itself, so that it can be tested
// with pretend windows. The app has to stay alive for the reminders to arrive: closing the window only
// hides it, the icon in the tray brings it back, and the app is left from the menu of the icon.

/** The name of the message that the window sends to ask for itself to be shown. The preload sends it under this name. */
export const SHOW_WINDOW_CHANNEL = 'moked:show-window'

/** The part of Electron's window that is used here. */
export interface WindowLike {
  isMinimized(): boolean
  isVisible(): boolean
  restore(): void
  show(): void
  hide(): void
  focus(): void
}

/** The part of Electron's frame that tells one frame from another: an id that is the frame's own for as long as it lives. */
export interface FrameLike {
  readonly frameTreeNodeId: number
}

export interface TrayDeps {
  /** The window of the app, or null when there is none. */
  window(): WindowLike | null
  /** The main frame of that window, or null when there is none. */
  mainFrame(): FrameLike | null
  /** False for the smoke test and the demo: they show the first screen, and the app leaves when their window is closed. */
  stayInTray: boolean
  /** Leaves the app (Electron's `app.quit`). */
  quit(): void
}

export interface MenuItemLike {
  label: string
  click(): void
}

export interface TrayBehavior {
  /** For the "close" event of the window: hides the window and keeps it open, unless the app is being left. */
  onClose(event: { preventDefault(): void }): void
  /** Brings the window back: restored if it is minimised, shown if it is hidden, and in front. */
  show(): void
  /** For the message that asks for the window: shows it, but only when the message comes from the main frame of the window. */
  onShowRequest(event: { senderFrame: FrameLike | null }): void
  /** Leaves the app for good: the next close of the window lets it close. */
  requestQuit(): void
  /** The app is being left by something else (a shutdown, an update): the window must not stand in the way. */
  noteQuitting(): void
  /** The items of the menu of the icon. */
  menu(): MenuItemLike[]
}

export function createTrayBehavior(deps: TrayDeps): TrayBehavior {
  let quitting = false

  function show() {
    const window = deps.window()
    if (!window) return
    if (window.isMinimized()) window.restore()
    if (!window.isVisible()) window.show()
    window.focus()
  }

  function noteQuitting() {
    quitting = true
  }

  function requestQuit() {
    noteQuitting()
    deps.quit()
  }

  return {
    onClose(event) {
      if (quitting || !deps.stayInTray) return
      event.preventDefault()
      deps.window()?.hide()
    },
    show,
    onShowRequest(event) {
      const main = deps.mainFrame()
      if (main === null || event.senderFrame === null) return
      if (event.senderFrame.frameTreeNodeId !== main.frameTreeNodeId) return
      show()
    },
    requestQuit,
    noteQuitting,
    menu: () => [
      { label: 'פתיחה', click: show },
      { label: 'יציאה', click: requestQuit },
    ],
  }
}

/** The part of Electron's tray that is used here; `Menu` is whatever the tray takes as its menu. */
export interface TrayLike<Menu> {
  setToolTip(text: string): void
  setContextMenu(menu: Menu): void
  on(event: 'click', listener: () => void): unknown
}

/** Gives the icon its tooltip and its menu, and brings the window back when the icon is clicked. */
export function wireTray<Menu>(
  tray: TrayLike<Menu>,
  behavior: TrayBehavior,
  options: { tooltip: string; buildMenu(items: MenuItemLike[]): Menu },
): void {
  tray.setToolTip(options.tooltip)
  tray.setContextMenu(options.buildMenu(behavior.menu()))
  tray.on('click', () => behavior.show())
}
