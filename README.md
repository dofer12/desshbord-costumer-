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
| `node supabase/tests/security-check.ts` | Live check of the permissions of the real Supabase project: makes temporary users, tries every cell of the table of permissions as each of them, and deletes them. Asks for the secret key (not shown, never saved). See `docs/setup-he.md`, step 6. |
| `npm run build` | Production web build into `dist/`. |
| `npm run electron:dev` | Build, then open the Windows app. |
| `npm run electron:smoke` | Open the Windows app without showing it and check that the first screen renders. |
| `npm run demo` | Demo in the browser at http://127.0.0.1:5174: no server, no user, opens signed in as a demo admin. |
| `npm run electron:demo` | The same demo as a Windows app window (builds into `dist-demo/`). |
| `npm run dist:win` | Build the Windows installer into `release/`. |
| `npm run android:sync` | Build the web app and copy it into the Android project. |

The APK is built in GitHub Actions (`.github/workflows/release.yml`), not on this computer.

The demo exists only in builds made with `--mode demo`. Releases are built in the default `production` mode, and `src/features/demo/demoBuild.test.ts` fails if the demo ever ends up in one.
