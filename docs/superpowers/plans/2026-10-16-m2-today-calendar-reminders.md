# M2 Today, Calendar and Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the author executes this plan inline; the owner waived per-stage approval on 2026-10-15). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The "Today" and "Calendar" screens at functional parity with the old app, in-app reminders with snooze and postpone, and local notifications that arrive on the phone (Android app), on the laptop (Windows app that lives in the tray) and on the web (page open).

**Architecture:** All scheduling logic is pure and lives in `src/features/schedule/`: Jerusalem day arithmetic, the Today view, the reminder rules and the notification plan, and the calendar layout. The screens and a `RemindersProvider` read the tasks store through the M1 hooks; a change (done, postpone) goes through the M1 outbox, so it works offline. A `Notifier` interface hides the platform: a web adapter (timers + the Notification API, also used inside the Electron window), a native adapter (Capacitor Local Notifications) and a memory adapter (tests and the demo). The provider plans the next 48 hours from the tasks on every change and replaces everything that is pending; snoozes are kept per user in `localStorage`.

**Tech Stack:** The M1 stack, plus `@capacitor/local-notifications` (8.x, peer `@capacitor/core >= 8`) and, in the Electron main process, `Tray` and a tiny sandbox-safe preload. No calendar or date library: the zone arithmetic uses `Intl` with `timeZone: 'Asia/Jerusalem'`, as `validation.ts` already does.

**Spec:** `docs/superpowers/specs/2026-10-13-platform-core-design.md`, sections 11 (navigation, Today, Calendar), 13 (reminders and notifications), 15 (tests) and the M2 row of section 16. The behaviour to match is that of `public/legacy/index.html` (`renderToday`, `renderReminders`, `renderCalendar`, `pack`, the `postpone` and `snooze` handlers), which the old app's users know.

**How this plan is used:** the author is also the executor, and the owner asked for M1 to M4 to be built without approval between stages. So the plan is a resumable list of tasks with interfaces, rules and test cases; code is written test-first in the repository and committed per task. The ledger is `.superpowers/sdd/2026-10-16-m2-today-calendar-reminders/progress.md`.

## Global Constraints

- **Language and layout:** as M1. UI strings in Hebrew, right to left; identifiers and logs in English; numbers, times and hostnames use the `.num` class.
- **Time (spec sections 4 and 11):** every day, week, "today", "tomorrow" and "late" is by the calendar of `Asia/Jerusalem`, whatever the zone of the device; the week starts on Sunday. No device-zone getters (`getHours`, `getDay`, `toLocale…` without a zone) in `src/features/schedule/`. A day is not always 24 hours (2026-03-27 has 23, 2026-10-25 has 25); positions in the calendar are wall-clock minutes.
- **Parity numbers from the old app:** "soon" is within 60 minutes; the reminder strip shows tasks from the reminder time until 12 hours after the due time, three at a time with "ועוד N תזכורות פעילות"; snooze is 10 minutes; postpone is 30 minutes, one hour or tomorrow 09:00, counted from the later of now and the due time (tomorrow is from now); the Today queue is the late tasks and then the rest of today, by time; the no-date list shows six; the workload table counts open, late and today per assignee, with "ללא שיוך"; the calendar is 7, 3 or 1 days wide at ≥1000px, ≥640px and less; 48px per hour; the visible hours are at least 7:00 to 21:00 and grow to fit; overlapping tasks are packed side by side; a click on an empty place opens a new task at the nearest 30 minutes.
- **Reminders (spec section 13):** a task of the signed-in person (assignee is me) that is open, not deleted, and has `due_at` and `remind_min` (0 means "at the due time") gets a notification at `due_at - remind_min`; the next 48 hours, at most 60 notifications, are scheduled, and everything is replanned on every change of the data and on every open of the app; signing out cancels all of them. A notification shows the title of the task and the time, nothing else (a lock screen is not private).
- **Permissions:** Android 13+ asks for the notification permission and Android 12+ for exact alarms; without exact alarms a notification comes approximately, and the app says so. A person who denies notifications still gets the in-app strip, and a banner says how to turn them on.
- **Electron:** `contextIsolation` on, `nodeIntegration` off, `sandbox` on (unchanged). The preload exposes one function, `showWindow`. Closing the window hides it to the tray, and the app is left from the tray menu.
- **Git:** as M1. Work only on `feat/platform-core` in `C:\dev\desshbord-costumer-`; commit after every task; every commit message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; a push of the feature branch after the stage is allowed; a tag or a release always needs a new go-ahead; no secret enters the repository or the chat.
- **Versions:** unchanged, plus `@capacitor/local-notifications`. The version of the app becomes 0.3.0 at the end (no tag).

## Review Focus

The failure modes a person using this software is most likely to hit, each pinned by a test in the task that owns the code:

1. **Time zones and midnights:** a device in another zone, the two days a year when the clocks change, and a screen left open past midnight: "today", "late", "tomorrow" and the calendar columns follow Jerusalem; a task at 23:30 and one at 00:30 are on different days; the week begins on Sunday. Pinned in Tasks 1, 2, 7 and 8.
2. **A reminder must not repeat, vanish or reach the wrong person:** replanning replaces and never duplicates; a task that is done, deleted, postponed, reassigned or given a new due time loses its old notification; only the signed-in person's tasks are planned; signing out cancels everything; a snooze fires once; a reminder time that has passed is not fired again when the app opens. Pinned in Tasks 3 and 4.
3. **Permissions denied, missing or revoked:** no Notification API (an old WebView, a test), notifications denied, exact alarms not granted: the app says what is wrong, the strip still works, nothing throws. Pinned in Tasks 4, 5 and 9.
4. **Overlaps and odd durations in the calendar:** tasks at the same time sit side by side and none is hidden; a task that crosses midnight or is longer than the day is cut at the day's end; a task without a due time is not placed; a missing or zero duration is 30 minutes; a task done or deleted is handled as the old app did (done is shown muted, deleted is not shown). Pinned in Tasks 7 and 8.
5. **Postpone and snooze while offline or twice:** a postpone is an ordinary change through the outbox (shown at once, sent later); postponing a late task goes forward from now and not from its old time; choosing it twice moves it twice and never loses it; a snooze is forgotten when the due time changes or the task is done. Pinned in Tasks 2, 3 and 6.

## Not in M2

Employees, statuses and settings screens, the forced password change, import, backup and "recently deleted" (M3); the PWA, the content security policy, the app icon, the full dark-mode and accessibility polish and the 2,000-task performance work (M4); push notifications for an app that is not running, the 08:00 dashboard, the end-of-day summary (part 3); Google Calendar events (removed from the product).

## File Structure

```
src/features/schedule/time.ts                 Jerusalem days: dayKey, addDays, startOfWeek, dayStart, minuteOfDay, formatSpan, formatClock
src/features/schedule/today.ts                dueState, buildToday (counts, queue, undated, workload), postponeTarget
src/features/schedule/reminders.ts            reminderAt, activeReminders, planNotifications, notificationId
src/features/schedule/snooze.ts               per-user snooze store (localStorage)
src/features/schedule/notifier.ts             Notifier interface, web adapter, memory adapter, chooseNotifier
src/features/schedule/nativeNotifier.ts       Capacitor Local Notifications adapter
src/features/schedule/RemindersProvider.tsx   plans and replaces the notifications; remindersContext.ts: the hook
src/features/schedule/ReminderStrip.tsx       the strip of active reminders (in the shell)
src/features/schedule/NotificationBanner.tsx  permission state and how to fix it
src/features/schedule/TodayPage.tsx           the Today screen
src/features/schedule/calendar.ts             packDay, layoutRange, slotToDue, rangeTitle
src/features/schedule/CalendarPage.tsx        the Calendar screen
src/App.tsx, src/features/shell/AppShell.tsx  (modified) tabs, routes, badges, the strip, the provider
src/features/tasks/TaskCardRoute.tsx          (modified) closes to the page it was opened from; ?due= preset; default reminder
src/features/auth/types.ts, supabaseGateway.ts (modified) the profile carries default_remind_min
electron/main.ts, preload.cts, trayBehavior.ts  (modified/new) tray, hide on close, showWindow
android/app/src/main/AndroidManifest.xml      (modified) notification and alarm permissions; res/drawable/ic_stat_moked.xml
docs/setup-he.md                              (modified) notifications step and the M2 acceptance list
```

---

### Task 1: Jerusalem days and spans

**Files:**
- Create: `src/features/schedule/time.ts`, `src/features/schedule/time.test.ts`
- Modify: `src/features/tasks/display.ts` (use the weekday names from `time.ts`)

**Interfaces:**
- Consumes: `toDueAt(date, time)` and `fromDueAt(iso)` from `src/features/tasks/validation.ts`.
- Produces (all pure, none reads the device zone):
  - `type DayKey = string` (`'2026-10-16'`, a calendar day in Jerusalem)
  - `dayKey(at: Date | string | number): DayKey`
  - `addDays(key: DayKey, n: number): DayKey`
  - `weekday(key: DayKey): number` (0 is Sunday)
  - `startOfWeek(key: DayKey): DayKey` (the Sunday on or before)
  - `dayStart(key: DayKey): Date` (00:00 in Jerusalem as a moment)
  - `atTime(key: DayKey, time: string): Date` (`'09:30'`; `toDueAt` that returns a Date)
  - `minuteOfDay(at: Date | string | number): number` (wall-clock minutes since 00:00 in Jerusalem, 0 to 1439)
  - `formatClock(at): string` (`'14:30'`), `formatSpan(minutes): string`
  - `WEEKDAY_SHORT` (`['א׳', …, 'ש׳']`) and `WEEKDAY_LONG` (`['ראשון', …, 'שבת']`)

