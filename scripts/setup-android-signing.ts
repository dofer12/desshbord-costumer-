// Creates the Android release signing key and stores it as GitHub Actions secrets.
// The key never enters the repository or any chat: it is written to a folder outside the
// repository (default ~/moked-secrets) and sent to GitHub through stdin.
//   node scripts/setup-android-signing.ts [--repo owner/name] [--out-dir DIR] [--dry-run]
// BACK UP the two files it creates. Without that key an installed APK cannot be updated.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'

const DEFAULT_REPO = 'dofer12/desshbord-costumer-'
const KEY_ALIAS = 'moked'

export interface Options {
  repo: string
  outDir: string | undefined
  dryRun: boolean
}

export function makePassword(): string {
  return randomBytes(18).toString('base64url')
}

export function parseArgs(argv: string[]): Options {
  const options: Options = { repo: DEFAULT_REPO, outDir: undefined, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--repo' || arg === '--out-dir') {
      const value = argv[++i]
      if (!value) throw new Error(`${arg} needs a value`)
      if (arg === '--repo') options.repo = value
      else options.outDir = value
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(options.repo)) throw new Error('--repo must look like owner/name')
  return options
}

export function assertOutsideRepo(outDir: string, repoDir: string): void {
  const relative = path.relative(path.resolve(repoDir), path.resolve(outDir))
  const inside = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  if (inside) throw new Error(`${outDir} is inside the repository, where the key could be committed. Pick another folder.`)
}

function findOpenssl(): string {
  const candidates = [
    'openssl',
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
    'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
  ]
  for (const candidate of candidates) {
    if (spawnSync(candidate, ['version']).status === 0) return candidate
  }
  throw new Error('OpenSSL was not found. It ships with Git for Windows (Git\\usr\\bin\\openssl.exe).')
}

function run(command: string, args: string[], env: Record<string, string> = {}): string {
  const result = spawnSync(command, args, { encoding: 'utf8', env: { ...process.env, ...env } })
  if (result.status !== 0) throw new Error(`${path.basename(command)} ${args[0]} failed:\n${result.stderr}`)
  return result.stdout
}

function setSecret(repo: string, name: string, value: string): void {
  const result = spawnSync('gh', ['secret', 'set', name, '--repo', repo], { input: value, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`Could not set ${name}:\n${result.stderr}`)
}

function main(): void {
  const options = parseArgs(process.argv.slice(2))
  const outDir = path.resolve(options.outDir ?? path.join(homedir(), 'moked-secrets'))
  assertOutsideRepo(outDir, process.cwd())

  const p12Path = path.join(outDir, 'moked-release.p12')
  const passwordPath = path.join(outDir, 'moked-release-password.txt')
  if (existsSync(p12Path)) {
    throw new Error(
      `${p12Path} already exists, so nothing was changed. Replacing the signing key means every installed copy of the app must be uninstalled first.`,
    )
  }
  if (!options.dryRun && spawnSync('gh', ['auth', 'status']).status !== 0) {
    throw new Error('GitHub CLI is not signed in. Run: gh auth login')
  }

  const openssl = findOpenssl()
  const password = makePassword()
  const work = mkdtempSync(path.join(tmpdir(), 'moked-key-'))
  let fingerprint: string
  try {
    mkdirSync(outDir, { recursive: true })
    const keyPem = path.join(work, 'key.pem')
    const certPem = path.join(work, 'cert.pem')
    run(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPem, '-out', certPem, '-days', '10000', '-subj', '/CN=Moked/O=dofer12'])
    run(openssl, ['pkcs12', '-export', '-inkey', keyPem, '-in', certPem, '-name', KEY_ALIAS, '-out', p12Path, '-passout', 'env:MOKED_P12_PASS'], { MOKED_P12_PASS: password })
    fingerprint = run(openssl, ['x509', '-in', certPem, '-noout', '-fingerprint', '-sha256']).trim()
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  writeFileSync(passwordPath, `${password}\n`, { mode: 0o600 })

  if (options.dryRun) {
    console.log('Dry run: the key was created, but nothing was sent to GitHub.')
  } else {
    setSecret(options.repo, 'ANDROID_KEYSTORE_BASE64', readFileSync(p12Path).toString('base64'))
    setSecret(options.repo, 'ANDROID_KEYSTORE_PASSWORD', password)
    setSecret(options.repo, 'ANDROID_KEY_ALIAS', KEY_ALIAS)
    setSecret(options.repo, 'ANDROID_KEY_PASSWORD', password)
    console.log(`Stored 4 secrets in ${options.repo}.`)
  }
  console.log(`Key file:      ${p12Path}`)
  console.log(`Password file: ${passwordPath}`)
  console.log(`Certificate:   ${fingerprint}`)
  console.log('BACK UP BOTH FILES NOW (a password manager is ideal). Without them an installed APK cannot be updated.')
}

if (import.meta.main) {
  try {
    main()
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`)
    process.exit(1)
  }
}
