import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createTrayBehavior, SHOW_WINDOW_CHANNEL, wireTray } from './trayBehavior.js'

const APP_ID = 'io.github.dofer12.moked'
const APP_TITLE = 'יומן משימות מוקד'

/** Set by scripts/electron-smoke.mjs: render the first screen, report, and exit. */
const smoke = process.env.MOKED_SMOKE_TEST === '1'

/**
 * `electron . --demo` (npm run electron:demo) opens the build made with `--mode demo`, which has
 * no server and no user. A packaged app never honours it, and dist-demo is never packaged.
 */
const demo = !app.isPackaged && process.argv.includes('--demo')
const WEB_ENTRY = path.join(import.meta.dirname, '..', demo ? 'dist-demo' : 'dist', 'index.html')
/**
 * The icon of the tray. Packaged, it is a file beside the app (`extraResources` of electron-builder.yml),
 * and not inside the archive of the app; from a checkout it is in build/.
 */
const TRAY_ICON = app.isPackaged ? path.join(process.resourcesPath, 'tray.png') : path.join(import.meta.dirname, '..', 'build', 'tray.png')
// A demo keeps away from the real profile (stored sessions), and may run beside the real app.
if (demo) app.setPath('userData', `${app.getPath('userData')}-demo`)

/**
 * The app stays in the tray when its window is closed, so that the reminders (timers of the page) go on
 * and arrive. Only the smoke test and the demo, which show the first screen, leave with their window.
 */
const stayInTray = !smoke && !demo

let mainWindow: BrowserWindow | null = null
/** Held for as long as the app runs: a tray that is garbage collected disappears from the notification area. */
let tray: Tray | null = null

const behavior = createTrayBehavior({
  window: () => mainWindow,
  mainFrame: () => mainWindow?.webContents.mainFrame ?? null,
  stayInTray,
  quit: () => app.quit(),
})

/** Only plain web links ever leave the app; everything else is dropped. */
function openExternally(url: string) {
  try {
    const { protocol } = new URL(url)
    if (protocol === 'https:' || protocol === 'mailto:' || protocol === 'tel:') void shell.openExternal(url)
  } catch {
    // Not a URL: ignore it.
  }
}

interface SmokeResult {
  ok: boolean
  heading: string
  lang: string
  dir: string
  title: string
  /** `typeof window.mokedDesktop?.showWindow`: "function" when the preload ran and gave the page its one function. */
  bridge: string
  /** Whether the icon of the tray was found and is a picture. */
  trayIcon: boolean
}

async function runSmokeTest(win: BrowserWindow) {
  const outFile = process.env.MOKED_SMOKE_OUT
  const shotFile = process.env.MOKED_SMOKE_SHOT
  const watchdog = setTimeout(() => app.exit(2), 30_000)
  try {
    await new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()))
    // Give React a moment to render the first screen.
    const page = (await win.webContents.executeJavaScript(`
      new Promise((resolve) => setTimeout(() => resolve({
        heading: document.querySelector('h1')?.textContent ?? '',
        lang: document.documentElement.lang,
        dir: document.documentElement.dir,
        title: document.title,
        bridge: typeof window.mokedDesktop?.showWindow,
      }), 800))
    `)) as Omit<SmokeResult, 'ok' | 'trayIcon'>
    const trayIcon = !nativeImage.createFromPath(TRAY_ICON).isEmpty()
    const result: SmokeResult = {
      ...page,
      trayIcon,
      ok: page.heading !== '' && page.lang === 'he' && page.dir === 'rtl' && page.bridge === 'function' && trayIcon,
    }
    if (shotFile) writeFileSync(shotFile, (await win.webContents.capturePage()).toPNG())
    if (outFile) writeFileSync(outFile, JSON.stringify(result))
    clearTimeout(watchdog)
    app.exit(result.ok ? 0 : 1)
  } catch (err) {
    console.error(err)
    app.exit(1)
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 360,
    minHeight: 560,
    title: APP_TITLE,
    show: !smoke,
    backgroundColor: '#eef2f3',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Gives the page the one thing it may ask of the app: to show its window (see preload.cts).
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      // The reminders are timers of the page, and they must run on time while the window is hidden in the tray.
      backgroundThrottling: false,
    },
  })
  mainWindow = win

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault()
      openExternally(url)
    }
  })
  win.on('close', (event) => behavior.onClose(event))
  // Windows does not say "before-quit" when it ends the session (a shutdown, a log-off): this is how the window learns it.
  win.on('session-end', () => behavior.noteQuitting())
  win.on('closed', () => {
    mainWindow = null
  })

  void win.loadFile(WEB_ENTRY)
  if (smoke) void runSmokeTest(win)
}

if (!smoke && !demo && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => behavior.show())
  // Whatever leaves the app (the menu of the tray, a shutdown, an update) must find the window willing to close.
  app.on('before-quit', () => behavior.noteQuitting())
  app.on('window-all-closed', () => {
    if (!stayInTray) app.quit()
  })
  ipcMain.on(SHOW_WINDOW_CHANNEL, (event) => behavior.onShowRequest(event))
  void app.whenReady().then(() => {
    app.setAppUserModelId(APP_ID)
    Menu.setApplicationMenu(null)
    createWindow()
    if (stayInTray) {
      tray = new Tray(nativeImage.createFromPath(TRAY_ICON))
      wireTray(tray, behavior, { tooltip: APP_TITLE, buildMenu: (items) => Menu.buildFromTemplate(items) })
    }
  })
}