- [ ] **Step 1: Write the failing tests** (`time.test.ts`), each as a table:
  - `dayKey`: `'2026-10-16T21:30:00Z'` is `'2026-10-17'` (UTC+3); the end of summer time: `'2026-10-24T21:30:00Z'` is `'2026-10-25'`, `'2026-10-25T21:30:00Z'` (UTC+2, 23:30) is `'2026-10-25'`, `'2026-10-25T22:30:00Z'` is `'2026-10-26'`; the start of summer time: `'2026-03-26T22:30:00Z'` is `'2026-03-27'`, `'2026-03-27T21:30:00Z'` is `'2026-03-28'`; accepts a Date, an ISO string and a number.
  - `addDays`: `'2026-10-24'` +1 is `'2026-10-25'`; `'2026-12-31'` +1 is `'2027-01-01'`; `'2026-03-01'` −1 is `'2026-02-28'`; `'2028-02-28'` +1 is `'2028-02-29'`; +0; large n (+400).
  - `weekday`/`startOfWeek`: `'2026-10-18'` is Sunday (0); `'2026-10-16'` is Friday (5) and its week starts `'2026-10-11'`; a Sunday is its own start; across a month and a year boundary.
  - `dayStart`: `'2026-10-25'` is `2026-10-24T21:00:00.000Z`, `'2026-10-26'` is `2026-10-25T22:00:00.000Z` (so 2026-10-25 is 25 hours), `'2026-03-27'` is `2026-03-26T22:00:00.000Z` and `'2026-03-28'` is `2026-03-27T21:00:00.000Z` (23 hours).
  - `minuteOfDay`: `'2026-10-16T11:30:00Z'` is 870; midnight is 0; `'2026-10-16T20:59:00Z'` is 1439.
  - `formatClock`: `'2026-10-16T11:05:00Z'` is `'14:05'`.
  - `formatSpan` (the old `fmtSpan`): 0 `'0 דק׳'`, 1 `'1 דק׳'`, 59 `'59 דק׳'`, 60 `'שעה'`, 61 `'שעה ו-1 דק׳'`, 90 `'שעה ו-30 דק׳'`, 120 `'2 שע׳'`, 125 `'2 שע׳ ו-5 דק׳'`, 1439 `'23 שע׳ ו-59 דק׳'`, 1440 `'יום'`, 2880 `'2 ימים'`, −5 is as 5, 0.4 rounds to 0.
  - The functions give the same answers when the process zone is changed (`process.env.TZ` is not consulted): assert with fixed instants, so that a CI machine in UTC and the owner's in Jerusalem agree.
- [ ] **Step 2: Run, see them fail** (`npx vitest run src/features/schedule/time.test.ts`).
- [ ] **Step 3: Implement** with `Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hourCycle: 'h23', … })` for the parts (reuse `fromDueAt` for `dayKey` and `minuteOfDay`), and UTC arithmetic on the key for `addDays` and `weekday`. `display.ts` imports `WEEKDAY_SHORT`.
- [ ] **Step 4: Run the file and `src/features/tasks/display.test.ts`, see them pass.**
- [ ] **Step 5: Commit** `feat: add the Jerusalem day arithmetic for Today and the calendar`.

---

### Task 2: The Today view and the postpone rule

**Files:**
- Create: `src/features/schedule/today.ts`, `src/features/schedule/today.test.ts`

**Interfaces:**
- Consumes: `Task` (`model.ts`), `dayKey`, `dayStart`, `addDays`, `atTime` (Task 1).
- Produces:
  - `type DueState = 'done' | 'none' | 'late' | 'soon' | 'today' | 'later'` and `dueState(task, now: Date): DueState` (the old `dueState`: done, no due, past, within 60 minutes, later today, later)
  - `interface TodayView { counts: { late; remaining; soon; undated; doneToday }; queue: Task[]; undated: Task[]; workload: WorkloadRow[] }` and `interface WorkloadRow { key: string; open: number; late: number; today: number }` (`key` is an assignee id or `'none'`)
  - `buildToday(tasks: Task[], now: Date, scope: { meId: string; mine: boolean }): TodayView`
  - `type PostponeChoice = '30' | '60' | 'tomorrow'` and `postponeTarget(task: Task, choice: PostponeChoice, now: Date): string` (an ISO moment)
  - `todayBadge(tasks, now, meId): { count: number; late: boolean }` (open tasks of `meId` due before the end of today, including late ones; `late` when any of them is late): the number on the tab

