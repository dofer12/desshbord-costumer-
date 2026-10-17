// @vitest-environment node
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { SHOW_WINDOW_CHANNEL } from './trayBehavior'

// The preload is the one script that runs inside the window with a way to reach the main process. It
// must give the page exactly one function, that asks for the window to be shown, and nothing else. It
// runs in a sandbox that cannot load other files, so it is tested as the sandbox runs it: its source,
// turned into JavaScript, with a pretend `require`.

const source = readFileSync(new URL('./preload.cts', import.meta.url), 'utf8')
const script = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText

function run() {
  const exposed: Record<string, unknown> = {}
  const sent: unknown[][] = []
  const required: string[] = []
  const electron = {
    contextBridge: { exposeInMainWorld: (name: string, api: unknown) => void (exposed[name] = api) },
    ipcRenderer: { send: (...args: unknown[]) => void sent.push(args) },
  }
  const require = (id: string) => {
    required.push(id)
    if (id === 'electron') return electron
    throw new Error(`the preload may not load ${id}`)
  }
  new Function('require', 'module', 'exports', script)(require, { exports: {} }, {})
  return { exposed, sent, required }
}

describe('the preload', () => {
  it('loads Electron and nothing else', () => {
    expect(run().required).toEqual(['electron'])
  })

  it('gives the page one object, named mokedDesktop', () => {
    expect(Object.keys(run().exposed)).toEqual(['mokedDesktop'])
  })

  it('which has one function, showWindow, and nothing else', () => {
    const api = run().exposed.mokedDesktop as Record<string, unknown>
    expect(Object.keys(api)).toEqual(['showWindow'])
    expect(typeof api.showWindow).toBe('function')
  })

  it('sends the one message that asks for the window, when it is called', () => {
    const { exposed, sent } = run()
    expect(sent).toEqual([])
    ;(exposed.mokedDesktop as { showWindow(): void }).showWindow()
    expect(sent).toEqual([[SHOW_WINDOW_CHANNEL]])
  })

  it('passes nothing that the page gives it on to the main process', () => {
    const { exposed, sent } = run()
    ;(exposed.mokedDesktop as { showWindow(...args: unknown[]): void }).showWindow('other-channel', { evil: true })
    expect(sent).toEqual([[SHOW_WINDOW_CHANNEL]])
  })
})
