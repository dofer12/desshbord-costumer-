# M0 Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A login-only app (Hebrew, right-to-left) that runs as a website, an Android APK and a Windows installer, signs users in against Supabase, and is built and published by GitHub Actions. It proves the whole pipeline before any feature is built on it.

**Architecture:** One Vite + React + TypeScript codebase. A small auth store (zustand) reaches Supabase only through an `AuthGateway` interface, so every behaviour is unit-tested against a fake. Capacitor wraps `dist/` for Android and Electron wraps it for Windows. One SQL migration creates `profiles` and the "first user becomes admin" trigger, and is tested inside a real Postgres (PGlite). Two workflows check every push and publish tagged releases.

**Tech Stack:** Node 24, TypeScript ~6.0, React 19, Vite 8, Vitest 5 with Testing Library and jsdom, PGlite (Postgres in WebAssembly) for migration tests, react-router 8 (HashRouter), zustand 5, @supabase/supabase-js 2, Capacitor 8 (Android), Electron 44 with electron-builder 26 (Windows NSIS), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-13-platform-core-design.md`: sections 5, 6, 7 (`profiles`), 8, 9 and the M0 row of section 16. This plan implements milestone M0 only. Plans for M1 to M4 are written after M0 is accepted on real devices.

**How this plan was prepared:** every file below was written and run in a scratch project on 2026-10-14. There, 110 tests, typecheck, lint, the production build, `cap sync`, the Electron smoke test (also on the packaged app), the NSIS installer build and the workflow schema validation all passed. Two things could not run on this computer and are proven only by the first pipeline run in Task 13: the Gradle build of the APK (no JDK or Android SDK here) and the GitHub-hosted runners.

**Conventions:** shell commands use Git Bash syntax (the Bash tool). Run everything from the repository root unless a step says otherwise. Expected test counts are cumulative for `npm test`.

## Global Constraints

- **Runtime and tooling:** Node `>=24`. TypeScript `~6.0.2` (the Vite template's choice; do not move to 7). React 19, Vite 8, Vitest 5, react-router 8, @supabase/supabase-js 2, Capacitor 8, Electron 44, electron-builder 26.
- **Identity:** app id `io.github.dofer12.moked`. Android app name and Windows window title: `יומן משימות מוקד`. Windows product, executable and installer names are ASCII: `Moked`.
- **One build for three hosts:** hash routing (`#/login`) and Vite `base: './'`, so the same `dist/` runs from a web server, from `https://localhost` (Android WebView) and from `file://` (Electron).
- **Dependencies:** every library the renderer uses is a `devDependency`, because Vite bundles it. Only the bundle ships; the Electron `app.asar` must contain just `dist/` and `dist-electron/`.
- **Server settings:** `.env` holds exactly `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, both public by design. Supabase keys are named Publishable (`sb_publishable_…`) and Secret (`sb_secret_…`); the old `anon` and `service_role` names are deprecated by the end of 2026 (verified in the official docs on 2026-10-14). A secret key (either format) must be rejected by `loadConfig`.
- **Text:** UI strings in Hebrew; identifiers and log text in English; email and password inputs use `dir="ltr"`; numbers, versions and hostnames use the `.num` class.
- **Auth:** email and password only, no self sign-up. The first user in the system becomes admin (`handle_new_user`). Error messages never show raw backend text.
- **Android:** JDK 21, Gradle wrapper 8.14.3, `compileSdk`/`targetSdk` 36, `minSdk` 24 (the Capacitor 8.5.3 template). `versionCode = major * 1_000_000 + minor * 1_000 + patch`. Release APKs are signed with a PKCS12 key from GitHub secrets. `android:allowBackup="false"`.
- **Windows:** Electron `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Per-user NSIS installer, unsigned.
- **Workflows:** `actions/checkout@v7`, `actions/setup-node@v7`, `actions/setup-java@v6`, `actions/upload-artifact@v7`, `actions/download-artifact@v8`, `softprops/action-gh-release@v3` (latest majors on 2026-10-14). Runners `ubuntu-24.04` and `windows-latest`.
- **Git:** work only on branch `feat/platform-core`, in the clone at `C:\dev\desshbord-costumer-`. Commit after every task. Every commit message ends with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. **Never push without the owner's go-ahead.**
- **The live site stays untouched:** `.github/workflows/static.yml` is not edited and runs only on `main`. The original app is preserved at `public/legacy/index.html`.
- **No secret enters the repository or the chat.** Signing keys go to `~/moked-secrets` and to GitHub secrets through stdin.

## Review Focus

Failure modes the spec implies that a person using this software is most likely to hit, each pinned by a test in the task that owns the code:

1. **Email typed on a phone keyboard** (`Dana@Example.com ` with a capital letter and a trailing space) must still sign in. Pinned in Task 4 (`normalizeEmail`, `validateCredentials`), Task 5 (the store sends the normalised email) and Task 6 (the login page).
2. **A wrong password** must show a Hebrew message, never raw backend text, and leave the form usable with the typed email intact. Pinned in Task 4 (`toHebrewAuthError`) and Task 6.
3. **Opening the app when the server cannot be reached** must not sign the user out. It shows "אין חיבור לשרת" with a retry button. Pinned in Task 5 and Task 6 (`App.test.tsx`).
4. **The server ending a session** (for example an admin deactivated the user) must return the user to the login screen with an explanation, while a deliberate sign-out must not show that explanation. Pinned in Task 5 and Task 6.
5. **The owner pasting a Secret key into `.env`** of a public repository must stop both the app and the release build. Pinned in Task 3 (`loadConfig`, `envFile.test.ts`) and Task 10 (`check-config.test.ts`).

Also pinned: the double-submit guard (Tasks 5 and 6), a deactivated or missing profile (Tasks 5, 6 and 7), a release tag that disagrees with `package.json` (Task 10), refusing to overwrite the signing key or to write it inside the repository (Task 10), and the packaged Windows app actually rendering (Task 8).

## Not in M0

Deferred to later milestones, on purpose: the task data model and screens (M1 and later), forced password change and employee management (M3), content security policy, app icon and PWA (M4), notifications, and Windows code signing (out of scope for the whole of part 1).

## File Structure

```
.env                          committed in Task 13 with the owner's public values
.env.local                    developer placeholders, gitignored, never committed
.gitattributes  .gitignore  README.md  index.html  package.json  package-lock.json
tsconfig.json  tsconfig.app.json  tsconfig.node.json  vite.config.ts  eslint.config.js
capacitor.config.ts  electron-builder.yml
.github/workflows/ci.yml      typecheck, lint, test, build on every push
.github/workflows/release.yml tag or manual run: APK + Windows installer + GitHub Release
android/                      Capacitor project; app/build.gradle and AndroidManifest.xml edited
docs/setup-he.md              one-time owner guide (Hebrew)
electron/main.ts              window, external links, single instance, smoke-test mode
electron/tsconfig.json
public/favicon.svg
public/legacy/index.html      the original single-file app, unchanged
scripts/electron-smoke.mjs    launches the app headless and checks the first screen
scripts/release-version.ts    tag -> version + Android versionCode (+ test)
scripts/check-config.ts       release gate for .env (+ test)
scripts/setup-android-signing.ts  creates the signing key and GitHub secrets (+ test)
src/main.tsx                  composition root
src/App.tsx                   routes
src/env.d.ts
src/lib/config.ts             loadConfig + secret-key guard (+ tests)
src/lib/supabase.ts           createSupabaseClient
src/features/auth/            types, credentials, errors, authStore, supabaseGateway,
                              authContext, AuthProvider, StatusScreens, routes, LoginPage (+ tests)
src/features/home/HomePage.tsx
src/features/config/ConfigErrorScreen.tsx
src/styles/                   fonts.ts, tokens.css, base.css
src/test/                     setup.ts, fakeGateway.ts, renderApp.tsx
supabase/migrations/0001_profiles.sql
supabase/tests/               helpers/pg.ts, 0001_profiles.test.ts
```

---

### Task 1: Working copy outside OneDrive

**Why:** the repository folder lives in OneDrive under a Hebrew path. `node_modules` and the build output are tens of thousands of files that OneDrive would sync and lock, and some build tools mishandle non-ASCII paths. All work happens in a clone at `C:\dev\desshbord-costumer-`, created from the local repository, so no network or GitHub login is needed yet.

**Files:** none.

- [ ] **Step 1: Commit this plan and the spec updates in the OneDrive copy**

Once the owner has approved this plan and agreed to commit it, run this from the OneDrive working copy:

```bash
cd "<the OneDrive working copy of the repository>"
git add docs
git commit -m "docs: add the M0 implementation plan and update the design spec" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git log --oneline -3
```

Expected: a new commit on `feat/platform-core` on top of `eb04e2e`.

- [ ] **Step 2: Get the owner's permission to work in `C:\dev`**

Call the `mcp__ccd_directory__request_directory` tool (load it with ToolSearch first) for `C:\dev`, and wait for approval.

- [ ] **Step 3: Clone and point `origin` at GitHub**

```bash
mkdir -p C:/dev
git clone --branch feat/platform-core "<the OneDrive working copy of the repository>" C:/dev/desshbord-costumer-
cd C:/dev/desshbord-costumer-
git remote set-url origin https://github.com/dofer12/desshbord-costumer-.git
git remote -v
git branch --show-current
git log --oneline -3
```

Expected: both `origin` URLs are `https://github.com/dofer12/desshbord-costumer-.git`, the branch is `feat/platform-core`, and the log shows the commit from Step 1.

Then switch the session into the clone with the `mcp__ccd_directory__change_directory` tool (load it with ToolSearch first) and `C:\dev\desshbord-costumer-`, so the remaining steps run there.

- [ ] **Step 4: Check the tools**

```bash
node --version
npm --version
```

Expected: Node `v24.x` or newer. From here on every command runs in `C:\dev\desshbord-costumer-`.

There is nothing to commit in this task.

---

### Task 2: Project scaffold and toolchain

**Files:**
- Move: `index.html` to `public/legacy/index.html`
- Create: `package.json`, `package-lock.json` (generated), `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `vite.config.ts`, `eslint.config.js`, `.gitignore` (replaced), `.gitattributes`, `README.md`, `index.html`, `public/favicon.svg`, `src/main.tsx` (placeholder, replaced in Task 6), `src/test/setup.ts`, `src/test/toolchain.test.tsx`

**Interfaces:**
- Produces: working `npm run lint`, `npm test`, `npm run build`. The scripts `electron:*`, `dist:win` and `android:sync`, and the Electron half of `typecheck`, are already in `package.json` but only start working in Tasks 8 and 9. Until Task 8, check types with `npx tsc -b` instead of `npm run typecheck`.

This is a toolchain task, so it is verified by running the commands rather than by a red-then-green test.

- [ ] **Step 1: Preserve the original app**

```bash
mkdir -p public/legacy
git mv index.html public/legacy/index.html
git status --short
```

Expected: `R  index.html -> public/legacy/index.html`.

- [ ] **Step 2: Create `package.json`**

`allowScripts` records that the unneeded install script of `electron-winstaller` is denied (npm 11 asks about it otherwise).

`package.json`:

```json
{
  "name": "moked-tasks",
  "private": true,
  "version": "0.1.0",
  "description": "יומן משימות מוקד - Moked task journal",
  "author": "dofer12",
  "type": "module",
  "main": "dist-electron/main.js",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b && tsc -p electron/tsconfig.json --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "electron:compile": "tsc -p electron/tsconfig.json",
    "electron:dev": "npm run build && npm run electron:compile && electron .",
    "electron:smoke": "node scripts/electron-smoke.mjs",
    "dist:win": "npm run build && npm run electron:compile && electron-builder --win nsis --publish never",
    "android:sync": "npm run build && cap sync android"
  },
  "devDependencies": {
    "@capacitor/android": "^8.5.3",
    "@capacitor/cli": "^8.5.3",
    "@capacitor/core": "^8.5.3",
    "@electric-sql/pglite": "^0.5.9",
    "@eslint/js": "^10.0.1",
    "@fontsource/ibm-plex-sans-hebrew": "^5.3.0",
    "@fontsource/secular-one": "^5.3.0",
    "@supabase/supabase-js": "^2.117.3",
    "@testing-library/jest-dom": "^7.0.1",
    "@testing-library/react": "^16.3.3",
    "@testing-library/user-event": "^14.6.8",
    "@types/node": "^24.13.3",
    "@types/react": "^19.2.18",
    "@types/react-dom": "^19.2.7",
    "@vitejs/plugin-react": "^6.1.1",
    "electron": "^44.7.1",
    "electron-builder": "^26.15.3",
    "eslint": "^10.10.0",
    "eslint-plugin-react-hooks": "^7.1.1",
    "eslint-plugin-react-refresh": "^0.5.6",
    "globals": "^17.12.0",
    "jsdom": "^30.1.2",
    "react": "^19.2.8",
    "react-dom": "^19.2.8",
    "react-router": "^8.4.0",
    "typescript": "~6.0.2",
    "typescript-eslint": "^8.69.0",
    "vite": "^8.3.0",
    "vitest": "^5.0.4",
    "zustand": "^5.0.15"
  },
  "allowScripts": {
    "electron-winstaller": false
  }
}
```

- [ ] **Step 3: Create the TypeScript configs**

`tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

`tsconfig.app.json`:

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023", "DOM"],
    "module": "esnext",
    "types": ["vite/client"],
    "allowArbitraryExtensions": true,
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",

    /* Linting */
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

`tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023"],
    "types": ["node"],
    "skipLibCheck": true,

    /* Bundler mode */
    "module": "esnext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,

    /* Linting */
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["vite.config.ts", "capacitor.config.ts", "supabase/**/*.ts", "scripts/**/*.ts"]
}
```

- [ ] **Step 4: Create `vite.config.ts` and `eslint.config.js`**

`vite.config.ts`:

```ts
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths so the same build runs on a web server, inside the
  // Android WebView (https://localhost) and from file:// in Electron.
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'supabase/tests/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
})
```

`eslint.config.js`:

```js
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'dist-electron', 'release', 'android']),
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: [
      'vite.config.ts',
      'capacitor.config.ts',
      'supabase/**/*.ts',
      'electron/**/*.ts',
      'scripts/**/*.{ts,mjs}',
    ],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
])
```

- [ ] **Step 5: Create the repository files**

Replace `.gitignore`:

`.gitignore`:

```
# Logs
logs
*.log
npm-debug.log*

node_modules
dist
dist-ssr
dist-electron
release
# .env.local holds developer-only placeholder values and never ships
*.local

# Editors
.vscode/*
!.vscode/extensions.json
.idea
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?

# Signing keys and tool caches must never be committed
*.p12
*.jks
*.keystore
.serena/
```

`.gitattributes`:

```
* text=auto
# Shell scripts must keep LF line endings, or they fail on the Linux build runner.
android/gradlew text eol=lf
*.sh text eol=lf
*.bat text eol=crlf
*.png binary
*.jar binary
```

`README.md`:

```markdown
# יומן משימות מוקד (Moked task journal)

A Hebrew, right-to-left task journal for a service desk. One codebase, three targets: the web, Android (Capacitor) and Windows (Electron). The shared data lives in a Supabase project.

- Design and plans: `docs/superpowers/`
- One-time setup for the owner (Hebrew): `docs/setup-he.md`
- The original single-file app is kept at `public/legacy/index.html`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Web dev server. Needs `.env` or `.env.local` with the Supabase settings. |
| `npm test` | Unit, component and database-migration tests. |
| `npm run typecheck` / `npm run lint` | Static checks. |
| `npm run build` | Production web build into `dist/`. |
| `npm run electron:dev` | Build, then open the Windows app. |
| `npm run electron:smoke` | Open the Windows app without showing it and check that the first screen renders. |
| `npm run dist:win` | Build the Windows installer into `release/`. |
| `npm run android:sync` | Build the web app and copy it into the Android project. |

The APK is built in GitHub Actions (`.github/workflows/release.yml`), not on this computer.
```

- [ ] **Step 6: Create the page, icon, placeholder entry and test setup**

`index.html`:

```html
<!doctype html>
<html lang="he" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="color-scheme" content="light dark" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>יומן משימות מוקד</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`public/favicon.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0e6b75"/>
  <path d="M18 33.5l9.5 9.5L46 22" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

`src/main.tsx` is a placeholder so the build has an entry point. Task 6 replaces it:

```tsx
import { createRoot } from 'react-dom/client'

createRoot(document.getElementById('root')!).render(<p>בבנייה</p>)
```

`src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
```

`src/test/toolchain.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

// Proves the test toolchain (Vitest, jsdom, Testing Library, jest-dom) is wired up.
describe('toolchain', () => {
  it('renders Hebrew text into jsdom and finds it again', () => {
    render(<p dir="rtl">שלום</p>)
    expect(screen.getByText('שלום')).toBeInTheDocument()
  })
})
```

- [ ] **Step 7: Install**

```bash
npm install
```

Expected: creates `package-lock.json` and `node_modules/`, and prints no `npm warn allow-scripts` lines.

- [ ] **Step 8: Verify the toolchain**

```bash
npx tsc -b
npm run lint
npm test
npm run build
```

Expected: `tsc` and `eslint` print nothing; the test run ends with `Test Files  1 passed (1)` and `Tests  1 passed (1)`; the build prints `✓ built in` and creates `dist/index.html`.

- [ ] **Step 9: Commit**