- [ ] **Step 1: Write the failing tests** (`today.test.ts`, a fixed `now` of `2026-10-16T09:00:00Z`, which is 12:00 in Jerusalem):
  - Counts: a task due 10:00 Jerusalem is late (open) / remaining; due 12:30 is `soon` and remaining; due 13:00 exactly 60 minutes ahead is `soon`, 13:01 is not; due 23:59 today is remaining; due 00:00 tomorrow is neither late nor remaining; no due is undated; a done task counts only in `doneToday`, and only when `done_at` falls on today's Jerusalem date (a task done at `2026-10-15T21:30:00Z`, which is 00:30 today in Jerusalem, counts; one done at `2026-10-15T20:30:00Z`, 23:30 yesterday, does not); a deleted task counts nowhere.
  - Queue: late tasks first by due time, then the rest of today by due time; ties are ordered by id; done tasks never appear; tasks of others are left out when `mine` and kept when not; unassigned tasks are left out when `mine`.
  - Undated: open tasks without a due time, oldest `created_at` first; the list is not cut (the screen shows six).
  - Workload: always over all open, undated-or-dated, undeleted tasks of everyone whatever `mine` says; grouped by assignee with `'none'` for unassigned; `late` counts due-before-now, `today` counts due from now to the end of the day; sorted by late descending, then open descending, then key.
  - Day edges in Jerusalem: with `now` of `2026-10-25T21:30:00Z` (23:30 on the 25-hour day) a task due `2026-10-25T22:30:00Z` (00:30 next day) is not "today"; with `now` of `2026-03-27T21:30:00Z` the day is the 28th.
  - `dueState` for every value, including `done` taking precedence over a past due time.
  - `postponeTarget`: `'30'` for a late task goes forward from now, not from its old time (now 12:00, due 08:00, result 12:30); for a task due later it goes from the due time (due 15:00, result 15:30); `'60'` likewise; seconds and milliseconds are zero (now 12:00:42.500 gives 12:30:00.000); a task without a due time goes from now; `'tomorrow'` is 09:00 on the next Jerusalem day (also when now is 23:50, and on 2026-10-24 → 25th, whose 09:00 is `2026-10-25T07:00:00.000Z`); the result is an ISO string.
  - `todayBadge`: counts late and today's, ignores others' tasks, `late` flag.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: Commit** `feat: add the Today view and the postpone rule`.

---

### Task 3: Reminder rules and the notification plan

**Files:**
- Create: `src/features/schedule/reminders.ts`, `src/features/schedule/reminders.test.ts`

**Interfaces:**
- Consumes: `Task`, `formatDue` and `taskTitle` (`display.ts`), `formatClock` (Task 1).
- Produces:
  - `SNOOZE_MS = 600_000`, `REMINDER_AFTER_DUE_MS = 12 * 3_600_000`, `PLAN_HORIZON_MS = 48 * 3_600_000`, `PLAN_MAX = 60`
  - `type Snoozed = Record<string, number>` (task id → epoch ms until which it is quiet)
  - `reminderAt(task): Date | null`
  - `isReminderTask(task, meId): boolean`
  - `activeReminders(tasks, now, snoozed, meId): Task[]`
  - `interface PlannedNotification { id: number; taskId: string; at: Date; title: string; body: string }`
  - `planNotifications(tasks, now, snoozed, meId, options?: { horizonMs?: number; max?: number }): PlannedNotification[]`
  - `notificationId(taskId: string, taken?: ReadonlySet<number>): number` (a stable positive 31-bit integer; a taken one is probed forward)

- [ ] **Step 1: Write the failing tests:**
  - `reminderAt`: due 15:00 and 15 minutes is 14:45; `remind_min` 0 is the due time; no due or no `remind_min` is null.
  - `isReminderTask`: true only for an open, undeleted task assigned to `meId` with a due time and `remind_min` (0 included); false for done, deleted, someone else's, unassigned, no due, no reminder.
  - `activeReminders`: from the reminder time to 12 hours after the due time inclusive, not before and not after; a snoozed task is hidden until the snooze ends and shown again after; sorted by due time; others' tasks and done tasks excluded.
  - `planNotifications`: only reminder times strictly in the future and within 48 hours; at most 60, the earliest first; sorted by time; a task whose reminder time is past but whose due time is ahead gets none (the strip shows it); a snoozed task gets one notification at the end of the snooze (and not its original one), and only when that is in the future and the task is still a reminder task; ids are stable for the same task across calls and distinct within a plan (force a collision with a `taken` set); the title is `תזכורת: <title>` and the body is the due time as `formatDue` writes it (for example `היום · 14:30`); nothing of the customer's phone or name is in it unless the title has it; a task with no title uses `ללא כותרת`.
  - Replanning idempotence: planning twice with the same input gives equal results; moving a due time moves the notification; marking done, deleting, reassigning or removing `remind_min` removes it.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement** (FNV-1a over the task id for `notificationId`).
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: Commit** `feat: add the reminder rules and the notification plan`.

---

### Task 4: The notifier, the snooze store and the reminders provider

**Files:**
- Create: `src/features/schedule/notifier.ts`, `snooze.ts`, `RemindersProvider.tsx`, `remindersContext.ts` and a test file for each (`notifier.test.ts`, `snooze.test.ts`, `RemindersProvider.test.tsx`)
- Modify: `src/test/renderApp.tsx` only if the harness needs the provider (it should not: the provider takes a notifier prop)

