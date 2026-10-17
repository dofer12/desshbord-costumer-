// The only thing that the page of the Windows app can ask of the app itself: to show its window, which
// a notification does when it is clicked while the window is hidden in the tray. This is a script that
// runs in a sandbox with `require` for Electron alone, so it is one file in CommonJS, and it has no
// constants of its own to share: the name of the message is the same one that trayBehavior.ts listens for.

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the sandbox of a preload loads Electron with `require` and nothing else
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')

contextBridge.exposeInMainWorld('mokedDesktop', {
  showWindow: () => ipcRenderer.send('moked:show-window'),
})