```bash
git add -A
git status --short
```

Expected: only the files listed for this task plus `package-lock.json`; nothing under `node_modules/` or `dist/`.

```bash
git commit -m "chore: scaffold the Vite, React and TypeScript project and keep the original app under public/legacy" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Runtime configuration and the secret-key guard

**Files:**
- Create: `src/env.d.ts`, `src/lib/config.ts`, `src/lib/config.test.ts`, `src/lib/envFile.test.ts`, `src/lib/supabase.ts`
- Create (not committed): `.env.local`

**Interfaces:**
- Produces:
  - `interface AppConfig { supabaseUrl: string; supabasePublishableKey: string }`
  - `class ConfigError extends Error`
  - `function loadConfig(env: Record<string, unknown>): AppConfig`
  - `function createSupabaseClient(config: AppConfig): SupabaseClient`

- [ ] **Step 1: Create the developer placeholder settings**

`.env.local` is gitignored and holds fake values, so the app, the tests and the Electron smoke test have something to load. It is never committed; the real `.env` comes in Task 13. Create `.env.local`:

```
VITE_SUPABASE_URL=https://placeholder-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_placeholder_not_a_real_key
```

- [ ] **Step 2: Declare the environment types**

`src/env.d.ts`:

```ts
/// <reference types="vite/client" />

/** Injected by vite.config.ts from package.json. */
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

- [ ] **Step 3: Write the failing tests**

`src/lib/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from './config'

const URL_OK = 'https://abcdefgh.supabase.co'
const KEY_OK = 'sb_publishable_AbCdEf1234567890'

/** Builds an unsigned JWT-shaped string, as the legacy Supabase keys are. */
function legacyKey(role: string): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, iss: 'supabase' })}.signature`
}

describe('loadConfig', () => {
  it('returns the url and the publishable key', () => {
    expect(loadConfig({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK })).toEqual({
      supabaseUrl: URL_OK,
      supabasePublishableKey: KEY_OK,
    })
  })

  it('trims whitespace and reduces the url to its origin', () => {
    const cfg = loadConfig({
      VITE_SUPABASE_URL: `  ${URL_OK}/rest/v1/  `,
      VITE_SUPABASE_PUBLISHABLE_KEY: `\n${KEY_OK} `,
    })
    expect(cfg).toEqual({ supabaseUrl: URL_OK, supabasePublishableKey: KEY_OK })
  })

  it('explains what is missing when either value is absent or blank', () => {
    expect(() => loadConfig({})).toThrow(ConfigError)
    expect(() => loadConfig({ VITE_SUPABASE_URL: URL_OK })).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/)
    expect(() => loadConfig({ VITE_SUPABASE_URL: '   ', VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK })).toThrow(
      /VITE_SUPABASE_URL/,
    )
  })

  it('rejects a url that is not valid', () => {
    expect(() => loadConfig({ VITE_SUPABASE_URL: 'not a url', VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK })).toThrow(
      ConfigError,
    )
  })

  it('refuses to talk to the server over plain http', () => {
    expect(() =>
      loadConfig({ VITE_SUPABASE_URL: 'http://abcdefgh.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK }),
    ).toThrow(/https/)
  })
})

describe('loadConfig and secret keys', () => {
  const withKey = (key: string) => () => loadConfig({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: key })

  it('refuses a secret key, because this app and its repository are public', () => {
    expect(withKey('sb_secret_AbCdEf1234567890')).toThrow(/סודי/)
  })

  it('refuses a legacy service_role key', () => {
    expect(withKey(legacyKey('service_role'))).toThrow(/סודי/)
  })

  it('never echoes the rejected key in the message', () => {
    const secret = 'sb_secret_ShouldNeverAppearAnywhere'
    try {
      withKey(secret)()
      expect.unreachable('loadConfig should have thrown')
    } catch (err) {
      expect((err as Error).message).not.toContain(secret)
    }
  })

  it('accepts a legacy anon key while those are still valid', () => {
    expect(withKey(legacyKey('anon'))().supabasePublishableKey).toBe(legacyKey('anon'))
  })

  it('does not choke on a dotted value that is not a JWT', () => {
    expect(withKey('a.b.c')().supabasePublishableKey).toBe('a.b.c')
  })
})
```

Run: `npx vitest run src/lib/config.test.ts`

Expected: FAIL, the import of `./config` cannot be resolved.

- [ ] **Step 4: Implement `loadConfig`**

`src/lib/config.ts`:

```ts
export interface AppConfig {
  supabaseUrl: string
  supabasePublishableKey: string
}

/** Raised when the build was made without usable connection settings. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

type EnvLike = Record<string, unknown>

/** True for Supabase secret keys: the "sb_secret_" format and legacy service_role JWTs. */
function isSecretKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true
  const parts = key.split('.')
  if (parts.length !== 3) return false
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as { role?: unknown }
    return payload.role === 'service_role'
  } catch {
    return false
  }
}

/** Reads and validates the Supabase connection settings from Vite's env. */
export function loadConfig(env: EnvLike): AppConfig {
  const url = String(env.VITE_SUPABASE_URL ?? '').trim()
  const key = String(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim()

  if (!url) throw new ConfigError('חסרה כתובת השרת (VITE_SUPABASE_URL).')
  if (!key) throw new ConfigError('חסר המפתח הציבורי של השרת (VITE_SUPABASE_PUBLISHABLE_KEY).')
  if (isSecretKey(key)) {
    throw new ConfigError('זה מפתח סודי של Supabase, ואסור להטמיע אותו באפליקציה. השתמשו במפתח הציבורי (Publishable key).')
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ConfigError('כתובת השרת אינה תקינה (VITE_SUPABASE_URL).')
  }
  if (parsed.protocol !== 'https:') {
    throw new ConfigError('כתובת השרת חייבת להתחיל ב-https:// (VITE_SUPABASE_URL).')
  }

  return { supabaseUrl: parsed.origin, supabasePublishableKey: key }
}
```

Run: `npx vitest run src/lib/config.test.ts`

Expected: `Tests  10 passed (10)`.

- [ ] **Step 5: Add the `.env` guard test and the Supabase client factory**

The guard test fails the build if the committed `.env` ever holds something that must not ship, such as a secret key. It is skipped while no `.env` or `.env.local` exists.

`src/lib/envFile.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { loadConfig } from './config'

// The repository is public and `.env` is committed. This fails the build if `.env`
// ever holds something that must not ship, such as a secret key.
describe('the committed .env', () => {
  it.skipIf(!import.meta.env.VITE_SUPABASE_URL)('holds a usable, public configuration', () => {
    expect(() => loadConfig(import.meta.env)).not.toThrow()
  })
})
```

`src/lib/supabase.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AppConfig } from './config'

export function createSupabaseClient(config: AppConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Sessions are never delivered through the URL (hash routing owns the fragment).
      detectSessionInUrl: false,
    },
  })
}
```

Run: `npx vitest run src/lib` and `npx tsc -b`

Expected: `Test Files  2 passed (2)`, `Tests  11 passed (11)`, and `tsc` prints nothing.

- [ ] **Step 6: Prove the guard can fail**

Temporarily put a secret key into `.env.local`, run the guard test, then put the placeholders back:

```bash
printf 'VITE_SUPABASE_URL=https://placeholder-project.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=sb_secret_oops\n' > .env.local
npx vitest run src/lib/envFile.test.ts
printf 'VITE_SUPABASE_URL=https://placeholder-project.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_placeholder_not_a_real_key\n' > .env.local
npx vitest run src/lib
```

Expected: the first run FAILS with a message containing `סודי`; the second run passes (`Tests  11 passed (11)`).

- [ ] **Step 7: Commit**

```bash
git add src/env.d.ts src/lib
git commit -m "feat: load the server settings and refuse a secret key" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Credentials and error messages

**Files:**
- Create: `src/features/auth/credentials.ts`, `src/features/auth/credentials.test.ts`, `src/features/auth/errors.ts`, `src/features/auth/errors.test.ts`

**Interfaces:**
- Produces:
  - `interface CredentialErrors { email?: string; password?: string }`
  - `function normalizeEmail(raw: string): string`
  - `function validateCredentials(email: string, password: string): CredentialErrors`
  - `const AUTH_MESSAGES` with the keys `invalidCredentials`, `banned`, `rateLimited`, `offline`, `notMember`, `sessionEnded`, `generic`
  - `function isNetworkError(err: unknown): boolean`
  - `function toHebrewAuthError(err: unknown): string`

- [ ] **Step 1: Write the failing tests**

`src/features/auth/credentials.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { normalizeEmail, validateCredentials } from './credentials'

describe('normalizeEmail', () => {
  it('trims and lowercases what phone keyboards capitalise and pad', () => {
    expect(normalizeEmail('  Dana@Example.COM \n')).toBe('dana@example.com')
  })
})

describe('validateCredentials', () => {
  it('accepts a plausible email and any non-empty password', () => {
    expect(validateCredentials('dana@example.com', 'x')).toEqual({})
  })

  it('accepts an email that only becomes valid after normalising', () => {
    expect(validateCredentials('  Dana@Example.com ', 'secret')).toEqual({})
  })

  it('asks for a missing email and a missing password separately', () => {
    expect(validateCredentials('', '')).toEqual({
      email: 'הזינו כתובת אימייל.',
      password: 'הזינו סיסמה.',
    })
  })

  it('rejects text that is not shaped like an email', () => {
    expect(validateCredentials('dana', 'secret').email).toBe('כתובת האימייל אינה תקינה.')
    expect(validateCredentials('dana@', 'secret').email).toBe('כתובת האימייל אינה תקינה.')
    expect(validateCredentials('dana@example', 'secret').email).toBe('כתובת האימייל אינה תקינה.')
  })

  it('does not trim the password, because spaces can be part of it', () => {
    expect(validateCredentials('dana@example.com', '   ')).toEqual({})
  })
})
```

`src/features/auth/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { AUTH_MESSAGES, isNetworkError, toHebrewAuthError } from './errors'

describe('toHebrewAuthError', () => {
  it('maps wrong credentials by error code', () => {
    expect(toHebrewAuthError({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(
      AUTH_MESSAGES.invalidCredentials,
    )
  })

  it('maps wrong credentials by message when the code is missing', () => {
    expect(toHebrewAuthError({ message: 'Invalid login credentials' })).toBe(AUTH_MESSAGES.invalidCredentials)
  })

  it('maps a deactivated (banned) user', () => {
    expect(toHebrewAuthError({ code: 'user_banned', message: 'User is banned' })).toBe(AUTH_MESSAGES.banned)
  })

  it('maps rate limiting by code and by status', () => {
    expect(toHebrewAuthError({ code: 'over_request_rate_limit' })).toBe(AUTH_MESSAGES.rateLimited)
    expect(toHebrewAuthError({ status: 429 })).toBe(AUTH_MESSAGES.rateLimited)
  })

  it('maps network failures to the offline message', () => {
    expect(toHebrewAuthError({ name: 'AuthRetryableFetchError', message: 'fetch failed' })).toBe(AUTH_MESSAGES.offline)
    expect(toHebrewAuthError(new TypeError('Failed to fetch'))).toBe(AUTH_MESSAGES.offline)
  })

  it('falls back to a generic message and never leaks raw error text', () => {
    const msg = toHebrewAuthError({ message: 'duplicate key value violates constraint "x_pkey"' })
    expect(msg).toBe(AUTH_MESSAGES.generic)
    expect(toHebrewAuthError(null)).toBe(AUTH_MESSAGES.generic)
    expect(toHebrewAuthError('boom')).toBe(AUTH_MESSAGES.generic)
  })
})

describe('isNetworkError', () => {
  it('recognises the shapes browsers and supabase-js produce', () => {
    expect(isNetworkError({ name: 'AuthRetryableFetchError' })).toBe(true)
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkError({ message: 'TypeError: Failed to fetch' })).toBe(true)
    expect(isNetworkError({ message: 'Load failed' })).toBe(true)
    expect(isNetworkError({ message: 'NetworkError when attempting to fetch resource.' })).toBe(true)
    expect(isNetworkError({ message: 'Network request failed' })).toBe(true)
  })

  it('does not mistake ordinary failures for network problems', () => {
    expect(isNetworkError({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(false)
    expect(isNetworkError({ message: 'permission denied for table profiles' })).toBe(false)
    expect(isNetworkError(null)).toBe(false)
    expect(isNetworkError(undefined)).toBe(false)
  })
})
```

Run: `npx vitest run src/features/auth`

Expected: FAIL, `./credentials` and `./errors` cannot be resolved.

- [ ] **Step 2: Implement**

`src/features/auth/credentials.ts`:

```ts
export interface CredentialErrors {
  email?: string
  password?: string
}

/** Phone keyboards capitalise and pad: "  Dana@Example.com " must still sign in. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateCredentials(email: string, password: string): CredentialErrors {
  const errors: CredentialErrors = {}
  const normalized = normalizeEmail(email)
  if (!normalized) errors.email = 'הזינו כתובת אימייל.'
  else if (!EMAIL_SHAPE.test(normalized)) errors.email = 'כתובת האימייל אינה תקינה.'
  if (!password) errors.password = 'הזינו סיסמה.'
  return errors
}
```

`src/features/auth/errors.ts`:

```ts
export const AUTH_MESSAGES = {
  invalidCredentials: 'האימייל או הסיסמה שגויים.',
  banned: 'המשתמש הושבת. פנו למנהל המערכת.',
  rateLimited: 'בוצעו יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.',
  offline: 'אין חיבור לשרת. בדקו את האינטרנט ונסו שוב.',
  notMember: 'המשתמש אינו פעיל או שלא הוגדר במערכת. פנו למנהל המערכת.',
  sessionEnded: 'ההפעלה הסתיימה. התחברו מחדש.',
  generic: 'לא הצלחנו להתחבר. נסו שוב.',
} as const

interface ErrorLike {
  code?: string
  name?: string
  status?: number
  message?: string
}

function asErrorLike(err: unknown): ErrorLike | null {
  return err && typeof err === 'object' ? (err as ErrorLike) : null
}

const NETWORK_MESSAGE = /failed to fetch|networkerror|network request failed|load failed|fetch failed/i

/** True when the request never reached the server (offline, DNS, server down). */
export function isNetworkError(err: unknown): boolean {
  const e = asErrorLike(err)
  if (!e) return false
  if (e.name === 'AuthRetryableFetchError') return true
  return NETWORK_MESSAGE.test(String(e.message ?? ''))
}

/** A message that is safe to show on the login screen. Raw backend text is never shown. */
export function toHebrewAuthError(err: unknown): string {
  const e = asErrorLike(err)
  if (!e) return AUTH_MESSAGES.generic
  const message = String(e.message ?? '')
  if (e.code === 'invalid_credentials' || /invalid login credentials/i.test(message)) {
    return AUTH_MESSAGES.invalidCredentials
  }
  if (e.code === 'user_banned' || /\bbanned\b/i.test(message)) return AUTH_MESSAGES.banned
  if (e.code === 'over_request_rate_limit' || e.status === 429) return AUTH_MESSAGES.rateLimited
  if (isNetworkError(e)) return AUTH_MESSAGES.offline
  return AUTH_MESSAGES.generic
}
```

Run: `npx vitest run src/features/auth && npx tsc -b`

Expected: `Test Files  2 passed (2)`, `Tests  14 passed (14)`, and `tsc` prints nothing.

- [ ] **Step 3: Commit**

```bash
git add src/features/auth
git commit -m "feat: normalise credentials and map sign-in errors to Hebrew" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Auth store and Supabase gateway

**Files:**
- Create: `src/features/auth/types.ts`, `src/test/fakeGateway.ts`, `src/features/auth/authStore.ts`, `src/features/auth/authStore.test.ts`, `src/features/auth/supabaseGateway.ts`, `src/features/auth/supabaseGateway.test.ts`

**Interfaces:**
- Consumes (Task 4): `normalizeEmail`, `AUTH_MESSAGES`, `isNetworkError`, `toHebrewAuthError`.
- Produces:
  - `type Role = 'admin' | 'employee'`
  - `interface Profile { id: string; email: string; display_name: string; role: Role; is_active: boolean; must_change_password: boolean }`
  - `interface AuthGateway { getStoredUserId(): Promise<string | null>; signIn(email: string, password: string): Promise<string>; signOut(): Promise<void>; fetchProfile(userId: string): Promise<Profile | null>; onSessionEnded(callback: () => void): () => void }`
  - `type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'unreachable'`
  - `interface AuthState { status: AuthStatus; profile: Profile | null; error: string | null; busy: boolean }`
  - `interface AuthActions { init(): Promise<void>; signIn(email: string, password: string): Promise<boolean>; signOut(): Promise<void>; retry(): Promise<void>; dispose(): void }`
  - `type AuthStore = StoreApi<AuthState & AuthActions>`; `function createAuthStore(gateway: AuthGateway): AuthStore`
  - `function createSupabaseGateway(client: SupabaseClient): AuthGateway`
  - Test helpers: `DANA` and `OWNER` (a `Profile` each), `interface FakeGateway`, `function createFakeGateway(): FakeGateway`

How the pieces behave (the tests pin all of it):
- `getStoredUserId()` rejects with a network error when a stored session has expired and the server cannot be reached. supabase-js keeps that session in storage, so the store reports `unreachable` and never signs the user out.
- `signOut` and every "no active profile" path set the local state to signed out **first** and call the backend second. That is how a late "signed out" event from the backend is told apart from a server-ended session.

- [ ] **Step 1: Write the types and the fake backend**

`src/features/auth/types.ts`:

```ts
export type Role = 'admin' | 'employee'