**Interfaces:**
- Consumes: Task 3, `useTasks` and `useAuth`, `react-router`'s `useNavigate`.
- Produces:
  - `type Permission = 'granted' | 'denied' | 'prompt' | 'unsupported'`
  - `interface Notifier { permission(): Promise<Permission>; request(): Promise<Permission>; replaceAll(plan: PlannedNotification[]): Promise<void>; clear(): Promise<void>; onOpen(handler: (taskId: string) => void): () => void; exactAlarms?(): Promise<'granted' | 'denied'>; openExactAlarmSettings?(): Promise<void> }`
  - `createWebNotifier(deps?: { notification?: typeof Notification; now?: () => number }): Notifier` (timers; fires only when permission is `granted` at that moment; `tag` is the id; `lang: 'he'`, `dir: 'rtl'`; a click focuses the window and calls the `onOpen` handlers; `replaceAll` cancels every timer first; a timer longer than 24 days is never set because the horizon is 48 hours)
  - `createMemoryNotifier(initial?: Permission): Notifier & { plans: PlannedNotification[][]; opened(taskId): void }` (tests and the demo)
  - `chooseNotifier(): Notifier` (the web adapter at first; Task 9 makes it the native one when `Capacitor.isNativePlatform()`. Inside the Windows app the web adapter is used too, and a click on a notification also calls `window.mokedDesktop?.showWindow()`, Task 10)
  - `createSnoozeStore(deps: { storage: Pick<Storage, 'getItem' | 'setItem'>; userId: string; now?: () => number })` with `snooze(taskId)`, `clear(taskId)`, state `snoozed: Snoozed`; expired entries are dropped when read; a broken or full storage never throws
  - `<RemindersProvider notifier? />` and `useReminders(): { active: Task[]; snoozed: Snoozed; snooze(id): void; permission: Permission; requestPermission(): Promise<void>; exactAlarms: 'granted' | 'denied' | 'unsupported'; problem: string | null }`

- [ ] **Step 1: Write the failing tests:**
  - Web notifier (fake `Notification` class and fake timers): nothing happens when the API is absent (`permission()` is `'unsupported'`, `replaceAll` resolves); a plan of three schedules three timers and fires each at its time with the right title, body, tag, `lang` and `dir`; it does not fire when permission is `denied` at that time; `replaceAll` again cancels the old timers (no duplicate, no old time); `clear` cancels all; `request()` maps `granted`/`denied`/`default`; a click calls the handler with the task id and focuses the window; a handler removed with its unsubscribe is not called.
  - Snooze store: `snooze` stores now + 10 minutes under the user's key; two users do not share; an expired entry is gone on the next read; a throwing `getItem`/`setItem` leaves it working in memory; `clear` removes it.
  - Provider (memory notifier, a fake tasks store with a fixed clock): it plans on mount and again after a task is changed (done, due moved, reassigned away, deleted, `remind_min` removed: the plan no longer holds it; the notifier is asked once per settled change, debounced, not once per keystroke); a snooze removes the task from `active`, plans a notification at +10 minutes, and a due change or `markDone` clears it; the plan is also made again when the tab becomes visible and every 15 minutes; unmounting (sign-out) calls `clear`; a `replaceAll` that rejects sets `problem` and does not crash or stop later planning; `permission` and `requestPermission` follow the notifier; a click on a notification navigates to `/today/<id>`; other people's tasks are never in a plan.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: Commit** `feat: add the notifier, the snooze store and the reminders provider`.

---

### Task 5: Navigation, routes and the card's presets

**Files:**
- Modify: `src/App.tsx`, `src/features/shell/AppShell.tsx` (+ tests), `src/features/tasks/TaskCardRoute.tsx` (+ test), `src/features/auth/types.ts`, `src/features/auth/supabaseGateway.ts` (+ tests), `src/styles/base.css`
- Create: `src/features/schedule/TodayPage.tsx` and `CalendarPage.tsx` as stubs that render only their headings (Tasks 6 and 8 fill them in)

**Interfaces:**
- Consumes: Tasks 2 and 4.
- Produces: the routes `/today`, `/tasks`, `/calendar`, each with child routes `new` and `:id` for the card; the index goes to `/today`; the tabs **היום**, **משימות**, **יומן** (in this order) with a number on **היום** (`todayBadge`, red when something is late) and on **משימות** (open tasks); on a screen narrower than 640px the tabs are a bar at the bottom; `TaskCardRoute` closes to the page it was opened from (the first segment of the path), accepts `?due=<ISO moment>` for a new task (an invalid or missing value is ignored) and starts a new task with `remind_min` set to the profile's `default_remind_min`; `Profile` has `default_remind_min: number`, read with the profile.

- [ ] **Step 1: Write the failing tests:** the three tabs in order with their labels and the current one marked; the badge numbers and the red state; the index route lands on **היום**; `/today/new`, `/today/:id`, `/calendar/new` and `/calendar/:id` open the card over their page and closing returns to that page (not to `/tasks`); `?due=` presets the date and time fields in Jerusalem time and an invalid one leaves them empty; a new task starts with `remind_min` equal to the profile's `default_remind_min` (15 gives 15; 0 gives 0, which means "at the due time" and is kept; a profile without the field, as in an old test fixture, gives none); the profile gateway reads `default_remind_min`; the existing M1 tests for `/tasks` still pass.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run these and the whole `src/features` suite, see them pass.**
- [ ] **Step 5: Commit** `feat: add the Today and Calendar tabs and open the card from them`.

---

### Task 6: The Today screen, the reminder strip and the notification banner

