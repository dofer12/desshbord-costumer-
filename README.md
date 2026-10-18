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
| `npm run electron:smoke` | Open the Windows app without showing it and check that the first screen renders, that the preload gave the page its one function and that the icon of the tray is found. |
| `npm run demo` | Demo in the browser at http://127.0.0.1:5174: no server, no user, opens signed in as a demo admin. |
| `npm run electron:demo` | The same demo as a Windows app window (builds into `dist-demo/`). |
| `npm run dist:win` | Build the Windows installer into `release/`. |
| `npm run android:sync` | Build the web app and copy it into the Android project. |

The APK is built in GitHub Actions (`.github/workflows/release.yml`), not on this computer.

Reminders: the web app plans local notifications for the next two days (`src/features/schedule/`) and hands them to the notifier of the platform: the Notification API with timers in a browser and in the Windows app, Capacitor's local notifications on Android. Closing the window of the Windows app hides it and leaves the app in the tray, so that the reminders keep arriving; it is left from the menu of the tray icon (`electron/trayBehavior.ts`). The icon of the tray, `build/tray.png`, is a placeholder until the icon of M4.

The Admin area (the "ניהול" tab, for administrators only) has six pages in `src/features/admin/`: the employees, the statuses, the settings, the import of orders and of backups, the backup, and the tasks deleted in the last 30 days. Creating an employee, resetting a password, blocking and changing a role go through the Edge Function `supabase/functions/admin-users` (the only code that holds the secret key); the statuses, the settings, the import, the backup and the restore are written by the app itself with the token of the session, under the admin-only policies of the database. It needs `supabase/migrations/0003_admin.sql` and the deployed function: see `docs/setup-he.md`, step 8. The CSV and file-format code (`csv.ts`, `legacyFormat.ts`, `matching.ts`, `ordersImport.ts`) is pure and reads the backup of this system, the file of the old app and a file of orders. The backup is handed over by a download in a browser and the Windows app, and by the share sheet in the Android app (`src/lib/fileSaver.ts`).

The demo exists only in builds made with `--mode demo`. Releases are built in the default `production` mode, and `src/features/demo/demoBuild.test.ts` fails if the demo ever ends up in one.