export interface Profile {
  id: string
  email: string
  display_name: string
  role: Role
  is_active: boolean
  must_change_password: boolean
}

/** Everything the auth store needs from the backend, so tests can fake it. */
export interface AuthGateway {
  /**
   * The user id of the locally stored session, or null when there is none.
   * Rejects with a network error when the stored session has expired and the
   * server cannot be reached to renew it (the session itself is kept).
   */
  getStoredUserId(): Promise<string | null>
  /** Resolves with the user id, or rejects with the backend's error. */
  signIn(email: string, password: string): Promise<string>
  signOut(): Promise<void>
  /** The caller's own profile row, or null when none is visible to them. */
  fetchProfile(userId: string): Promise<Profile | null>
  /** Calls back when the backend ends the session. Returns an unsubscribe function. */
  onSessionEnded(callback: () => void): () => void
}
```

`src/test/fakeGateway.ts`:

```ts
import { vi, type Mock } from 'vitest'
import type { AuthGateway, Profile } from '../features/auth/types'

export const DANA: Profile = {
  id: 'u-dana',
  email: 'dana@example.com',
  display_name: 'דנה',
  role: 'employee',
  is_active: true,
  must_change_password: false,
}

export const OWNER: Profile = {
  id: 'u-owner',
  email: 'owner@example.com',
  display_name: 'הבעלים',
  role: 'admin',
  is_active: true,
  must_change_password: false,
}

export interface FakeGateway {
  gateway: AuthGateway
  getStoredUserId: Mock<AuthGateway['getStoredUserId']>
  signIn: Mock<AuthGateway['signIn']>
  signOut: Mock<AuthGateway['signOut']>
  fetchProfile: Mock<AuthGateway['fetchProfile']>
  /** Simulates the backend ending the session (revoked token, removed user). */
  endSessionFromServer(): void
}

/** A gateway whose defaults are: no stored session, sign-in as DANA succeeds. Override per test. */
export function createFakeGateway(): FakeGateway {
  let listener: (() => void) | null = null

  const getStoredUserId = vi.fn<AuthGateway['getStoredUserId']>().mockResolvedValue(null)
  const signIn = vi.fn<AuthGateway['signIn']>().mockResolvedValue(DANA.id)
  const signOut = vi.fn<AuthGateway['signOut']>().mockResolvedValue(undefined)
  const fetchProfile = vi.fn<AuthGateway['fetchProfile']>().mockResolvedValue(DANA)

  const gateway: AuthGateway = {
    getStoredUserId,
    signIn,
    signOut,
    fetchProfile,
    onSessionEnded(callback) {
      listener = callback
      return () => {
        listener = null
      }
    },
  }

  return {
    gateway,
    getStoredUserId,
    signIn,
    signOut,
    fetchProfile,
    endSessionFromServer: () => listener?.(),
  }
}
```

- [ ] **Step 2: Write the failing store tests**

`src/features/auth/authStore.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createFakeGateway, DANA } from '../../test/fakeGateway'
import { createAuthStore } from './authStore'
import { AUTH_MESSAGES } from './errors'

function setup() {
  const fake = createFakeGateway()
  const store = createAuthStore(fake.gateway)
  return { fake, store, state: () => store.getState() }
}

const networkError = () => Object.assign(new Error('fetch failed'), { name: 'AuthRetryableFetchError' })

describe('init', () => {
  it('starts in the loading state', () => {
    expect(setup().state().status).toBe('loading')
  })

  it('becomes signed out when there is no stored session', async () => {
    const { state } = setup()
    await state().init()
    expect(state()).toMatchObject({ status: 'signedOut', profile: null, error: null })
  })

  it('restores a stored session together with the profile', async () => {
    const { fake, state } = setup()
    fake.getStoredUserId.mockResolvedValue(DANA.id)
    await state().init()
    expect(state()).toMatchObject({ status: 'signedIn', profile: DANA })
    expect(fake.fetchProfile).toHaveBeenCalledWith(DANA.id)
  })

  it('signs out a stored session whose profile is missing, and explains why', async () => {
    const { fake, state } = setup()
    fake.getStoredUserId.mockResolvedValue(DANA.id)
    fake.fetchProfile.mockResolvedValue(null)
    await state().init()
    expect(state()).toMatchObject({ status: 'signedOut', profile: null, error: AUTH_MESSAGES.notMember })
    expect(fake.signOut).toHaveBeenCalledTimes(1)
  })

  it('signs out a stored session whose profile is deactivated', async () => {
    const { fake, state } = setup()
    fake.getStoredUserId.mockResolvedValue(DANA.id)
    fake.fetchProfile.mockResolvedValue({ ...DANA, is_active: false })
    await state().init()
    expect(state()).toMatchObject({ status: 'signedOut', error: AUTH_MESSAGES.notMember })
  })

  it('keeps the stored session and reports "unreachable" when the profile cannot be fetched offline', async () => {
    const { fake, state } = setup()
    fake.getStoredUserId.mockResolvedValue(DANA.id)
    fake.fetchProfile.mockRejectedValue(new TypeError('Failed to fetch'))
    await state().init()
    expect(state().status).toBe('unreachable')
    expect(fake.signOut).not.toHaveBeenCalled()
  })

  it('keeps the stored session when an expired token cannot be renewed offline', async () => {
    const { fake, state } = setup()
    fake.getStoredUserId.mockRejectedValue(networkError())
    await state().init()
    expect(state().status).toBe('unreachable')
    expect(fake.signOut).not.toHaveBeenCalled()
  })

  it('falls back to signed out on any other start-up failure', async () => {
    const { fake, state } = setup()
    fake.getStoredUserId.mockRejectedValue(new Error('storage corrupted'))
    await state().init()
    expect(state().status).toBe('signedOut')
  })
})

describe('retry', () => {
  it('recovers from "unreachable" once the server answers', async () => {
    const { fake, state } = setup()
    fake.getStoredUserId.mockResolvedValue(DANA.id)
    fake.fetchProfile.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await state().init()
    expect(state().status).toBe('unreachable')

    await state().retry()
    expect(state()).toMatchObject({ status: 'signedIn', profile: DANA })
  })
})

describe('signIn', () => {
  it('trims and lowercases the email before sending it', async () => {
    const { fake, state } = setup()
    await state().init()
    await state().signIn('  Dana@Example.COM ', 'secret pass ')
    expect(fake.signIn).toHaveBeenCalledWith('dana@example.com', 'secret pass ')
  })

  it('signs in and loads the profile', async () => {
    const { state } = setup()
    await state().init()
    const ok = await state().signIn('dana@example.com', 'secret')
    expect(ok).toBe(true)
    expect(state()).toMatchObject({ status: 'signedIn', profile: DANA, error: null, busy: false })
  })

  it('shows a Hebrew message for wrong credentials and stays signed out', async () => {
    const { fake, state } = setup()
    await state().init()
    fake.signIn.mockRejectedValue({ code: 'invalid_credentials', message: 'Invalid login credentials' })
    const ok = await state().signIn('dana@example.com', 'wrong')
    expect(ok).toBe(false)
    expect(state()).toMatchObject({ status: 'signedOut', error: AUTH_MESSAGES.invalidCredentials, busy: false })
  })

  it('tells a deactivated user so, using the backend ban code', async () => {
    const { fake, state } = setup()
    await state().init()
    fake.signIn.mockRejectedValue({ code: 'user_banned', message: 'User is banned' })
    await state().signIn('dana@example.com', 'secret')
    expect(state().error).toBe(AUTH_MESSAGES.banned)
  })

  it('signs the user straight back out when they have no active profile', async () => {
    const { fake, state } = setup()
    await state().init()
    fake.fetchProfile.mockResolvedValue({ ...DANA, is_active: false })
    const ok = await state().signIn('dana@example.com', 'secret')
    expect(ok).toBe(false)
    expect(state()).toMatchObject({ status: 'signedOut', profile: null, error: AUTH_MESSAGES.notMember })
    expect(fake.signOut).toHaveBeenCalledTimes(1)
  })

  it('reports "unreachable" when the profile cannot be fetched right after signing in', async () => {
    const { fake, state } = setup()
    await state().init()
    fake.fetchProfile.mockRejectedValue(new TypeError('Failed to fetch'))
    await state().signIn('dana@example.com', 'secret')
    expect(state().status).toBe('unreachable')
    expect(fake.signOut).not.toHaveBeenCalled()
  })

  it('ignores a second submit while the first is still in flight', async () => {
    const { fake, state } = setup()
    await state().init()
    let release: (id: string) => void = () => {}
    fake.signIn.mockImplementation(() => new Promise<string>((resolve) => (release = resolve)))

    const first = state().signIn('dana@example.com', 'secret')
    const second = await state().signIn('dana@example.com', 'secret')
    expect(second).toBe(false)
    expect(state().busy).toBe(true)

    release(DANA.id)
    await first
    expect(fake.signIn).toHaveBeenCalledTimes(1)
    expect(state().busy).toBe(false)
  })

  it('clears an earlier error when a new attempt starts', async () => {
    const { fake, state } = setup()
    await state().init()
    fake.signIn.mockRejectedValueOnce({ code: 'invalid_credentials' })
    await state().signIn('dana@example.com', 'wrong')
    expect(state().error).not.toBeNull()

    await state().signIn('dana@example.com', 'right')
    expect(state().error).toBeNull()
  })
})

describe('signOut', () => {
  it('clears the profile and calls the backend', async () => {
    const { fake, state } = setup()
    await state().init()
    await state().signIn('dana@example.com', 'secret')
    await state().signOut()
    expect(state()).toMatchObject({ status: 'signedOut', profile: null, error: null })
    expect(fake.signOut).toHaveBeenCalledTimes(1)
  })

  it('still ends locally when the backend call fails', async () => {
    const { fake, state } = setup()
    await state().init()
    await state().signIn('dana@example.com', 'secret')
    fake.signOut.mockRejectedValue(new Error('offline'))
    await state().signOut()
    expect(state().status).toBe('signedOut')
  })

  it('does not show "session ended" for the sign-out event that the user caused', async () => {
    const { fake, state } = setup()
    await state().init()
    await state().signIn('dana@example.com', 'secret')
    await state().signOut()
    fake.endSessionFromServer()
    expect(state().error).toBeNull()
  })
})

describe('session ended by the server', () => {
  it('returns a signed-in user to the login screen with an explanation', async () => {
    const { fake, state } = setup()
    await state().init()
    await state().signIn('dana@example.com', 'secret')
    fake.endSessionFromServer()
    expect(state()).toMatchObject({ status: 'signedOut', profile: null, error: AUTH_MESSAGES.sessionEnded })
  })

  it('is ignored when nobody is signed in', async () => {
    const { fake, state } = setup()
    await state().init()
    fake.endSessionFromServer()
    expect(state()).toMatchObject({ status: 'signedOut', error: null })
  })
})

describe('dispose', () => {
  it('stops listening for server-side session ends', async () => {
    const { fake, state } = setup()
    await state().init()
    await state().signIn('dana@example.com', 'secret')
    state().dispose()
    fake.endSessionFromServer()
    expect(state().status).toBe('signedIn')
  })
})
```

Run: `npx vitest run src/features/auth/authStore.test.ts`

Expected: FAIL, `./authStore` cannot be resolved.

- [ ] **Step 3: Implement the store**

`src/features/auth/authStore.ts`:

```ts
import { createStore, type StoreApi } from 'zustand/vanilla'
import { normalizeEmail } from './credentials'
import { AUTH_MESSAGES, isNetworkError, toHebrewAuthError } from './errors'
import type { AuthGateway, Profile } from './types'

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'unreachable'

export interface AuthState {
  status: AuthStatus
  profile: Profile | null
  /** Message for the login screen (failed sign-in, ended session). */
  error: string | null
  /** True while a sign-in request is in flight. */
  busy: boolean
}

export interface AuthActions {
  /** Restores a stored session, if any. Call once at start-up. */
  init(): Promise<void>
  /** Resolves true when the user ended up signed in. */
  signIn(email: string, password: string): Promise<boolean>
  signOut(): Promise<void>
  /** Re-runs start-up after the server was unreachable. */
  retry(): Promise<void>
  /** Stops listening to the backend. */
  dispose(): void
}

export type AuthStore = StoreApi<AuthState & AuthActions>

export function createAuthStore(gateway: AuthGateway): AuthStore {
  let unsubscribe: (() => void) | null = null

  return createStore<AuthState & AuthActions>()((set, get) => {
    /** Drops the local session first, so a late "signed out" event is recognised as our own. */
    async function endSession(message: string | null) {
      set({ status: 'signedOut', profile: null, error: message })
      try {
        await gateway.signOut()
      } catch {
        // The local state is already signed out; there is nothing else to undo.
      }
    }

    /** Loads the caller's profile and settles the status. Resolves true when signed in. */
    async function enter(userId: string): Promise<boolean> {
      try {
        const profile = await gateway.fetchProfile(userId)
        if (!profile || !profile.is_active) {
          await endSession(AUTH_MESSAGES.notMember)
          return false
        }
        set({ status: 'signedIn', profile, error: null })
        return true
      } catch (err) {
        if (isNetworkError(err)) {
          // Probably just offline: keep the stored session and let the user retry.
          set({ status: 'unreachable', profile: null })
          return false
        }
        await endSession(AUTH_MESSAGES.generic)
        return false
      }
    }

    return {
      status: 'loading',
      profile: null,
      error: null,
      busy: false,

      async init() {
        unsubscribe?.()
        unsubscribe = gateway.onSessionEnded(() => {
          if (get().status === 'signedIn') {
            set({ status: 'signedOut', profile: null, error: AUTH_MESSAGES.sessionEnded })
          }
        })
        try {
          const userId = await gateway.getStoredUserId()
          if (!userId) {
            set({ status: 'signedOut', profile: null })
            return
          }
          await enter(userId)
        } catch (err) {
          set({ status: isNetworkError(err) ? 'unreachable' : 'signedOut', profile: null })
        }
      },

      async signIn(email, password) {
        if (get().busy) return false
        set({ busy: true, error: null })
        try {
          const userId = await gateway.signIn(normalizeEmail(email), password)
          return await enter(userId)
        } catch (err) {
          set({ error: toHebrewAuthError(err) })
          return false
        } finally {
          set({ busy: false })
        }
      },

      async signOut() {
        await endSession(null)
      },

      async retry() {
        set({ status: 'loading' })
        await get().init()
      },

      dispose() {
        unsubscribe?.()
        unsubscribe = null
      },
    }
  })
}
```

Run: `npx vitest run src/features/auth/authStore.test.ts`

Expected: `Tests  23 passed (23)`.

- [ ] **Step 4: Write the failing gateway tests, then implement the gateway**

`src/features/auth/supabaseGateway.test.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { DANA } from '../../test/fakeGateway'
import { createSupabaseGateway } from './supabaseGateway'

type Listener = (event: string) => void

/** Just enough of the supabase-js surface for the gateway, with call recording. */
function fakeClient(overrides: Record<string, unknown> = {}) {
  let listener: Listener | null = null
  const unsubscribe = vi.fn()
  const maybeSingle = vi.fn().mockResolvedValue({ data: DANA, error: null })
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  const auth = {
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: DANA.id } }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    onAuthStateChange: vi.fn((cb: Listener) => {
      listener = cb
      return { data: { subscription: { unsubscribe } } }
    }),
  }
  const client = { auth, from, ...overrides } as unknown as SupabaseClient
  return { client, auth, from, select, eq, maybeSingle, unsubscribe, emit: (e: string) => listener?.(e) }
}

describe('getStoredUserId', () => {
  it('is null when nothing is stored', async () => {
    const { client } = fakeClient()
    expect(await createSupabaseGateway(client).getStoredUserId()).toBeNull()
  })

  it('returns the id of the stored session', async () => {
    const f = fakeClient()
    f.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'abc' } } }, error: null })
    expect(await createSupabaseGateway(f.client).getStoredUserId()).toBe('abc')
  })

  it('rejects, instead of reporting "signed out", when the renewal failed because of the network', async () => {
    const f = fakeClient()
    const err = Object.assign(new Error('fetch failed'), { name: 'AuthRetryableFetchError' })
    f.auth.getSession.mockResolvedValue({ data: { session: null }, error: err })
    await expect(createSupabaseGateway(f.client).getStoredUserId()).rejects.toBe(err)
  })

  it('reports signed out when the session is genuinely gone', async () => {
    const f = fakeClient()
    f.auth.getSession.mockResolvedValue({ data: { session: null }, error: { code: 'refresh_token_not_found' } })
    expect(await createSupabaseGateway(f.client).getStoredUserId()).toBeNull()
  })
})

describe('signIn', () => {
  it('passes the credentials through and returns the user id', async () => {
    const f = fakeClient()
    expect(await createSupabaseGateway(f.client).signIn('a@b.co', 'pw')).toBe(DANA.id)
    expect(f.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.co', password: 'pw' })
  })

  it('rejects with the backend error untouched', async () => {
    const f = fakeClient()
    const err = { code: 'invalid_credentials' }
    f.auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: err })
    await expect(createSupabaseGateway(f.client).signIn('a@b.co', 'pw')).rejects.toBe(err)
  })
})

