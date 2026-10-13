import { app, BrowserWindow, Menu, shell } from 'electron'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

const APP_ID = 'io.github.dofer12.moked'
const APP_TITLE = 'יומן משימות מוקד'
const WEB_ENTRY = path.join(import.meta.dirname, '..', 'dist', 'index.html')

/** Set by scripts/electron-smoke.mjs: render the first screen, report, and exit. */
const smoke = process.env.MOKED_SMOKE_TEST === '1'

let mainWindow: BrowserWindow | null = null

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
      }), 800))
    `)) as Omit<SmokeResult, 'ok'>
    const result: SmokeResult = { ...page, ok: page.heading !== '' && page.lang === 'he' && page.dir === 'rtl' }
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
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
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
  win.on('closed', () => {
    mainWindow = null
  })

  void win.loadFile(WEB_ENTRY)
  if (smoke) void runSmokeTest(win)
}

if (!smoke && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.on('window-all-closed', () => app.quit())
  void app.whenReady().then(() => {
    app.setAppUserModelId(APP_ID)
    Menu.setApplicationMenu(null)
    createWindow()
  })
}