**Files:**
- Create: `src/features/schedule/TodayPage.tsx` (replaces the stub), `ReminderStrip.tsx`, `NotificationBanner.tsx` and a test file for each
- Modify: `src/features/shell/AppShell.tsx` (the provider and the strip), `src/styles/base.css`

**Interfaces:**
- Consumes: Tasks 2, 3, 4 and 5, `useTasks`, `useDirectory`, `formatSpan`, `formatDue`, the M1 `CopyButton` and status chip styles.
- Produces: the Today screen; `ReminderStrip` (in the shell, above every page); `NotificationBanner` (on the Today screen).

- [ ] **Step 1: Write the failing tests** (a fixed clock, the fake backend of `src/test/`):
  - Screen: five counts with the old labels (**באיחור**, **נותרו להיום**, **בשעה הקרובה**, **ללא מועד**, **בוצעו היום**); the queue shows late tasks before today's, each with the time, the relative text (`באיחור 2 שע׳`, `בעוד 45 דק׳`), the title as a link to `/today/<id>`, the **דחוף** flag for high priority, the status chip, order number, customer, a copy button for the phone and `בטיפול של <name>`; **בוצע** marks the task done (through the store); the **דחה…** select offers **ב-30 דק׳**, **בשעה**, **למחר 09:00** and changes the due time with `postponeTarget` and shows a status message `נדחה ל<when>`; choosing a postpone clears the snooze of that task; the no-date list shows six and a link when there are more; the workload table lists everyone with **ללא שיוך**; the scope switch **המשימות שלי** / **כולם** changes the counts and the queue (not the workload) and is remembered per user; the empty states (**עדיין אין משימות**, **אין משימות באיחור או להיום.**); loading and error from the store status with **נסו שוב**.
  - Strip: shows reminders of the signed-in person, at most three, with `באיחור של …`/`עכשיו`/`בעוד …`, **בוצע** and **נודניק 10 דק׳**; the snooze hides the item and says `אזכיר שוב בעוד 10 דקות` in a status region; `ועוד N תזכורות פעילות` with a link to Today when there are more; nothing when there are none.
  - Banner: for `prompt` a message and **הפעלת התראות** that calls `requestPermission`; for `denied` the explanation of where to turn them on and that the strip still works; for `unsupported` a short note; nothing for `granted` (and a note about approximate timing when exact alarms are `denied`, with **פתיחת ההגדרות**).
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, see them pass; run the whole `src/features` suite.**
- [ ] **Step 5: Commit** `feat: add the Today screen with the reminder strip`.

---

### Task 7: The calendar layout

**Files:**
- Create: `src/features/schedule/calendar.ts`, `src/features/schedule/calendar.test.ts`

**Interfaces:**
- Consumes: `Task`, Task 1.
- Produces:
  - `interface DayItem { task: Task; start: number; end: number }` and `interface PlacedItem extends DayItem { column: number; columns: number }` (minutes of the day)
  - `packDay(items: DayItem[], minSpan?: number): PlacedItem[]` (the old `pack`: overlap clusters, the first free column; an item shorter than `minSpan` (30) takes `minSpan` for the packing only)
  - `interface DayLayout { key: DayKey; items: PlacedItem[] }` and `interface RangeLayout { days: DayLayout[]; fromHour: number; toHour: number }`
  - `layoutRange(tasks: Task[], startKey: DayKey, days: number, options: { assignee: 'me' | 'all' | 'none' | string; meId: string }): RangeLayout`
  - `slotToDue(key: DayKey, minuteInDay: number): string` (rounded to the nearest 30 minutes, an ISO moment)
  - `rangeTitle(startKey: DayKey, days: number): string` (`18.10 – 24.10/2026`, or `יום א׳ 18.10/2026` for one day)
  - `shiftAnchor(anchor: DayKey, days: number, direction: -1 | 1): DayKey` and `rangeStart(anchor: DayKey, days: number): DayKey` (a week starts on Sunday; 3 and 1 days start at the anchor)