describe('fetchProfile', () => {
  it("selects only the caller's own row by id", async () => {
    const f = fakeClient()
    expect(await createSupabaseGateway(f.client).fetchProfile('u1')).toEqual(DANA)
    expect(f.from).toHaveBeenCalledWith('profiles')
    expect(f.eq).toHaveBeenCalledWith('id', 'u1')
  })

  it('is null when no row is visible', async () => {
    const f = fakeClient()
    f.maybeSingle.mockResolvedValue({ data: null, error: null })
    expect(await createSupabaseGateway(f.client).fetchProfile('u1')).toBeNull()
  })

  it('rejects with the backend error', async () => {
    const f = fakeClient()
    const err = { message: 'TypeError: Failed to fetch' }
    f.maybeSingle.mockResolvedValue({ data: null, error: err })
    await expect(createSupabaseGateway(f.client).fetchProfile('u1')).rejects.toBe(err)
  })
})

describe('signOut', () => {
  it('rejects when the backend reports an error', async () => {
    const f = fakeClient()
    f.auth.signOut.mockResolvedValue({ error: new Error('x') })
    await expect(createSupabaseGateway(f.client).signOut()).rejects.toThrow('x')
  })
})

describe('onSessionEnded', () => {
  it('fires only for SIGNED_OUT and can be unsubscribed', () => {
    const f = fakeClient()
    const cb = vi.fn()
    const off = createSupabaseGateway(f.client).onSessionEnded(cb)
    f.emit('TOKEN_REFRESHED')
    f.emit('SIGNED_IN')
    expect(cb).not.toHaveBeenCalled()
    f.emit('SIGNED_OUT')
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    expect(f.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
```

Run: `npx vitest run src/features/auth/supabaseGateway.test.ts`

Expected: FAIL, `./supabaseGateway` cannot be resolved.

`src/features/auth/supabaseGateway.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { isNetworkError } from './errors'
import type { AuthGateway, Profile } from './types'

const PROFILE_COLUMNS = 'id, email, display_name, role, is_active, must_change_password'

/** Adapts supabase-js to the small interface the auth store depends on. */
export function createSupabaseGateway(client: SupabaseClient): AuthGateway {
  return {
    async getStoredUserId() {
      const { data, error } = await client.auth.getSession()
      // An expired token that could not be renewed because we are offline leaves the
      // session in storage. Surface that, so it is not mistaken for "signed out".
      if (error && isNetworkError(error)) throw error
      return data.session?.user.id ?? null
    },

    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password })
      if (error) throw error
      return data.user.id
    },

    async signOut() {
      const { error } = await client.auth.signOut()
      if (error) throw error
    },

    async fetchProfile(userId) {
      const { data, error } = await client
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .eq('id', userId)
        .maybeSingle()
      if (error) throw error
      return (data as Profile | null) ?? null
    },

    onSessionEnded(callback) {
      const { data } = client.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') callback()
      })
      return () => data.subscription.unsubscribe()
    },
  }
}
```

Run: `npm test && npx tsc -b`

Expected: `Test Files  7 passed (7)`, `Tests  60 passed (60)`, and `tsc` prints nothing.

- [ ] **Step 5: Prove the "unreachable" test can fail**

```bash
cp src/features/auth/authStore.ts /tmp/authStore.bak
sed -i "s/set({ status: 'unreachable', profile: null })/await endSession(AUTH_MESSAGES.generic)/" src/features/auth/authStore.ts
npx vitest run src/features/auth/authStore.test.ts
cp /tmp/authStore.bak src/features/auth/authStore.ts
npx vitest run src/features/auth/authStore.test.ts
```

Expected: the first run reports `3 failed` (the "unreachable" tests); after restoring, `Tests  23 passed (23)`.

- [ ] **Step 6: Commit**

```bash
git add src/features/auth src/test/fakeGateway.ts
git commit -m "feat: add the auth store and the Supabase gateway" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Screens, routing and styles

**Files:**
- Create: `src/features/auth/authContext.ts`, `src/features/auth/AuthProvider.tsx`, `src/features/auth/StatusScreens.tsx`, `src/features/auth/routes.tsx`, `src/features/auth/LoginPage.tsx`, `src/features/auth/LoginPage.test.tsx`, `src/features/home/HomePage.tsx`, `src/features/home/HomePage.test.tsx`, `src/features/config/ConfigErrorScreen.tsx`, `src/features/config/ConfigErrorScreen.test.tsx`, `src/App.tsx`, `src/App.test.tsx`, `src/test/renderApp.tsx`, `src/styles/fonts.ts`, `src/styles/tokens.css`, `src/styles/base.css`
- Modify (replace): `src/main.tsx`
- Delete: `src/test/toolchain.test.tsx`

**Interfaces:**
- Consumes (Tasks 3 to 5): `loadConfig`, `ConfigError`, `createSupabaseClient`, `createAuthStore`, `AuthStore`, `AuthState`, `AuthActions`, `createSupabaseGateway`, `validateCredentials`, `CredentialErrors`, `AUTH_MESSAGES`, `createFakeGateway`, `DANA`, `OWNER`.
- Produces:
  - `function useAuth<T>(selector: (state: AuthState & AuthActions) => T): T` and `AuthContext` (in `authContext.ts`)
  - `function AuthProvider(props: { store: AuthStore; children: ReactNode })`
  - `SplashScreen`, `UnreachableScreen`, `AuthShell`, `RequireAuth`, `LoginPage`
  - `function HomePage(props: { serverHost: string })`
  - `function ConfigErrorScreen(props: { message: string })`
  - `function App(props: { serverHost: string })`
  - Test helper `renderApp(options?: { path?: string; configure?: (fake: FakeGateway) => void; init?: boolean })` returning `{ fake, store, ready }`

Routing: `AuthShell` shows the splash while `loading` and the retry screen while `unreachable`. `RequireAuth` sends `signedOut` visitors to `/login`. `LoginPage` sends `signedIn` visitors to `/`.

- [ ] **Step 1: Write the failing tests**

`src/test/renderApp.tsx`:

```tsx
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { App } from '../App'
import { AuthProvider } from '../features/auth/AuthProvider'
import { createAuthStore } from '../features/auth/authStore'
import { createFakeGateway, type FakeGateway } from './fakeGateway'

interface RenderOptions {
  /** Initial route, default "/". */
  path?: string
  /** Adjust the fake backend before the store starts. */
  configure?: (fake: FakeGateway) => void
  /** Set to false to leave the store in its initial "loading" state. */
  init?: boolean
}

/** Renders the whole app against a fake backend. `ready` resolves when start-up has settled. */
export function renderApp(options: RenderOptions = {}) {
  const fake = createFakeGateway()
  options.configure?.(fake)
  const store = createAuthStore(fake.gateway)
  const ready = options.init === false ? Promise.resolve() : store.getState().init()
  render(
    <AuthProvider store={store}>
      <MemoryRouter initialEntries={[options.path ?? '/']}>
        <App serverHost="test.supabase.co" />
      </MemoryRouter>
    </AuthProvider>,
  )
  return { fake, store, ready }
}
```

`src/features/auth/LoginPage.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { DANA, type FakeGateway } from '../../test/fakeGateway'
import { renderApp } from '../../test/renderApp'
import { AUTH_MESSAGES } from './errors'

async function openLogin(configure?: (fake: FakeGateway) => void) {
  const app = renderApp({ path: '/login', configure })
  await app.ready
  await screen.findByRole('button', { name: 'כניסה' })
  return { ...app, user: userEvent.setup() }
}

describe('LoginPage', () => {
  it('shows the Hebrew login form', async () => {
    await openLogin()
    expect(screen.getByRole('heading', { name: 'יומן משימות מוקד' })).toBeInTheDocument()
    expect(screen.getByLabelText('אימייל')).toBeInTheDocument()
    expect(screen.getByLabelText('סיסמה')).toBeInTheDocument()
  })

  it('configures the fields for phone keyboards and password managers', async () => {
    await openLogin()
    const email = screen.getByLabelText('אימייל')
    expect(email).toHaveAttribute('type', 'email')
    expect(email).toHaveAttribute('autocomplete', 'username')
    expect(email).toHaveAttribute('inputmode', 'email')
    expect(email).toHaveAttribute('autocapitalize', 'none')
    expect(email).toHaveAttribute('autocorrect', 'off')
    expect(email).toHaveAttribute('dir', 'ltr')
    const password = screen.getByLabelText('סיסמה')
    expect(password).toHaveAttribute('type', 'password')
    expect(password).toHaveAttribute('autocomplete', 'current-password')
    expect(password).toHaveAttribute('dir', 'ltr')
  })

  it('asks for both fields, focuses the first, and does not call the server', async () => {
    const { fake, user } = await openLogin()
    await user.click(screen.getByRole('button', { name: 'כניסה' }))
    expect(screen.getByText('הזינו כתובת אימייל.')).toBeInTheDocument()
    expect(screen.getByText('הזינו סיסמה.')).toBeInTheDocument()
    expect(screen.getByLabelText('אימייל')).toHaveFocus()
    expect(screen.getByLabelText('אימייל')).toBeInvalid()
    expect(fake.signIn).not.toHaveBeenCalled()
  })

  it('rejects an email that is not shaped like one', async () => {
    const { fake, user } = await openLogin()
    await user.type(screen.getByLabelText('אימייל'), 'dana')
    await user.type(screen.getByLabelText('סיסמה'), 'secret')
    await user.click(screen.getByRole('button', { name: 'כניסה' }))
    expect(screen.getByText('כתובת האימייל אינה תקינה.')).toBeInTheDocument()
    expect(fake.signIn).not.toHaveBeenCalled()
  })

  it('signs in with a normalised email when Enter is pressed, then shows the home screen', async () => {
    const { fake, user } = await openLogin()
    await user.type(screen.getByLabelText('אימייל'), '  Dana@Example.com ')
    await user.type(screen.getByLabelText('סיסמה'), 'secret{Enter}')
    expect(await screen.findByRole('heading', { name: 'שלום, דנה' })).toBeInTheDocument()
    expect(fake.signIn).toHaveBeenCalledWith('dana@example.com', 'secret')
  })

  it('shows the server error and keeps the form usable', async () => {
    const { user } = await openLogin((fake) => fake.signIn.mockRejectedValue({ code: 'invalid_credentials' }))
    await user.type(screen.getByLabelText('אימייל'), 'dana@example.com')
    await user.type(screen.getByLabelText('סיסמה'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'כניסה' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.invalidCredentials)
    expect(screen.getByRole('button', { name: 'כניסה' })).toBeEnabled()
    expect(screen.getByLabelText('אימייל')).toHaveValue('dana@example.com')
  })

  it('disables the button while signing in and sends a single request for a double click', async () => {
    let release: (id: string) => void = () => {}
    const { fake, user } = await openLogin((f) =>
      f.signIn.mockImplementation(() => new Promise<string>((resolve) => (release = resolve))),
    )
    await user.type(screen.getByLabelText('אימייל'), 'dana@example.com')
    await user.type(screen.getByLabelText('סיסמה'), 'secret')
    await user.dblClick(screen.getByRole('button', { name: 'כניסה' }))
    expect(await screen.findByRole('button', { name: 'מתחבר…' })).toBeDisabled()

    release(DANA.id)
    await screen.findByRole('heading', { name: 'שלום, דנה' })
    expect(fake.signIn).toHaveBeenCalledTimes(1)
  })

  it('sends a visitor with a stored session straight to the home screen', async () => {
    renderApp({ path: '/login', configure: (fake) => fake.getStoredUserId.mockResolvedValue(DANA.id) })
    expect(await screen.findByRole('heading', { name: 'שלום, דנה' })).toBeInTheDocument()
  })
})
```

`src/features/home/HomePage.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { DANA, OWNER } from '../../test/fakeGateway'
import { renderApp } from '../../test/renderApp'

describe('HomePage', () => {
  it('greets the user and shows the role, app version and server', async () => {
    renderApp({ configure: (fake) => fake.getStoredUserId.mockResolvedValue(DANA.id) })
    expect(await screen.findByRole('heading', { name: 'שלום, דנה' })).toBeInTheDocument()
    expect(screen.getByText('תפקיד: עובד')).toBeInTheDocument()
    expect(screen.getByText('test.supabase.co')).toBeInTheDocument()
    expect(screen.getByText(__APP_VERSION__)).toBeInTheDocument()
  })

  it('labels an admin as a manager', async () => {
    renderApp({
      configure: (fake) => {
        fake.getStoredUserId.mockResolvedValue(OWNER.id)
        fake.fetchProfile.mockResolvedValue(OWNER)
      },
    })
    expect(await screen.findByText('תפקיד: מנהל')).toBeInTheDocument()
  })

  it('signs out and returns to the login screen without an error message', async () => {
    const { fake } = renderApp({ configure: (f) => f.getStoredUserId.mockResolvedValue(DANA.id) })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'התנתקות' }))
    expect(await screen.findByRole('button', { name: 'כניסה' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(fake.signOut).toHaveBeenCalledTimes(1)
  })
})
```

`src/App.test.tsx`:

```tsx
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AUTH_MESSAGES } from './features/auth/errors'
import { DANA } from './test/fakeGateway'
import { renderApp } from './test/renderApp'

describe('App routing', () => {
  it('shows a loading screen until start-up has settled', () => {
    renderApp({ init: false })
    expect(screen.getByRole('status')).toHaveTextContent('טוען…')
    expect(screen.queryByLabelText('אימייל')).not.toBeInTheDocument()
  })

  it('sends a signed-out visitor from the home route to the login screen', async () => {
    const { ready } = renderApp({ path: '/' })
    await ready
    expect(await screen.findByRole('button', { name: 'כניסה' })).toBeInTheDocument()
  })

  it('redirects unknown routes to the home screen', async () => {
    renderApp({ path: '/nope', configure: (fake) => fake.getStoredUserId.mockResolvedValue(DANA.id) })
    expect(await screen.findByRole('heading', { name: 'שלום, דנה' })).toBeInTheDocument()
  })

  it('keeps the stored session when the server cannot be reached, and recovers on retry', async () => {
    const { fake } = renderApp({
      configure: (f) => {
        f.getStoredUserId.mockResolvedValue(DANA.id)
        f.fetchProfile.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      },
    })
    expect(await screen.findByRole('heading', { name: 'אין חיבור לשרת' })).toBeInTheDocument()
    expect(screen.queryByLabelText('אימייל')).not.toBeInTheDocument()
    expect(fake.signOut).not.toHaveBeenCalled()

    await userEvent.setup().click(screen.getByRole('button', { name: 'נסו שוב' }))
    expect(await screen.findByRole('heading', { name: 'שלום, דנה' })).toBeInTheDocument()
  })

  it('returns to the login screen with a message when the server ends the session', async () => {
    const { fake } = renderApp({ configure: (f) => f.getStoredUserId.mockResolvedValue(DANA.id) })
    await screen.findByRole('heading', { name: 'שלום, דנה' })

    act(() => fake.endSessionFromServer())

    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.sessionEnded)
    expect(screen.getByRole('button', { name: 'כניסה' })).toBeInTheDocument()
  })

  it('explains why a stored session without an active profile was dropped', async () => {
    renderApp({
      configure: (f) => {
        f.getStoredUserId.mockResolvedValue(DANA.id)
        f.fetchProfile.mockResolvedValue({ ...DANA, is_active: false })
      },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.notMember)
  })
})
```

`src/features/config/ConfigErrorScreen.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConfigErrorScreen } from './ConfigErrorScreen'

describe('ConfigErrorScreen', () => {
  it('says the app is not configured, shows what is missing, and points to the guide', () => {
    render(<ConfigErrorScreen message="חסרה כתובת השרת (VITE_SUPABASE_URL)." />)
    expect(screen.getByRole('heading', { name: 'האפליקציה עדיין לא הוגדרה' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('VITE_SUPABASE_URL')
    expect(screen.getByText('docs/setup-he.md')).toBeInTheDocument()
  })
})
```

Remove the toolchain sanity test, which has done its job:

```bash
git rm -q src/test/toolchain.test.tsx
npx vitest run src/App.test.tsx
```

Expected: FAIL, `./App` cannot be resolved.

- [ ] **Step 2: Implement the auth plumbing and the screens**

`src/features/auth/authContext.ts`:

```ts
import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { AuthActions, AuthState, AuthStore } from './authStore'

export const AuthContext = createContext<AuthStore | null>(null)

export function useAuth<T>(selector: (state: AuthState & AuthActions) => T): T {
  const store = useContext(AuthContext)
  if (!store) throw new Error('useAuth must be used inside <AuthProvider>')
  return useStore(store, selector)
}
```

`src/features/auth/AuthProvider.tsx`:

```tsx
import type { ReactNode } from 'react'
import { AuthContext } from './authContext'
import type { AuthStore } from './authStore'

export function AuthProvider({ store, children }: { store: AuthStore; children: ReactNode }) {
  return <AuthContext value={store}>{children}</AuthContext>
}
```

`src/features/auth/StatusScreens.tsx`:

```tsx
import { useAuth } from './authContext'

export function SplashScreen() {
  return (
    <main className="auth-screen">
      <p className="sub" role="status">
        טוען…
      </p>
    </main>
  )
}

export function UnreachableScreen() {
  const retry = useAuth((s) => s.retry)
  return (
    <main className="auth-screen">
      <section className="card">
        <h1 className="display">אין חיבור לשרת</h1>
        <p>לא הצלחנו להגיע לשרת. בדקו את החיבור לאינטרנט ונסו שוב. ההתחברות שלכם נשמרה.</p>
        <button type="button" className="btn primary" onClick={() => void retry()}>
          נסו שוב
        </button>
      </section>
    </main>
  )
}
```

`src/features/auth/routes.tsx`:

```tsx
import { Navigate, Outlet } from 'react-router'
import { useAuth } from './authContext'
import { SplashScreen, UnreachableScreen } from './StatusScreens'

/** Shows a splash or "unreachable" screen until the auth state is settled. */
export function AuthShell() {
  const status = useAuth((s) => s.status)
  if (status === 'loading') return <SplashScreen />
  if (status === 'unreachable') return <UnreachableScreen />
  return <Outlet />
}

/** Sends signed-out visitors to the login screen. */
export function RequireAuth() {
  const status = useAuth((s) => s.status)
  if (status === 'signedOut') return <Navigate to="/login" replace />
  return <Outlet />
}
```

`src/features/auth/LoginPage.tsx`:

```tsx
import { useId, useRef, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { useAuth } from './authContext'
import { validateCredentials, type CredentialErrors } from './credentials'

export function LoginPage() {
  const status = useAuth((s) => s.status)
  const busy = useAuth((s) => s.busy)
  const serverError = useAuth((s) => s.error)
  const signIn = useAuth((s) => s.signIn)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<CredentialErrors>({})
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const emailId = useId()
  const passwordId = useId()
  const emailErrorId = useId()
  const passwordErrorId = useId()

  if (status === 'signedIn') return <Navigate to="/" replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const errors = validateCredentials(email, password)
    setFieldErrors(errors)
    if (errors.email) {
      emailRef.current?.focus()
      return
    }
    if (errors.password) {
      passwordRef.current?.focus()
      return
    }
    await signIn(email, password)
  }

  return (
    <main className="auth-screen">
      <form className="card login" onSubmit={(e) => void onSubmit(e)} noValidate>
        <h1 className="display">יומן משימות מוקד</h1>
        <p className="sub">התחברו עם המשתמש האישי שלכם</p>

        {serverError && (
          <p role="alert" className="alert">
            {serverError}
          </p>
        )}

        <div className="field">
          <label htmlFor={emailId}>אימייל</label>
          <input
            id={emailId}
            ref={emailRef}
            name="email"
            type="email"
            dir="ltr"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? emailErrorId : undefined}
          />
          {fieldErrors.email && (
            <p id={emailErrorId} className="field-error">
              {fieldErrors.email}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor={passwordId}>סיסמה</label>
          <input
            id={passwordId}
            ref={passwordRef}
            name="password"
            type="password"
            dir="ltr"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={fieldErrors.password ? passwordErrorId : undefined}
          />
          {fieldErrors.password && (
            <p id={passwordErrorId} className="field-error">
              {fieldErrors.password}
            </p>
          )}
        </div>

        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'מתחבר…' : 'כניסה'}
        </button>
      </form>
    </main>
  )
}
```

`src/features/home/HomePage.tsx`:

```tsx
import { useAuth } from '../auth/authContext'

const ROLE_LABEL = { admin: 'מנהל', employee: 'עובד' } as const

export function HomePage({ serverHost }: { serverHost: string }) {
  const profile = useAuth((s) => s.profile)
  const signOut = useAuth((s) => s.signOut)
  if (!profile) return null

  return (
    <main className="shell">
      <header className="shell-bar">
        <h1 className="display">יומן משימות מוקד</h1>
        <button type="button" className="btn" onClick={() => void signOut()}>
          התנתקות
        </button>
      </header>

      <section className="card">
        <h2>שלום, {profile.display_name}</h2>
        <p className="sub">תפקיד: {ROLE_LABEL[profile.role]}</p>
        <p>השלד של האפליקציה פועל. מסך היום, המשימות והיומן ייבנו בשלבים הבאים.</p>
      </section>

      <footer className="sub">
        גרסה <span className="num">{__APP_VERSION__}</span> · שרת: <span className="num">{serverHost}</span>
      </footer>
    </main>
  )
}
```

`src/features/config/ConfigErrorScreen.tsx`:

```tsx
export function ConfigErrorScreen({ message }: { message: string }) {
  return (
    <main className="auth-screen">
      <section className="card">
        <h1 className="display">האפליקציה עדיין לא הוגדרה</h1>
        <p role="alert" className="alert">
          {message}
        </p>
        <p className="sub">
          פרטי החיבור לשרת נקבעים בזמן הבנייה בקובץ <code className="num">.env</code>. ההוראות נמצאות ב-
          <code className="num">docs/setup-he.md</code>.
        </p>
      </section>
    </main>
  )
}
```

`src/App.tsx`:

```tsx
import { Navigate, Route, Routes } from 'react-router'
import { LoginPage } from './features/auth/LoginPage'
import { AuthShell, RequireAuth } from './features/auth/routes'
import { HomePage } from './features/home/HomePage'

export function App({ serverHost }: { serverHost: string }) {
  return (
    <Routes>
      <Route element={<AuthShell />}>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route index element={<HomePage serverHost={serverHost} />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
```

- [ ] **Step 3: Add the styles and the real entry point**

`src/styles/fonts.ts`:

```ts
// Fonts are bundled with the app (no request to Google), so the Android app
// and the Windows app look the same offline.
import '@fontsource/ibm-plex-sans-hebrew/hebrew-400.css'
import '@fontsource/ibm-plex-sans-hebrew/hebrew-500.css'
import '@fontsource/ibm-plex-sans-hebrew/hebrew-600.css'
import '@fontsource/ibm-plex-sans-hebrew/latin-400.css'
import '@fontsource/ibm-plex-sans-hebrew/latin-500.css'
import '@fontsource/ibm-plex-sans-hebrew/latin-600.css'
import '@fontsource/secular-one/hebrew-400.css'
import '@fontsource/secular-one/latin-400.css'
```

`src/styles/tokens.css`:

```css
/* Design tokens carried over from the original "יומן משימות מוקד" app. */
:root {
  color-scheme: light;
  --bg: #eef2f3;
  --surface: #fbfcfc;
  --sunken: #e2e9eb;
  --line: #cdd7da;
  --fg: #14262e;
  --muted: #566a72;
  --accent: #0e6b75;
  --accent-fg: #ffffff;
  --accent-soft: #d5eaec;
  --warn: #a65f00;
  --warn-soft: #fbedd3;
  --crit: #b53026;
  --crit-soft: #f9dedb;
  --ok: #1c7746;
  --ok-soft: #d8efe1;
  --font-display: 'Secular One', 'Rubik', 'Arial Hebrew', system-ui, sans-serif;
  --font-body: 'IBM Plex Sans Hebrew', 'Heebo', 'Segoe UI', 'Arial Hebrew', system-ui, -apple-system, Arial, sans-serif;
  --r: 8px;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    color-scheme: dark;
    --bg: #0e171b;
    --surface: #16232a;
    --sunken: #0a1215;
    --line: #2b3d45;
    --fg: #e2ecee;
    --muted: #95a8af;
    --accent: #56c2ca;
    --accent-fg: #06262a;
    --accent-soft: #173b40;
    --warn: #f0b04a;
    --warn-soft: #3a2c12;
    --crit: #f2867c;
    --crit-soft: #3d1b18;
    --ok: #6fd29a;
    --ok-soft: #143424;
  }
}

:root[data-theme='dark'] {
  color-scheme: dark;
  --bg: #0e171b;
  --surface: #16232a;
  --sunken: #0a1215;
  --line: #2b3d45;
  --fg: #e2ecee;
  --muted: #95a8af;
  --accent: #56c2ca;
  --accent-fg: #06262a;
  --accent-soft: #173b40;
  --warn: #f0b04a;
  --warn-soft: #3a2c12;
  --crit: #f2867c;
  --crit-soft: #3d1b18;
  --ok: #6fd29a;
  --ok-soft: #143424;
}
```

`src/styles/base.css`:

```css
*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  -webkit-text-size-adjust: 100%;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 1.5;
}

h1,
h2,
h3,
p {
  margin: 0;
}

button,
input {
  font: inherit;
}

code {
  font-size: 12px;
  background: var(--sunken);
  padding: 1px 5px;
  border-radius: 4px;
}

.display {
  font-family: var(--font-display);
  font-weight: 400;
}

.sub {
  color: var(--muted);
  font-size: 13px;
}

/* Phone numbers, versions and hostnames stay left-to-right inside Hebrew text. */
.num {
  font-variant-numeric: tabular-nums;
  direction: ltr;
  unicode-bidi: isolate;
}

.auth-screen {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom));
}

.card {
  width: min(100%, 420px);
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
}

.login h1 {
  font-size: 26px;
  line-height: 1.2;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field label {
  font-size: 13px;
  color: var(--muted);
}

.field input {
  min-width: 0;
  padding: 10px 12px;
  font-size: 16px;
  color: var(--fg);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 6px;
}

.field input[aria-invalid='true'] {
  border-color: var(--crit);
}

.field-error {
  color: var(--crit);
  font-size: 13px;
}

.alert {
  padding: 10px 12px;
  font-size: 14px;
  background: var(--crit-soft);
  border: 1px solid var(--crit);
  border-radius: var(--r);
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 9px 16px;
  color: var(--fg);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r);
  cursor: pointer;
}

.btn:hover {
  border-color: var(--muted);
}

.btn.primary {
  color: var(--accent-fg);
  background: var(--accent);
  border-color: transparent;
  font-weight: 600;
}

.btn[disabled] {
  opacity: 0.6;
  cursor: not-allowed;
}

button:focus-visible,
input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.shell {
  max-width: 960px;
  margin-inline: auto;
  padding: max(16px, env(safe-area-inset-top)) 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.shell .card {
  width: 100%;
}

.shell-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.shell-bar h1 {
  font-size: 22px;
}
```

Replace `src/main.tsx`:

`src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import { App } from './App'
import { AuthProvider } from './features/auth/AuthProvider'
import { createAuthStore } from './features/auth/authStore'
import { createSupabaseGateway } from './features/auth/supabaseGateway'
import { ConfigErrorScreen } from './features/config/ConfigErrorScreen'
import { ConfigError, loadConfig } from './lib/config'
import { createSupabaseClient } from './lib/supabase'
import './styles/fonts'
import './styles/tokens.css'
import './styles/base.css'

const root = createRoot(document.getElementById('root')!)

try {
  const config = loadConfig(import.meta.env)
  const store = createAuthStore(createSupabaseGateway(createSupabaseClient(config)))
  void store.getState().init()
  root.render(
    <StrictMode>
      <AuthProvider store={store}>
        <HashRouter>
          <App serverHost={new URL(config.supabaseUrl).host} />
        </HashRouter>
      </AuthProvider>
    </StrictMode>,
  )
} catch (err) {
  if (!(err instanceof ConfigError)) throw err
  root.render(
    <StrictMode>
      <ConfigErrorScreen message={err.message} />
    </StrictMode>,
  )
}
```

- [ ] **Step 4: Run everything**

```bash
npm test
npx tsc -b
npm run lint
npm run build
```

Expected: `Test Files  10 passed (10)` and `Tests  77 passed (77)`; `tsc` and `eslint` print nothing; the build prints `✓ built in`.

- [ ] **Step 5: Look at it (recommended)**

Start the dev server in the background, open the page in the built-in browser, take a screenshot, then stop the server:

```bash
npm run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173/` and check: a centred card titled "יומן משימות מוקד", right-aligned Hebrew labels, a teal "כניסה" button, and the dark palette if the computer is in dark mode. Submitting empty fields shows two Hebrew messages. Stop the server afterwards.

- [ ] **Step 6: Commit**

```bash
git add -A
git status --short
git commit -m "feat: add the login screen, the signed-in home screen and routing" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected from `git status --short` before committing: new files under `src/` and the deleted toolchain test only.

---

### Task 7: Database migration `0001_profiles.sql`

**Files:**
- Create: `supabase/tests/helpers/pg.ts`, `supabase/tests/0001_profiles.test.ts`, `supabase/migrations/0001_profiles.sql`

**Interfaces:**
- Produces (SQL): table `public.profiles`; functions `public.is_member()`, `public.is_admin()`; trigger `on_auth_user_created` calling `public.handle_new_user()`; policy `profiles_select_members`. M1 and later migrations build their policies on `is_member()` and `is_admin()`.
- Produces (tests): `createDb(seed?)`, `as(db, actor, fn)`, `addUser(db, email, opts?)`, `type Actor`.
- The owner pastes this migration into the Supabase SQL editor (see `docs/setup-he.md`), so it must run unchanged on Supabase.

The tests run the migration inside PGlite, which is real Postgres compiled to WebAssembly. A small stub stands in for the two Supabase pieces the migration touches: the `auth.users` table with `auth.uid()`, and the `anon` and `authenticated` roles.

- [ ] **Step 1: Write the helper and the failing tests**

`supabase/tests/helpers/pg.ts`:

```ts
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'migrations')

/** The few pieces of Supabase that the migrations depend on, stubbed for PGlite. */
const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema public to anon, authenticated;
`

/**
 * A fresh in-memory Postgres with the Supabase stub and every migration applied.
 * `seed` runs before the migrations, to model data that existed beforehand.
 */
export async function createDb(seed?: (db: PGlite) => Promise<void>): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(SUPABASE_STUB)
  await seed?.(db)
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  for (const f of files) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  }
  return db
}

export type Actor = { id: string } | 'anon'

/** Runs `fn` with the connection acting as the given Supabase role, then restores superuser. */
export async function as<T>(db: PGlite, actor: Actor, fn: () => Promise<T>): Promise<T> {
  const sub = actor === 'anon' ? '' : actor.id
  const role = actor === 'anon' ? 'anon' : 'authenticated'
  await db.exec(`set role ${role}`)
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub])
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
  }
}

export async function addUser(
  db: PGlite,
  email: string,
  opts: { meta?: Record<string, unknown>; appMeta?: Record<string, unknown> } = {},
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data, raw_app_meta_data)
     values ($1, $2::jsonb, $3::jsonb) returning id`,
    [email, JSON.stringify(opts.meta ?? {}), JSON.stringify(opts.appMeta ?? {})],
  )
  return r.rows[0].id
}
```

`supabase/tests/0001_profiles.test.ts`:

```ts
// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { addUser, as, createDb } from './helpers/pg'

let db: PGlite

beforeEach(async () => {
  db = await createDb()
})

async function profileOf(id: string) {
  const r = await db.query('select * from public.profiles where id = $1', [id])
  return r.rows[0] as Record<string, unknown> | undefined
}

describe('handle_new_user', () => {
  it('makes the very first user an admin without a forced password change', async () => {
    const id = await addUser(db, 'owner@example.com')
    expect(await profileOf(id)).toMatchObject({
      email: 'owner@example.com',
      display_name: 'owner',
      role: 'admin',
      is_active: true,
      must_change_password: false,
    })
  })

  it('makes later users employees who must change their password', async () => {
    await addUser(db, 'owner@example.com')
    const id = await addUser(db, 'dana@example.com', { meta: { display_name: ' דנה ' } })
    expect(await profileOf(id)).toMatchObject({
      display_name: 'דנה',
      role: 'employee',
      must_change_password: true,
    })
  })

  it('honours app_metadata.role for later users and ignores unknown roles', async () => {
    await addUser(db, 'owner@example.com')
    const boss = await addUser(db, 'boss@example.com', { appMeta: { role: 'admin' } })
    const odd = await addUser(db, 'odd@example.com', { appMeta: { role: 'root' } })
    expect(await profileOf(boss)).toMatchObject({ role: 'admin' })
    expect(await profileOf(odd)).toMatchObject({ role: 'employee' })
  })

  it('never takes the role from user-editable user_metadata', async () => {
    await addUser(db, 'owner@example.com')
    const id = await addUser(db, 'sneaky@example.com', { meta: { role: 'admin' } })
    expect(await profileOf(id)).toMatchObject({ role: 'employee' })
  })

  it('rejects a second user whose display name matches case-insensitively', async () => {
    await addUser(db, 'dana@example.com')
    await expect(addUser(db, 'DANA@other.com')).rejects.toThrow(/duplicate key/i)
  })

  it('removes the profile when the auth user is deleted', async () => {
    const id = await addUser(db, 'owner@example.com')
    await db.query('delete from auth.users where id = $1', [id])
    expect(await profileOf(id)).toBeUndefined()
  })
})

describe('users that existed before the migration ran', () => {
  it('get a profile each, and the oldest becomes the admin', async () => {
    const seeded = await createDb(async (d) => {
      await d.exec(`
        insert into auth.users (id, email, created_at) values
          ('00000000-0000-0000-0000-000000000002', 'second@example.com', '2026-01-02'),
          ('00000000-0000-0000-0000-000000000001', 'first@example.com', '2026-01-01')`)
    })
    const r = await seeded.query('select email, role, must_change_password from public.profiles order by email')
    expect(r.rows).toEqual([
      { email: 'first@example.com', role: 'admin', must_change_password: false },
      { email: 'second@example.com', role: 'employee', must_change_password: true },
    ])
  })

  it('leaves an empty database alone', async () => {
    const r = await db.query('select count(*)::int as n from public.profiles')
    expect(r.rows[0]).toEqual({ n: 0 })
  })
})

