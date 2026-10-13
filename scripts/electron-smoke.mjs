// Launches the Electron app in smoke-test mode and fails unless the first screen rendered.
//   node scripts/electron-smoke.mjs                      -> runs the app from this checkout
//   node scripts/electron-smoke.mjs --exe path/to/Moked.exe  -> runs a packaged build
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const exeFlag = process.argv.indexOf('--exe')
const packaged = exeFlag > -1
const command = packaged ? process.argv[exeFlag + 1] : require('electron')
const args = packaged ? [] : ['.']

const dir = mkdtempSync(path.join(tmpdir(), 'moked-smoke-'))
const resultFile = path.join(dir, 'result.json')
const shotFile = process.env.MOKED_SMOKE_SHOT ?? path.join(dir, 'screenshot.png')

const child = spawn(command, args, {
  env: { ...process.env, MOKED_SMOKE_TEST: '1', MOKED_SMOKE_OUT: resultFile, MOKED_SMOKE_SHOT: shotFile },
  stdio: 'inherit',
})
const code = await new Promise((resolve) => child.on('exit', resolve))
const result = existsSync(resultFile) ? JSON.parse(readFileSync(resultFile, 'utf8')) : null

console.log(JSON.stringify({ exitCode: code, result, screenshot: existsSync(shotFile) ? shotFile : null }, null, 2))
process.exit(code === 0 && result?.ok ? 0 : 1)