- [ ] **Step 1: Write the failing tests:**
  - `packDay`: no overlap gives one column each; two overlapping give two columns of two; a chain A–B, B–C with A and C apart uses two columns for the whole cluster; three at the same time give three; an item that ends exactly when another starts does not overlap it; a 10-minute item is packed as 30 minutes (so it overlaps one that starts 20 minutes later); the output order is by start, then by longer first; the input is not modified.
  - `layoutRange`: a task goes on its Jerusalem day (`2026-10-25T22:30:00Z` is on the 26th); `end` is `start + duration_min` and is cut at 1440 (a task at 23:30 for 90 minutes ends at midnight); a zero, negative or missing duration is 30; a task without `due_at` and a deleted task are not placed; a done task is placed; the assignee filter (`'me'`, `'all'`, `'none'`, a person's id); tasks outside the range are not placed; the hours are 7 to 21 by default, an early task (05:30) lowers `fromHour` to 5, a late one (22:10 for 60 minutes) raises `toHour` to 24 at most, and `fromHour` is at least 0; on the 25-hour and the 23-hour days the positions are wall-clock minutes and nothing is lost or doubled.
  - `slotToDue`: 09:14 rounds to 09:00 and 09:15 to 09:30; a click after 23:45 would round to midnight of the next day, so it is held at 23:30 of the same day (the old app let it roll over, which opened a task on the wrong day); a negative or past-the-end offset is held to the day; the result is the Jerusalem moment of that time on that day, also on the days when the clocks change.
  - `rangeTitle`, `rangeStart` and `shiftAnchor`: a week range across a month and a year end; the one-day title; shifting by 7, 3 and 1 days both ways.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: Commit** `feat: add the calendar layout`.

---

### Task 8: The Calendar screen

**Files:**
- Create: `src/features/schedule/CalendarPage.tsx` (replaces the stub), `src/features/schedule/CalendarPage.test.tsx`
- Modify: `src/styles/base.css`

**Interfaces:**
- Consumes: Task 7, `useTasks`, `useDirectory`, `useMediaQuery`, `useNow`, the statuses' colours and `statusTextColor`.
- Produces: the Calendar screen.

- [ ] **Step 1: Write the failing tests** (the fake backend, a fixed clock, `matchMedia` stubs from `src/test/matchMedia.ts`):
  - 7 days at ≥1000px, 3 at ≥640px, 1 below, with the day headers (`א׳ 18.10`), today marked; the range title; **הקודם**, **הבא** and **היום** move the range by the width of the range and back to today; the hour gutter shows the hours between `fromHour` and `toHour`; a task is a button at the right place and height for its start and duration, labelled with the time, the title and the customer, coloured by its status; overlapping tasks sit side by side; a late open task is marked late and a done one is muted; clicking a task opens `/calendar/<id>`; clicking an empty place of a day column opens `/calendar/new?due=<moment>` rounded to 30 minutes (and a click on a task does not); each day has a keyboard route to a new task (a visually hidden button **משימה חדשה ב<יום>** that opens it at 09:00); the **now** line is on today's column only, at the right height, and moves when the clock moves; the filter **שיוך** (**המשימות שלי**, **כולם**, **ללא שיוך**, each person) changes what is shown, and defaults to **המשימות שלי**; the empty and loading and error states; the first view is scrolled so that the current hour is visible.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement** (48 px per hour; blocks are positioned with `inset-inline-start` so that they work right to left).
- [ ] **Step 4: Run, see them pass; run the whole `src/features` suite.**
- [ ] **Step 5: Commit** `feat: add the Calendar screen`.

---

### Task 9: Local notifications on Android

**Files:**
- Create: `src/features/schedule/nativeNotifier.ts`, `src/features/schedule/nativeNotifier.test.ts`, `android/app/src/main/res/drawable/ic_stat_moked.xml`
- Modify: `package.json`, `package-lock.json` (`@capacitor/local-notifications`), `capacitor.config.ts` (the plugin's small icon and colour), `android/app/src/main/AndroidManifest.xml`, `scripts/android-manifest.test.ts`, `src/features/schedule/notifier.ts` (`chooseNotifier`), the generated Gradle files that `npx cap sync android` rewrites

**Interfaces:**
- Consumes: the plugin API (`checkPermissions`, `requestPermissions`, `checkExactNotificationSetting`, `changeExactNotificationSetting`, `createChannel`, `getPending`, `cancel`, `schedule`, `addListener('localNotificationActionPerformed')`).
- Produces: `createNativeNotifier(plugin: LocalNotificationsPlugin): Notifier`.

- [ ] **Step 1: Write the failing tests** (a fake plugin object):
  - Permission mapping: `display: 'granted'` is `granted`, `denied` is `denied`, `prompt` and `prompt-with-rationale` are `prompt`; `request()` asks and maps.
  - `replaceAll`: creates the channel once (id `reminders`, name `תזכורות`, high importance), cancels every pending notification, then schedules the plan with `schedule: { at, allowWhileIdle: true }`, the channel, the small icon and `extra: { taskId }`; an empty plan only cancels; a plan with an id that is already pending replaces it and does not duplicate; a rejected `schedule` rejects `replaceAll` (the provider reports it).
  - `clear` cancels all pending. `onOpen` registers the listener once per handler and calls it with `extra.taskId`; a notification without a task id is ignored; the unsubscribe removes it.
  - `exactAlarms()` maps `exact_alarm` `granted`/`denied`; `openExactAlarmSettings()` calls `changeExactNotificationSetting`; where the check is not available it reports `granted`.
  - The manifest asks for `POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM` and `RECEIVE_BOOT_COMPLETED` (after checking what the plugin's own manifest already declares), still asks for `INTERNET`, and still has no `CAMERA`; the existing manifest tests are updated for the new list of permissions.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement; `npm install @capacitor/local-notifications`; `npm run android:sync` to regenerate the Gradle files; check `git diff android/` for only the expected changes.**
- [ ] **Step 4: Run these tests, typecheck and the whole suite. The APK itself is built by CI; the owner tries the notification on the phone (acceptance).**
- [ ] **Step 5: Commit** `feat: add local notifications on Android`.

---

### Task 10: The Windows app in the tray

**Files:**
- Create: `electron/trayBehavior.ts`, `electron/trayBehavior.test.ts`, `electron/preload.cts`, `build/tray.png` (a small generated placeholder until the icon of M4)
- Modify: `electron/main.ts`, `electron/tsconfig.json` (include the preload, emit CommonJS for it), `electron-builder.yml` (ship `build/tray.png`), `vite.config.ts` (test include), `src/features/schedule/notifier.ts` (the desktop bridge), `scripts/electron-smoke.mjs` only if the smoke needs it

**Interfaces:**
- Consumes: Electron's `Tray`, `Menu`, `nativeImage`, `ipcMain`.
- Produces: `window.mokedDesktop?: { showWindow(): void }` (declared in `src/env.d.ts`); `createTrayBehavior(deps)` with `onClose(event)` (hide instead of closing unless quitting), `requestQuit()`, `show()`; the web notifier's click calls `window.mokedDesktop?.showWindow()` as well as focusing.

- [ ] **Step 1: Write the failing tests** (`trayBehavior.test.ts`, with fake window and tray objects): closing the window is prevented and the window is hidden; after `requestQuit()` closing is allowed; `show()` restores a minimized window, shows a hidden one and focuses it; a second instance shows the window; the tray menu has **פתיחה** and **יציאה** and a click on the icon shows the window; in smoke mode nothing hides and the app exits as before; the IPC handler accepts only the `showWindow` channel from the app's own window (`event.senderFrame` is the main frame of the main window) and ignores anything else; the preload exposes exactly one function.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement** (`backgroundThrottling: false`, so that timers run while the window is hidden; `app.on('window-all-closed')` no longer quits except in smoke mode; the tray tooltip is the app title; compile the preload to `dist-electron/preload.cjs`).
- [ ] **Step 4: Run these tests, `npm run typecheck`, the whole suite and `npm run electron:smoke` (the first screen still renders, the smoke run still exits).**
- [ ] **Step 5: Commit** `feat: keep the Windows app in the tray so that reminders arrive`.

---

### Task 11: Demo, guide, version and the check in a real browser

**Files:**
- Modify: `src/features/demo/demoBackend.ts` (+ test: tasks with reminders for the demo person, a memory notifier in the demo), `src/features/demo/demoBuild.test.ts` if a new marker is added, `docs/setup-he.md`, `README.md`, `package.json`, `package-lock.json`
- Create: nothing else

- [ ] **Step 1: The demo** holds, for the demo person, tasks that are late, within the hour, later today, tomorrow and undated, with `remind_min` set, so that Today, the strip and the calendar all have something to show; the demo uses the memory notifier (no permission prompt); a test pins this.
- [ ] **Step 2: The guide** gains the notifications step (Android: allow notifications and exact alarms when asked; Windows: the tray icon and how to quit; web: allow notifications for the site) and the M2 acceptance list: the Today numbers match the Tasks list; **בוצע** and **דחה…** work and reach the other device; the strip shows a reminder when its time comes and **נודניק 10 דק׳** brings it back after ten minutes; the calendar shows the week, a click on an empty place opens a new task at that time; a notification arrives on the phone with the app closed, on the laptop with the window closed to the tray, and on the web page; after signing out nothing arrives; the new troubleshooting rows (notifications denied, exact alarms, tray icon hidden by Windows).
- [ ] **Step 3: Version 0.3.0** (`npm version 0.3.0 --no-git-tag-version`); README mentions the tray.
- [ ] **Step 4: Check in the real browser** (the demo, at laptop and phone widths): Today numbers, the queue, a postpone, a snooze, the calendar at 7, 3 and 1 days, a click on an empty slot, the now line; fix what is wrong with a test first.
- [ ] **Step 5: The gate:** `npm run lint`, `npm run typecheck`, `npm run build`, the whole `npm test`, `npm run electron:smoke`.
- [ ] **Step 6: Commit** `feat: add the demo reminders, the M2 guide and version 0.3.0`; push the branch for CI.
- [ ] **Step 7: The final review** of M2 by a fresh reviewer over the range from the start of this plan, with the Review Focus above; fix every Critical and Important finding test-first; ledger the minors.

---

## Coverage of the spec's M2 scope

| Spec | Task |
|---|---|
| Section 11, Today: counts, queue with done and postpone, workload including unassigned, reminders strip with a 10-minute snooze | 2, 3, 6 |
| Section 11, Calendar: week/3 days/day, packed overlaps, now line, click on an empty slot, employee filter | 7, 8 |
| Section 11, navigation: tabs on top, a bar at the bottom on a phone | 5 |
| Section 13: local notifications for the signed-in person's tasks, 48 hours, replanned on change and on open | 3, 4 |
| Section 13: Android permission and exact alarms | 9 |
| Section 13: Windows keeps running in the tray, quits from the tray menu | 10 |
| Section 13: web Notification API while the page is open | 4 |
| Section 16, M2 acceptance: parity with the old app and a notification on the phone and the laptop | 11 and the owner's device test |