describe('membership helpers', () => {
  const flags = () =>
    db.query<{ m: boolean; a: boolean }>('select public.is_member() as m, public.is_admin() as a')

  it('reports membership and admin status for the calling user', async () => {
    const admin = await addUser(db, 'owner@example.com')
    const emp = await addUser(db, 'dana@example.com')
    expect((await as(db, { id: admin }, flags)).rows[0]).toEqual({ m: true, a: true })
    expect((await as(db, { id: emp }, flags)).rows[0]).toEqual({ m: true, a: false })
  })

  it('treats a deactivated user as neither member nor admin', async () => {
    const admin = await addUser(db, 'owner@example.com')
    await db.query('update public.profiles set is_active = false where id = $1', [admin])
    expect((await as(db, { id: admin }, flags)).rows[0]).toEqual({ m: false, a: false })
  })
})

describe('profiles row level security', () => {
  it('lets active members read every profile', async () => {
    const admin = await addUser(db, 'owner@example.com')
    await addUser(db, 'dana@example.com')
    const r = await as(db, { id: admin }, () => db.query('select id from public.profiles'))
    expect(r.rows).toHaveLength(2)
  })

  it('shows a deactivated user nothing', async () => {
    await addUser(db, 'owner@example.com')
    const emp = await addUser(db, 'dana@example.com')
    await db.query('update public.profiles set is_active = false where id = $1', [emp])
    const r = await as(db, { id: emp }, () => db.query('select id from public.profiles'))
    expect(r.rows).toHaveLength(0)
  })

  it('blocks anonymous access outright', async () => {
    await addUser(db, 'owner@example.com')
    await expect(as(db, 'anon', () => db.query('select * from public.profiles'))).rejects.toThrow(
      /permission denied/i,
    )
  })

  it('blocks every write from signed-in users', async () => {
    const admin = await addUser(db, 'owner@example.com')
    const write = (sql: string) => as(db, { id: admin }, () => db.query(sql))
    await expect(
      write(`insert into public.profiles (id, display_name) values (gen_random_uuid(), 'x')`),
    ).rejects.toThrow(/permission denied/i)
    await expect(write(`update public.profiles set role = 'admin'`)).rejects.toThrow(/permission denied/i)
    await expect(write('delete from public.profiles')).rejects.toThrow(/permission denied/i)
  })

  it('does not let signed-in users call the trigger function directly', async () => {
    const admin = await addUser(db, 'owner@example.com')
    await expect(as(db, { id: admin }, () => db.query('select public.handle_new_user()'))).rejects.toThrow(
      /permission denied/i,
    )
  })
})
```

Run: `npx vitest run supabase/tests`

Expected: FAIL in every test, `ENOENT: no such file or directory, scandir '…/supabase/migrations'`.

- [ ] **Step 2: Write the migration**

`supabase/migrations/0001_profiles.sql`:

```sql
-- 0001_profiles.sql
-- Login users, the "first user becomes admin" bootstrap, and the membership
-- helpers that every later table's RLS policies build on.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  display_name text not null,
  role text not null default 'employee' check (role in ('admin', 'employee')),
  is_active boolean not null default true,
  must_change_password boolean not null default true,
  default_remind_min integer not null default 15 check (default_remind_min >= 0),
  created_at timestamptz not null default now()
);

create unique index profiles_display_name_key on public.profiles (lower(display_name));

alter table public.profiles enable row level security;

revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;

create function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  )
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active and p.role = 'admin'
  )
$$;

revoke all on function public.is_member() from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_member() to authenticated;
grant execute on function public.is_admin() to authenticated;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_first boolean;
  v_role text;
  v_name text;
begin
  select not exists (select 1 from public.profiles) into v_is_first;

  v_role := case
    when v_is_first then 'admin'
    else coalesce(nullif(new.raw_app_meta_data ->> 'role', ''), 'employee')
  end;
  if v_role not in ('admin', 'employee') then
    v_role := 'employee';
  end if;

  v_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'user'
  );

  insert into public.profiles (id, email, display_name, role, must_change_password)
  values (new.id, coalesce(new.email, ''), v_name, v_role, not v_is_first);

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create policy profiles_select_members
  on public.profiles
  for select
  to authenticated
  using (public.is_member());

-- Users that already existed when this ran (for example the owner created the first
-- user before running this file) still get a profile. The oldest of them is the admin.
insert into public.profiles (id, email, display_name, role, must_change_password)
select
  u.id,
  coalesce(u.email, ''),
  coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'user'
  ),
  case when row_number() over (order by u.created_at) = 1 then 'admin' else 'employee' end,
  row_number() over (order by u.created_at) > 1
from auth.users u;
```

Run: `npx vitest run supabase/tests`

Expected: `Tests  15 passed (15)`.

- [ ] **Step 3: Prove the permission test can fail**

```bash
cp supabase/migrations/0001_profiles.sql /tmp/0001.bak
sed -i 's/grant select on table public.profiles to authenticated;/grant select, insert, update, delete on table public.profiles to authenticated;/' supabase/migrations/0001_profiles.sql
npx vitest run supabase/tests
cp /tmp/0001.bak supabase/migrations/0001_profiles.sql
npx vitest run supabase/tests
```

Expected: the first run reports `1 failed` (`blocks every write from signed-in users`); after restoring, `Tests  15 passed (15)`.

- [ ] **Step 4: Run everything and commit**

```bash
npm test
npx tsc -b
npm run lint
```

Expected: `Test Files  11 passed (11)`, `Tests  92 passed (92)`, and no output from `tsc` or `eslint`.

```bash
git add supabase
git commit -m "feat: add the profiles table, the first-admin trigger and the membership helpers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Windows shell (Electron)

**Files:**
- Create: `electron/main.ts`, `electron/tsconfig.json`, `electron-builder.yml`, `scripts/electron-smoke.mjs`

**Interfaces:**
- Consumes: the `dist/` folder produced by `npm run build`, and the scripts already declared in `package.json` (`electron:compile`, `electron:dev`, `electron:smoke`, `dist:win`).
- Produces: `dist-electron/main.js`; `release/Moked-Setup-<version>.exe`, its `.blockmap`, `release/latest.yml` and `release/win-unpacked/Moked.exe`; `scripts/electron-smoke.mjs`, which Task 11's workflow runs against the packaged app.
- Smoke-test mode: with `MOKED_SMOKE_TEST=1` the app opens a hidden window, waits for the first screen, writes a JSON result to `MOKED_SMOKE_OUT` and a screenshot to `MOKED_SMOKE_SHOT`, and exits with code 0 only if an `h1`, `lang="he"` and `dir="rtl"` are present.

The main process is a process-level program, so its automated check is the smoke test rather than unit tests.

- [ ] **Step 1: Write the Electron files**

`electron/main.ts`:

```ts
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
```

`electron/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["ES2023"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "types": ["node"],
    "outDir": "../dist-electron",
    "rootDir": ".",
    "strict": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["main.ts"]
}
```

`electron-builder.yml`:

```yaml
appId: io.github.dofer12.moked
productName: Moked
copyright: Copyright © 2026 dofer12
directories:
  output: release
files:
  - dist/**
  - dist-electron/**
  - package.json
asar: true
win:
  target:
    - target: nsis
      arch: x64
  artifactName: Moked-Setup-${version}.${ext}
nsis:
  oneClick: true
  perMachine: false
  deleteAppDataOnUninstall: false
publish:
  provider: github
  owner: dofer12
  repo: desshbord-costumer-
```

`scripts/electron-smoke.mjs`:

```js
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
```

- [ ] **Step 2: Typecheck and lint**

```bash
npm run typecheck
npm run lint
```

Expected: no output from either. `npm run typecheck` now also checks `electron/`.

- [ ] **Step 3: Build and run the smoke test against this checkout**

```bash
npm run build
npm run electron:compile
MOKED_SMOKE_SHOT="$PWD/electron-smoke.png" npm run electron:smoke
```

The first run downloads the Electron binary (about 120 MB), so allow a few minutes. Expected output ends with:

```json
{
  "exitCode": 0,
  "result": { "heading": "יומן משימות מוקד", "lang": "he", "dir": "rtl", "title": "יומן משימות מוקד", "ok": true },
  "screenshot": "…/electron-smoke.png"
}
```

Open `electron-smoke.png` and confirm it shows the login card (Hebrew, right-aligned). The file is untracked; delete it afterwards.

- [ ] **Step 4: Build the installer and smoke-test the packaged app**

```bash
npm run dist:win
node scripts/electron-smoke.mjs --exe release/win-unpacked/Moked.exe
ls -la release release/win-unpacked/resources/app.asar
```

The first build downloads the installer tooling, so allow a few minutes. Expected: `release/Moked-Setup-0.1.0.exe` (about 113 MB), `release/Moked-Setup-0.1.0.exe.blockmap` and `release/latest.yml` exist; the smoke test prints `"ok": true` with `"exitCode": 0`; `app.asar` is under 1 MB (about 700 KB). If `app.asar` is about 18 MB, a renderer library is in `dependencies` instead of `devDependencies`.

This installer contains the placeholder server settings from `.env.local`, so never hand it to anyone. The real build happens in Task 13.

- [ ] **Step 5: Commit**

```bash
rm -f electron-smoke.png
git add electron electron-builder.yml scripts/electron-smoke.mjs
git status --short
git commit -m "feat: add the Windows shell with a headless smoke test" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected from `git status --short` before committing: only the three paths above; nothing from `release/` or `dist-electron/`.

---

### Task 9: Android shell (Capacitor)

**Files:**
- Create: `capacitor.config.ts`, `android/**` (generated by `npx cap add android`)
- Modify: `android/app/build.gradle` (replaced), `android/app/src/main/AndroidManifest.xml` (one attribute)

**Interfaces:**
- Consumes: `dist/` from `npm run build`.
- Produces: an `android/` project that Task 11's workflow builds with `./gradlew assembleDebug` or `assembleRelease`. It accepts the Gradle properties `-PmokedVersionName` and `-PmokedVersionCode`, and signs release builds when `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` are set in the environment.
- Produces: `npm run android:sync`, which builds the web app and copies it into the Android project.

The Capacitor 8.5.3 template needs JDK 21, Gradle 8.14.3 and `compileSdk` 36. This computer has no JDK or Android SDK, and the owner does not need them: `cap add` and `cap sync` work without them, and the APK is built in Task 13 on a GitHub runner whose image includes Android platform 36.

- [ ] **Step 1: Create the Capacitor config**

`capacitor.config.ts`:

```ts
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'io.github.dofer12.moked',
  appName: 'יומן משימות מוקד',
  webDir: 'dist',
}

export default config
```

- [ ] **Step 2: Generate the Android project**

```bash
npm run build
npx cap add android
```

Expected: `[success] android platform added!`. If Capacitor asks about anonymous usage data, answer no (`npx cap telemetry off`).

- [ ] **Step 3: Replace `android/app/build.gradle`**

This is the generated file with three changes. First, `versionCode` and `versionName` come from the Gradle properties the release workflow passes. Second, a `signingConfigs.release` block reads the signing key from environment variables. Third, `buildTypes.release` uses that signing config only when a keystore path is present, so local and debug builds are unaffected. If a later Capacitor 8.x generates a different file, keep the generated one and re-apply only those three changes.

`android/app/build.gradle`:

```groovy
apply plugin: 'com.android.application'

android {
    namespace = "io.github.dofer12.moked"
    compileSdk = rootProject.ext.compileSdkVersion
    defaultConfig {
        applicationId "io.github.dofer12.moked"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        // Set by the release workflow from the git tag (see scripts/release-version.ts).
        versionCode(Integer.parseInt((project.findProperty('mokedVersionCode') ?: '1').toString()))
        versionName(project.findProperty('mokedVersionName') ?: '0.0.0-dev')
        testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"
        aaptOptions {
             // Files and dirs to omit from the packaged assets dir, modified to accommodate modern web apps.
             // Default: https://android.googlesource.com/platform/frameworks/base/+/282e181b58cf72b6ca770dc7ca5f91f135444502/tools/aapt/AaptAssets.cpp#61
            ignoreAssetsPattern = '!.svn:!.git:!.ds_store:!*.scc:.*:!CVS:!thumbs.db:!picasa.ini:!*~'
        }
    }
    signingConfigs {
        release {
            // Provided by the release workflow. Absent for local and debug builds.
            def keystorePath = System.getenv('ANDROID_KEYSTORE_PATH')
            if (keystorePath) {
                storeFile file(keystorePath)
                storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
                keyAlias System.getenv('ANDROID_KEY_ALIAS')
                keyPassword System.getenv('ANDROID_KEY_PASSWORD')
                storeType 'pkcs12'
            }
        }
    }
    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
            if (System.getenv('ANDROID_KEYSTORE_PATH')) {
                signingConfig signingConfigs.release
            }
        }
    }
}

repositories {
    flatDir{
        dirs '../capacitor-cordova-android-plugins/src/main/libs', 'libs'
    }
}

dependencies {
    implementation fileTree(include: ['*.jar'], dir: 'libs')
    implementation "androidx.appcompat:appcompat:$androidxAppCompatVersion"
    implementation "androidx.coordinatorlayout:coordinatorlayout:$androidxCoordinatorLayoutVersion"
    implementation "androidx.core:core-splashscreen:$coreSplashScreenVersion"
    implementation project(':capacitor-android')
    testImplementation "junit:junit:$junitVersion"
    androidTestImplementation "androidx.test.ext:junit:$androidxJunitVersion"
    androidTestImplementation "androidx.test.espresso:espresso-core:$androidxEspressoCoreVersion"
    implementation project(':capacitor-cordova-android-plugins')
}

apply from: 'capacitor.build.gradle'

try {
    def servicesJSON = file('google-services.json')
    if (servicesJSON.text) {
        apply plugin: 'com.google.gms.google-services'
    }
} catch(Exception e) {
    logger.info("google-services.json not found, google-services plugin not applied. Push Notifications won't work")
}
```

- [ ] **Step 4: Keep app data out of cloud backups**

The WebView storage holds the login session, so turn off Android's automatic backup:

```bash
sed -i 's/android:allowBackup="true"/android:allowBackup="false"/' android/app/src/main/AndroidManifest.xml
grep -n allowBackup android/app/src/main/AndroidManifest.xml
```

Expected: one line containing `android:allowBackup="false"`.

- [ ] **Step 5: Sync and check**

```bash
npm run android:sync
npm run typecheck
npm run lint
```

Expected: the sync prints `Sync finished`; `tsc` and `eslint` print nothing.

- [ ] **Step 6: Make the Gradle wrapper executable for Linux and commit**

Windows does not record the executable bit, and the Linux runner needs it:

```bash
git add -A
git update-index --chmod=+x android/gradlew
git ls-files --stage android/gradlew
git status --short | head -40
```

Expected: the stage line starts with `100755`; the status lists `capacitor.config.ts` and files under `android/` but nothing under `android/app/src/main/assets/public` or `android/capacitor-cordova-android-plugins` (the generated `android/.gitignore` excludes them).

```bash
git commit -m "feat: add the Android shell with release signing and tag-based versions" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Release tooling

**Files:**
- Create: `scripts/release-version.ts`, `scripts/release-version.test.ts`, `scripts/check-config.ts`, `scripts/check-config.test.ts`, `scripts/setup-android-signing.ts`, `scripts/setup-android-signing.test.ts`

**Interfaces:**
- Consumes (Task 3): `loadConfig` from `src/lib/config.ts`.
- Produces:
  - `interface ReleaseVersion { version: string; androidVersionCode: number }`
  - `function parseReleaseTag(tag: string): ReleaseVersion` and `function resolveRelease(tag: string | undefined, packageVersion: string): ReleaseVersion`
  - CLI `node scripts/release-version.ts [tag]`: prints `version=…` and `android_version_code=…` for `$GITHUB_OUTPUT`, and exits 1 when the tag disagrees with `package.json`.
  - CLI `node scripts/check-config.ts`: exits 1 unless `.env` holds usable, public settings.
  - CLI `node scripts/setup-android-signing.ts [--repo owner/name] [--out-dir DIR] [--dry-run]`, plus the exports `makePassword`, `parseArgs`, `assertOutsideRepo`.

These scripts are `.ts` files run directly by Node 24 (type stripping), which is why `tsconfig.json` has `erasableSyntaxOnly`.

- [ ] **Step 1: Write the failing version tests**

`scripts/release-version.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseReleaseTag, resolveRelease } from './release-version'

describe('parseReleaseTag', () => {
  it('reads the version and derives an Android versionCode', () => {
    expect(parseReleaseTag('v0.1.0')).toEqual({ version: '0.1.0', androidVersionCode: 1_000 })
    expect(parseReleaseTag('v1.2.3')).toEqual({ version: '1.2.3', androidVersionCode: 1_002_003 })
  })

  it('produces a versionCode that grows with every release', () => {
    const order = ['v0.1.0', 'v0.1.1', 'v0.2.0', 'v0.10.0', 'v1.0.0', 'v1.0.1', 'v2.0.0'].map(
      (t) => parseReleaseTag(t).androidVersionCode,
    )
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(new Set(order).size).toBe(order.length)
  })

  it('rejects anything that is not a plain vMAJOR.MINOR.PATCH tag', () => {
    for (const bad of ['1.2.3', 'v1.2', 'v1.2.3.4', 'v1.2.3-rc1', 'va.b.c', 'v1.2.3 ', '', 'main']) {
      expect(() => parseReleaseTag(bad), bad).toThrow(/not a release tag/)
    }
  })

  it('rejects numbers that would overflow the versionCode scheme', () => {
    expect(() => parseReleaseTag('v1.1000.0')).toThrow(/supported range/)
    expect(() => parseReleaseTag('v1.0.1000')).toThrow(/supported range/)
    expect(() => parseReleaseTag('v2001.0.0')).toThrow(/supported range/)
    expect(parseReleaseTag('v2000.999.999').androidVersionCode).toBeLessThan(2_100_000_000)
  })
})

describe('resolveRelease', () => {
  it('uses package.json when there is no tag (manual builds)', () => {
    expect(resolveRelease(undefined, '0.1.0')).toEqual({ version: '0.1.0', androidVersionCode: 1_000 })
  })

  it('accepts a tag that matches package.json', () => {
    expect(resolveRelease('v0.2.0', '0.2.0').version).toBe('0.2.0')
  })

  it('refuses a tag that does not match package.json, naming both', () => {
    expect(() => resolveRelease('v0.2.0', '0.1.0')).toThrow(/v0\.2\.0.*0\.1\.0/)
  })

  it('refuses a package.json version that is not plain semver', () => {
    expect(() => resolveRelease(undefined, '0.1.0-beta')).toThrow(/not a release tag/)
  })
})
```

Run: `npx vitest run scripts/release-version.test.ts`

Expected: FAIL, `./release-version` cannot be resolved.

- [ ] **Step 2: Implement the version script**

`scripts/release-version.ts`:

```ts
// Works out which version a release build carries, and fails the build on a mismatch.
//   node scripts/release-version.ts v0.1.0   -> verifies the tag matches package.json
//   node scripts/release-version.ts          -> uses package.json (manual builds)
// Prints `key=value` lines, ready to append to $GITHUB_OUTPUT.
import { readFileSync } from 'node:fs'

export interface ReleaseVersion {
  version: string
  androidVersionCode: number
}

const TAG = /^v(\d+)\.(\d+)\.(\d+)$/

/** "v1.2.3" becomes version "1.2.3" plus an Android versionCode that grows with every release. */
export function parseReleaseTag(tag: string): ReleaseVersion {
  const match = TAG.exec(tag)
  if (!match) throw new Error(`"${tag}" is not a release tag such as v1.2.3`)
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (major > 2000 || minor > 999 || patch > 999) {
    throw new Error(`"${tag}" is outside the supported range (major up to 2000, minor and patch up to 999)`)
  }
  return {
    version: `${major}.${minor}.${patch}`,
    androidVersionCode: major * 1_000_000 + minor * 1_000 + patch,
  }
}

/** The version to build: the pushed tag when there is one (it must match package.json), else package.json. */
export function resolveRelease(tag: string | undefined, packageVersion: string): ReleaseVersion {
  const fromPackage = parseReleaseTag(`v${packageVersion}`)
  if (!tag) return fromPackage
  const fromTag = parseReleaseTag(tag)
  if (fromTag.version !== fromPackage.version) {
    throw new Error(
      `Tag ${tag} does not match package.json version ${packageVersion}. Bump package.json before tagging.`,
    )
  }
  return fromTag
}

if (import.meta.main) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  try {
    const release = resolveRelease(process.argv[2] || undefined, pkg.version)
    console.log(`version=${release.version}`)
    console.log(`android_version_code=${release.androidVersionCode}`)
  } catch (err) {
    console.error(`::error::${(err as Error).message}`)
    process.exit(1)
  }
}
```

```bash
npx vitest run scripts/release-version.test.ts
node scripts/release-version.ts
node scripts/release-version.ts v0.1.0
node scripts/release-version.ts v0.9.0; echo "exit=$?"
```

Expected: `Tests  8 passed (8)`; the next two commands print `version=0.1.0` and `android_version_code=1000`; the last prints `::error::Tag v0.9.0 does not match package.json version 0.1.0. Bump package.json before tagging.` and `exit=1`.

- [ ] **Step 3: Write the failing tests for the release gate**

The gate runs the real script as a child process. Values in the environment win over any `.env` file, so the tests do not depend on the files on disk.

`scripts/check-config.test.ts`:

```ts
// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const URL_OK = 'https://abcdefgh.supabase.co'

/** Runs the real script. Values in the environment win over any .env file. */
function runGate(env: Record<string, string>) {
  return spawnSync(process.execPath, ['scripts/check-config.ts'], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
}

describe('check-config', () => {
  it('passes with a public key and names the server', () => {
    const run = runGate({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_AbCdEf123' })
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('abcdefgh.supabase.co')
  })

  it('fails the release when the key is a secret key', () => {
    const run = runGate({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_AbCdEf123' })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('::error::')
    expect(run.stderr).toContain('סודי')
  })

  it('fails the release when the server settings are missing', () => {
    const run = runGate({ VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('::error::')
  })
})
```

Run: `npx vitest run scripts/check-config.test.ts`

Expected: `3 failed`, because `scripts/check-config.ts` does not exist yet.

- [ ] **Step 4: Implement the release gate**

`scripts/check-config.ts`:

```ts
// Fails the release build when `.env` is missing or holds something unusable
// (for example a secret key), so a broken app is never published.
import { loadEnv } from 'vite'
import { loadConfig } from '../src/lib/config.ts'

try {
  const config = loadConfig(loadEnv('production', process.cwd(), 'VITE_'))
  console.log(`Server settings OK: ${new URL(config.supabaseUrl).host}`)
} catch (err) {
  console.error(`::error::${(err as Error).message}`)
  process.exit(1)
}
```

```bash
npx vitest run scripts/check-config.test.ts
node scripts/check-config.ts
```

Expected: `Tests  3 passed (3)`; the second command prints `Server settings OK: placeholder-project.supabase.co`, read from the placeholder `.env.local`.

- [ ] **Step 5: Write the failing signing-script tests**

`scripts/setup-android-signing.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { assertOutsideRepo, makePassword, parseArgs } from './setup-android-signing'

describe('makePassword', () => {
  it('is long, URL-safe and different every time', () => {
    const a = makePassword()
    const b = makePassword()
    expect(a).toMatch(/^[A-Za-z0-9_-]{24}$/)
    expect(a).not.toBe(b)
  })
})

describe('parseArgs', () => {
  it('has safe defaults', () => {
    expect(parseArgs([])).toEqual({ repo: 'dofer12/desshbord-costumer-', outDir: undefined, dryRun: false })
  })

  it('reads every option', () => {
    expect(parseArgs(['--repo', 'a/b', '--out-dir', 'C:\\keys', '--dry-run'])).toEqual({
      repo: 'a/b',
      outDir: 'C:\\keys',
      dryRun: true,
    })
  })

  it('rejects unknown options and missing values', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown option/)
    expect(() => parseArgs(['--repo'])).toThrow(/needs a value/)
    expect(() => parseArgs(['--repo', 'not-a-repo'])).toThrow(/owner\/name/)
  })
})

describe('assertOutsideRepo', () => {
  it('refuses a folder inside the repository, where it could be committed', () => {
    expect(() => assertOutsideRepo('/work/repo/keys', '/work/repo')).toThrow(/inside the repository/)
    expect(() => assertOutsideRepo('/work/repo', '/work/repo')).toThrow(/inside the repository/)
  })

  it('accepts a sibling folder whose name merely starts the same', () => {
    expect(() => assertOutsideRepo('/work/repo-secrets', '/work/repo')).not.toThrow()
    expect(() => assertOutsideRepo('/home/me/moked-secrets', '/work/repo')).not.toThrow()
  })
})
```

Run: `npx vitest run scripts/setup-android-signing.test.ts`

Expected: FAIL, `./setup-android-signing` cannot be resolved.

- [ ] **Step 6: Implement the signing script**

`scripts/setup-android-signing.ts`:

```ts
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
```

Run: `npx vitest run scripts/setup-android-signing.test.ts`

Expected: `Tests  6 passed (6)`.

- [ ] **Step 7: Run the script for real, as a dry run**

A dry run creates a throwaway key in a temporary folder and contacts nobody:

```bash
OUT="$TEMP/moked-key-test"
node scripts/setup-android-signing.ts --dry-run --out-dir "$OUT"; echo "exit=$?"
node scripts/setup-android-signing.ts --dry-run --out-dir "$OUT"; echo "exit=$?"
node scripts/setup-android-signing.ts --dry-run --out-dir "$PWD/keys"; echo "exit=$?"
PASS="$(cat "$OUT/moked-release-password.txt")"
MOKED_P12_PASS="$PASS" openssl pkcs12 -info -in "$OUT/moked-release.p12" -passin env:MOKED_P12_PASS -nokeys 2>&1 | grep -E "MAC:|friendlyName|subject="
rm -rf "$OUT"
```

Expected: the first run prints `Dry run: the key was created, but nothing was sent to GitHub.`, the two file paths, a `sha256 Fingerprint=…` line and the backup reminder, with `exit=0`. The second run refuses (`already exists`, `exit=1`). The third refuses (`is inside the repository`, `exit=1`). The `openssl` check prints `MAC: sha256`, `friendlyName: moked` and `subject=CN=Moked, O=dofer12`.

- [ ] **Step 8: Run everything and commit**

```bash
npm test
npm run typecheck
npm run lint
```

Expected: `Test Files  14 passed (14)`, `Tests  109 passed (109)`, and no output from `tsc` or `eslint`.

```bash
git add scripts
git commit -m "feat: add release version, config gate and signing key scripts" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: GitHub Actions workflows

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `npm run typecheck`, `lint`, `test`, `build`, `electron:compile`; `npx cap sync android`; `android/gradlew`; `scripts/release-version.ts`, `scripts/check-config.ts`, `scripts/electron-smoke.mjs`; the secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (created in Task 13).
- Produces: `CI` on every push and pull request. `Release` on a `vX.Y.Z` tag publishes a GitHub Release with `Moked-<version>.apk`, `Moked-Setup-<version>.exe`, its `.blockmap` and `latest.yml` (marked pre-release for `v0.*`). Run manually ("Run workflow"), it builds the same files as downloadable artifacts only, with a debug-signed APK.
- The existing `static.yml` is not touched.

Behaviour worth knowing: the `version` job fails the whole run when the tag disagrees with `package.json`, or, on tags, when `.env` is unusable. The Android job fails a tag build if the signing secrets are missing, and prints the signing certificate's fingerprint so it can be compared with the one the signing script printed. The Windows job runs the packaged app's smoke test and uploads its screenshot even when the test fails.

- [ ] **Step 1: Write the workflows**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: ['**']
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - run: npm run build
```

`.github/workflows/release.yml`:

```yaml
name: Release

# Tag a version (git tag v0.1.0 && git push origin v0.1.0) to publish an APK and a
# Windows installer as a GitHub Release. "Run workflow" builds the same files as
# downloadable artifacts only (debug-signed APK), which is how the pipeline is tested.
on:
  push:
    tags: ['v[0-9]+.[0-9]+.[0-9]+']
  workflow_dispatch:

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  version:
    runs-on: ubuntu-24.04
    outputs:
      version: ${{ steps.resolve.outputs.version }}
      android_version_code: ${{ steps.resolve.outputs.android_version_code }}
      is_release: ${{ steps.mode.outputs.is_release }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - id: mode
        run: echo "is_release=${{ github.ref_type == 'tag' }}" >> "$GITHUB_OUTPUT"
      - id: resolve
        env:
          TAG: ${{ github.ref_type == 'tag' && github.ref_name || '' }}
        run: node scripts/release-version.ts "$TAG" >> "$GITHUB_OUTPUT"
      - name: Check the server settings in .env
        if: steps.mode.outputs.is_release == 'true'
        run: node scripts/check-config.ts

  android:
    needs: version
    runs-on: ubuntu-24.04
    env:
      VERSION: ${{ needs.version.outputs.version }}
      VERSION_CODE: ${{ needs.version.outputs.android_version_code }}
      IS_RELEASE: ${{ needs.version.outputs.is_release }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - uses: actions/setup-java@v6
        with:
          distribution: temurin
          java-version: '21'
      - run: npm ci
      - run: npm run build
      - run: npx cap sync android
      - name: Restore the signing key
        if: env.IS_RELEASE == 'true'
        env:
          KEYSTORE_BASE64: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}
          ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
        run: |
          if [ -z "$KEYSTORE_BASE64" ]; then
            echo "::error::The ANDROID_KEYSTORE_BASE64 secret is missing. See docs/setup-he.md, the Android signing key section."
            exit 1
          fi
          printf '%s' "$KEYSTORE_BASE64" | base64 -d > "$RUNNER_TEMP/moked-release.p12"
          keytool -list -keystore "$RUNNER_TEMP/moked-release.p12" -storetype PKCS12 \
            -storepass:env ANDROID_KEYSTORE_PASSWORD -alias "$ANDROID_KEY_ALIAS" > /dev/null
          echo "ANDROID_KEYSTORE_PATH=$RUNNER_TEMP/moked-release.p12" >> "$GITHUB_ENV"
      - name: Build the APK
        working-directory: android
        env:
          ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
          ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
        run: |
          chmod +x ./gradlew
          if [ "$IS_RELEASE" = "true" ]; then TASK=assembleRelease; else TASK=assembleDebug; fi
          ./gradlew "$TASK" --no-daemon -PmokedVersionName="$VERSION" -PmokedVersionCode="$VERSION_CODE"
      - name: Collect the APK and show who signed it
        run: |
          mkdir -p out
          cp android/app/build/outputs/apk/*/*.apk "out/Moked-${VERSION}.apk"
          APKSIGNER="$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)/apksigner"
          "$APKSIGNER" verify --print-certs "out/Moked-${VERSION}.apk"
      - uses: actions/upload-artifact@v7
        with:
          name: release-android
          path: out/*.apk
          if-no-files-found: error

  windows:
    needs: version
    runs-on: windows-latest
    env:
      CSC_IDENTITY_AUTO_DISCOVERY: 'false'
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm run electron:compile
      - run: npx electron-builder --win nsis --publish never
      - name: Smoke-test the packaged app
        env:
          MOKED_SMOKE_SHOT: ${{ runner.temp }}\moked-smoke.png
        run: node scripts/electron-smoke.mjs --exe release/win-unpacked/Moked.exe
      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: smoke-windows
          path: ${{ runner.temp }}\moked-smoke.png
          if-no-files-found: ignore
      - uses: actions/upload-artifact@v7
        with:
          name: release-windows
          path: |
            release/Moked-Setup-*.exe
            release/Moked-Setup-*.exe.blockmap
            release/latest.yml
          if-no-files-found: error

  release:
    if: github.ref_type == 'tag'
    needs: [version, android, windows]
    runs-on: ubuntu-24.04
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@v8
        with:
          pattern: release-*
          merge-multiple: true
          path: artifacts
      - uses: softprops/action-gh-release@v3
        with:
          files: artifacts/*
          generate_release_notes: true
          fail_on_unmatched_files: true
          prerelease: ${{ startsWith(github.ref_name, 'v0.') }}
```

- [ ] **Step 2: Validate them against the official GitHub Actions schema**

```bash
npx --yes @action-validator/cli .github/workflows/ci.yml; echo "exit=$?"
npx --yes @action-validator/cli .github/workflows/release.yml; echo "exit=$?"
```

Expected: no output and `exit=0` for each. (A deliberately broken file makes the validator print a JSON error list and exit 1.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/release.yml
git status --short
git commit -m "ci: check every push and publish tagged releases" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected from `git status --short` before committing: only the two workflow files. `static.yml` must not appear.

---

### Task 12: One-time owner guide

**Files:**
- Create: `docs/setup-he.md`

**Interfaces:**
- Consumes: the migration path `supabase/migrations/0001_profiles.sql` (Task 7), the commands `gh auth login` and `node scripts/setup-android-signing.ts` (Task 10), the release assets and names from Task 11, and the screens and messages from Task 6 (the acceptance checklist quotes them).

- [ ] **Step 1: Write the guide**

`docs/setup-he.md`:

````markdown
# מדריך הקמה חד-פעמי

המדריך מיועד לבעלים של האפליקציה. הוא לוקח כחצי שעה, ובסופו אפשר להתקין את האפליקציה בטלפון ובלפטופ ולהיכנס אליה.

| שלב | מה עושים | מי עושה |
|---|---|---|
| 1 | פרויקט Supabase חינמי, שבו נשמרים המשתמשים והמשימות | אתם |
| 2 | התחברות ל-GitHub מהמחשב | אתם |
| 3 | העברת פרטי החיבור של Supabase לאפליקציה | אני |
| 4 | מפתח חתימה לאפליקציית האנדרואיד | אני מריץ, ואתם מגבים את הקבצים |
| 5 | גרסה ראשונה והתקנה | אני בונה, ואתם מתקינים ובודקים |

## שלב 1: פרויקט Supabase

1. היכנסו אל <https://supabase.com/dashboard> והירשמו. אפשר להירשם עם חשבון GitHub.
2. אם מתבקשת יצירת Organization, צרו אחד מסוג **Free**.
3. לחצו **New project** והגדירו:
   - **Name:** `moked`
   - **Database password:** לחצו **Generate a password** ושמרו את הסיסמה במנהל סיסמאות. האפליקציה לא משתמשת בה, אבל אי אפשר לשחזר אותה אחר כך.
   - **Region:** **Central EU (Frankfurt)**
   - **Plan:** Free
   - אם מוצגות אפשרויות נוספות, השאירו את ברירת המחדל.
4. לחצו **Create new project** והמתינו כמה דקות עד שהפרויקט מוכן.
5. **כבו הרשמה עצמית.** היכנסו ל-**Authentication**, ואז ל-**Sign In / Providers** (בגרסאות ישנות: **Settings**). חפשו את המתג **Allow new users to sign up**, כבו אותו ושמרו. בלי זה, כל מי שמגיע לאפליקציה יכול ליצור לעצמו משתמש.
6. **הריצו את קובץ ה-SQL.** היכנסו ל-**SQL Editor**, לחצו **New query**, והדביקו את כל התוכן של הקובץ `supabase/migrations/0001_profiles.sql` מהפרויקט. לחצו **Run**. אמורה להופיע ההודעה **Success. No rows returned**. מריצים פעם אחת בלבד.
7. **צרו את המשתמש הראשון.** היכנסו ל-**Authentication**, ואז **Users**, ואז **Add user**, ואז **Create new user**. הזינו אימייל וסיסמה חזקה (לפחות 10 תווים), וסמנו **Auto Confirm User**. המשתמש הזה הופך אוטומטית למנהל.
8. **ודאו שנוצר פרופיל.** היכנסו ל-**Table Editor**, ואז לטבלה **profiles**. אמורה להיות בה שורה אחת עם `role` = `admin`.
9. **העתיקו את פרטי החיבור.** לחצו **Connect** בראש הדף. העתיקו את **Project URL** (נראה כמו `https://xxxx.supabase.co`) ואת **Publishable key** (מתחיל ב-`sb_publishable_`).
10. שלחו לי את שני הערכים בצ'אט. הם ציבוריים בכוונה ובטוחים לשיתוף.

> **חשוב:** אל תשלחו לי ואל תדביקו בשום מקום את **Secret key** (מתחיל ב-`sb_secret_`) או מפתח בשם `service_role`. מי שמחזיק אותם יכול לקרוא ולשנות את כל המידע. האפליקציה מסרבת לעלות אם אחד מהם מופיע בהגדרות שלה.

## שלב 2: התחברות ל-GitHub

פתחו טרמינל והריצו:

```bash
gh auth login
```

בחרו **GitHub.com**, ואז **HTTPS**, ואז **Login with a web browser**. הדביקו בדפדפן את הקוד שמוצג בטרמינל ואשרו. אם הפקודה `gh` לא מוכרת, התקינו את GitHub CLI מ-<https://cli.github.com>.

## שלב 3: פרטי החיבור באפליקציה

אחרי שתשלחו לי את שני הערכים, אני כותב אותם לקובץ `.env` בשתי שורות. אין בו שום סוד.

## שלב 4: מפתח חתימה לאנדרואיד

אנדרואיד מקבלת עדכון לאפליקציה רק אם הוא חתום באותו מפתח כמו הגרסה המותקנת. אני מריץ פקודה אחת שיוצרת את המפתח ושומרת אותו ב-GitHub כסוד, בלי להציג אותו:

```bash
node scripts/setup-android-signing.ts
```

היא יוצרת שני קבצים בתיקייה `moked-secrets` בתיקיית המשתמש שלכם:

- `moked-release.p12`: קובץ המפתח.
- `moked-release-password.txt`: הסיסמה שלו.

**גבו את שני הקבצים עכשיו** במנהל סיסמאות או בכונן חיצוני. בלעדיהם אי אפשר לעדכן אפליקציה שכבר הותקנה, אלא רק להסיר אותה ולהתקין מחדש.

## שלב 5: התקנה

אחרי שאני מסמן גרסה, GitHub בונה את הקבצים ומפרסם אותם בעמוד <https://github.com/dofer12/desshbord-costumer-/releases>.

**באנדרואיד:**

1. מהטלפון, היכנסו לעמוד ה-Releases והורידו את `Moked-<גרסה>.apk`.
2. פתחו את הקובץ. אם אנדרואיד חוסם התקנה, לחצו **Settings** ואשרו **Allow from this source** לדפדפן. זה נדרש פעם אחת.
3. אם מופיעה אזהרה של Google Play Protect, לחצו **More details** ואז **Install anyway**. האזהרה מופיעה כי האפליקציה לא פורסמה בחנות.

**ב-Windows:**

1. מהלפטופ, הורידו את `Moked-Setup-<גרסה>.exe` מאותו עמוד.
2. הפעילו אותו. אם מופיע **Windows protected your PC**, לחצו **More info** ואז **Run anyway**. האזהרה מופיעה כי חתימה דיגיטלית למתקין עולה כסף.
3. האפליקציה נפתחת מעצמה ומתווספת לתפריט התחל בשם **Moked**.

## בדיקת קבלה

בצעו כל סעיף בלפטופ ובטלפון. אם משהו לא עובד, כתבו לי איזה סעיף ומה ראיתם.

- [ ] נפתח חלון **יומן משימות מוקד** עם מסך כניסה בעברית.
- [ ] כניסה עם המשתמש הראשון מציגה **שלום, <השם שלכם>**, **תפקיד: מנהל**, את הגרסה ואת כתובת השרת.
- [ ] סגירה ופתיחה מחדש של האפליקציה מכניסה ישר, בלי להקליד סיסמה.
- [ ] סיסמה שגויה מציגה **האימייל או הסיסמה שגויים.** והטופס נשאר פעיל.
- [ ] התנתקות מחזירה למסך הכניסה.
- [ ] ניתוק האינטרנט, סגירה ופתיחה מחדש מציגים **אין חיבור לשרת** עם הכפתור **נסו שוב**, ולא את מסך הכניסה. אחרי חיבור האינטרנט, לחיצה על **נסו שוב** נכנסת.
- [ ] ב-Supabase, בטבלה **profiles** יש את המשתמש שלכם עם `role` = `admin`.

## פתרון בעיות

| מה רואים | מה עושים |
|---|---|
| **האפליקציה עדיין לא הוגדרה** | הגרסה נבנתה בלי פרטי חיבור. כתבו לי, ואבנה מחדש. |
| **המשתמש אינו פעיל או שלא הוגדר במערכת** | ב-Supabase, בדקו ב-Table Editor שהטבלה **profiles** קיימת ושיש בה שורה למשתמש. אם הטבלה לא קיימת, הריצו את קובץ ה-SQL. אם היא קיימת וריקה, כתבו לי. |
| **האימייל או הסיסמה שגויים** | ודאו שהמשתמש נוצר עם **Auto Confirm User**. אפשר לאפס סיסמה ב-**Authentication** ואז **Users**. |
| **App not installed** באנדרואיד | מותקנת גרסה שנחתמה במפתח אחר. הסירו את האפליקציה ונסו שוב. הנתונים נשמרים בשרת ולא בטלפון. |
| **אין חיבור לשרת** למרות שיש אינטרנט | ודאו שהפרויקט ב-Supabase לא מושהה. פרויקט חינמי שלא היה בו שימוש שבוע מושהה, ואפשר להפעיל אותו מחדש בלחיצה בלוח הבקרה. |
````

- [ ] **Step 2: Check that everything the guide refers to exists**

```bash
test -f supabase/migrations/0001_profiles.sql && test -f scripts/setup-android-signing.ts && echo "paths ok"
grep -c "האימייל או הסיסמה שגויים" src/features/auth/errors.ts
grep -c "אין חיבור לשרת" src/features/auth/StatusScreens.tsx
grep -c "תפקיד:" src/features/home/HomePage.tsx
```

Expected: `paths ok` and three counts of at least 1, which shows the guide quotes real messages.

- [ ] **Step 3: Commit**

```bash
git add docs/setup-he.md
git commit -m "docs: add the one-time setup guide for the owner" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: First pipeline run and owner acceptance

**Files:**
- Create: `.env`

**Interfaces:**
- Consumes: everything above, plus things only the owner can provide: the Supabase Project URL and Publishable key (guide step 1) and a GitHub login (guide step 2).
- Produces: a green `CI` run, a successful manual `Release` run, the four GitHub secrets, a `v0.1.0` GitHub Release with the APK and the Windows installer, and the owner's acceptance of M0.

The one thing the earlier tasks could not prove is the Gradle build on GitHub's runner, so expect to iterate in Step 4.

- [ ] **Step 1: Write `.env` with the owner's public values**

Delete the developer placeholders first. `.env.local` overrides `.env` in Vite, so while it exists the checks below would test the placeholders and not the real settings, and CI has no `.env.local`:

```bash
rm -f .env.local
printf 'VITE_SUPABASE_URL=%s\nVITE_SUPABASE_PUBLISHABLE_KEY=%s\n' "<the Project URL the owner sent>" "<the Publishable key the owner sent>" > .env
npm test
node scripts/check-config.ts
```

Expected: the whole suite passes (`Test Files  14 passed (14)`, `Tests  109 passed (109)`), including the `.env` guard test, and the script prints `Server settings OK: <the project's host>`. If the guard test or the script reports `סודי`, the owner sent the wrong key: delete `.env`, ask for the Publishable key, and do not commit anything.

```bash
git add .env
git commit -m "chore: add the public server settings" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Push the branch (needs the owner's go-ahead)**

```bash
gh auth status
git push -u origin feat/platform-core
```

Expected: `gh auth status` says logged in to github.com; the push creates the branch. The live site is unaffected, because `static.yml` runs only on `main`.

- [ ] **Step 3: Watch CI**

```bash
gh run list --branch feat/platform-core --limit 3
gh run watch --exit-status
```

Expected: the `CI` run ends green. If it fails, read the log with `gh run view --log-failed`, fix the cause, commit and push. A typical cause is a missing file from `git add`; compare the file list in this plan with `git ls-files`.

- [ ] **Step 4: Run the Release workflow by hand and fix what the first run shows**

```bash
gh workflow run release.yml --ref feat/platform-core
gh run list --workflow release.yml --limit 1
gh run watch --exit-status
```

Expected: all three jobs succeed. Then download the results:

```bash
gh run download --dir C:/dev/artifacts
ls -R C:/dev/artifacts
```

Expected: `release-android/Moked-0.1.0.apk` (debug-signed), `release-windows/Moked-Setup-0.1.0.exe`, `.blockmap` and `latest.yml`, and `smoke-windows/moked-smoke.png`. Open the screenshot: it shows the login card.

The Android build is the likely place for a first failure. Common causes:

| Symptom in the log | Cause | Fix |
|---|---|---|
| `Permission denied` running `./gradlew` | the executable bit was lost | the workflow already runs `chmod +x ./gradlew`; also confirm Task 9 Step 6 showed `100755` |
| `Unsupported class file major version` or a Java version error | wrong JDK | `actions/setup-java` must use `java-version: '21'` |
| `SDK location not found` | `ANDROID_HOME` is not set | add `echo "sdk.dir=$ANDROID_HOME" > android/local.properties` before the Gradle step |
| `License for package Android SDK Platform 36 not accepted` | SDK licenses | add a step: `yes \| "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses > /dev/null` |
| `Could not resolve com.android.tools.build:gradle` | transient download failure | re-run the workflow |
| `cap sync` reports a missing `dist` | the build step failed or was skipped | read the `npm run build` step above it |
| `cp: cannot stat` for the APK | the output path differs | list `android/app/build/outputs/apk` in a temporary step |

Fix, commit, push and run the workflow again until it is green. The debug APK from a green run can already be installed on the owner's phone to see the login screen.

- [ ] **Step 5: Create the signing key and the GitHub secrets**

The owner must have run `gh auth login` (guide step 2). Then:

```bash
node scripts/setup-android-signing.ts
gh secret list --repo dofer12/desshbord-costumer-
```

Expected: `Stored 4 secrets in dofer12/desshbord-costumer-.`, the two file paths under `~/moked-secrets`, a `sha256 Fingerprint=…` line and the backup reminder. `gh secret list` shows `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`. Ask the owner to back up both files now, and do not print their contents.

- [ ] **Step 6: Tag the first release**

```bash
git tag v0.1.0
git push origin v0.1.0
gh run watch --exit-status
gh release view v0.1.0 --repo dofer12/desshbord-costumer-
```

Expected: the `Release` run succeeds. In its Android job, the step "Collect the APK and show who signed it" prints `Signer #1 certificate SHA-256 digest: …`, the same value as the fingerprint from Step 5 (written without colons and in lower case). The GitHub Release `v0.1.0`, marked pre-release, lists four assets: `Moked-0.1.0.apk`, `Moked-Setup-0.1.0.exe`, `Moked-Setup-0.1.0.exe.blockmap` and `latest.yml`.

- [ ] **Step 7: Owner acceptance on real devices**

The owner installs the APK on an Android phone and the installer on the Windows laptop (guide step 5) and goes through the checklist in the guide, "בדיקת קבלה", on both. M0 is accepted when every box is ticked on both devices. Note anything that fails; fix it and, if the fix changes the app, publish `v0.1.1` (bump `version` in `package.json` first, or the release gate fails).

- [ ] **Step 8: Hand over**

Tell the owner M0 is accepted. The next step is the plan for M1 (the task data model, task card and live updates), written with what M0 taught us about the real devices.

---

## Coverage of the spec's M0 scope

| Spec requirement | Task |
|---|---|
| Project scaffold (Vite, React, TypeScript, RTL Hebrew, hash routing) | 2, 6 |
| Login against Supabase, Hebrew errors, session persistence | 3, 4, 5, 6 |
| `profiles` table and the first user becoming admin | 7 |
| Windows installer that renders, with Electron hardening | 8 |
| Android APK, signed, versioned from the tag | 9, 10, 11, 13 |
| CI and the release pipeline (GitHub Actions) | 10, 11, 13 |
| One-time owner setup guide | 12 |
| Acceptance on a real phone and a real laptop | 13 |

---

## Revisions after the final review

A whole-branch review by a fresh reviewer (2026-10-14) found problems in this plan's own code. They were fixed on the branch, each with tests, and where the files differ from the code blocks above, the files under `src/`, `supabase/`, `scripts/` and `.github/` are authoritative. What changed:

- **Task 4, `errors.ts`:** a Hebrew message for `email_not_confirmed`, and `classifyProfileFailure`, which decides what a failed profile request means.
- **Task 5, store and gateway:** sign-out ends this device only (`signOut({ scope: 'local' })`). The profile query does not retry on its own, and its HTTP status travels with the error. Server trouble (network, 5xx, 408, 429) keeps the session and shows the retry screen, a 401 explains that the session ended, and 403 or 404 mean "not set up". Start-up stops waiting after `SLOW_START_MS` (5 seconds) and offers a retry, while still accepting a late answer; a start-up that a retry replaced can no longer overwrite the newer state. New tests run the real supabase-js client against a stubbed network: `src/features/auth/supabaseGateway.contract.test.ts`.
- **Task 7, migration:** a display name derived from the email is numbered when it collides (`dana`, `dana 2`), and a name typed on purpose still has to be unique. Later users start inactive unless `app_metadata.role` holds a valid role (only the service role can write it), which is spec section 8's second layer. The backfill follows the same rules.
- **Task 10, gate:** `scripts/check-config.ts` uses Node alone, because the release workflow runs it before `npm ci`. Tests pin its `.env` loading to Vite's and run it from a checkout with no `node_modules`.
- **Task 11, workflow:** the gate runs on every run. Pushing a branch named `rehearse/*` builds exactly what a tag builds, signed with the release key, and publishes nothing. GitHub documents that the "Run workflow" button needs the file on the default branch, and that API or CLI dispatch works only after a first run, so the signed path would otherwise first run on the irreversible tag.
- **Task 12, guide:** `gh auth login -s workflow` (the default token cannot push workflow files), new troubleshooting rows, and how to activate an added user.

**Task 13, as it should now be run:**

1. Step 1: the suite is now `Test Files  15 passed (15)` and `Tests  149 passed (149)`; what matters is that nothing fails. After writing `.env`, check the owner's real project with two harmless requests. `curl -s -X POST "<URL>/auth/v1/signup" -H "apikey: <key>" -H "Content-Type: application/json" -d '{"email":"not-an-email","password":"x"}'` must answer `signup_disabled`; any other answer means self sign-up is still on, so ask the owner to switch it off. `curl -s "<URL>/rest/v1/profiles?select=id" -H "apikey: <key>"` must answer a permission error (`42501`), which proves the SQL was run and that `anon` reads nothing.
2. Step 2 needs the owner's `gh auth login -s workflow`.
3. Do Step 5 (signing key and secrets) before Step 4. Replace Step 4's `gh workflow run release.yml --ref feat/platform-core` with `git push origin HEAD:refs/heads/rehearse/m0`, then watch it with `gh run list --workflow release.yml --limit 1` and `gh run watch --exit-status`. It takes the signed path, so its APK carries the release certificate: compare the fingerprint it prints with the one from Step 5. Afterwards delete the rehearsal branch (`git push origin --delete rehearse/m0`).
4. Do not merge this branch into `main` before the Pages cutover (`pages.yml`). `static.yml` publishes the whole repository root on every push to `main`, and the root `index.html` is now the Vite entry page instead of the old app.
