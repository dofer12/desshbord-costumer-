// What the Windows app does when the page of its window is gone (a crash, a kill, running out of
// memory). The reminders are timers of that page, and the window lives for days in the tray, so a page
// that is gone ends all of them without a sign. It is loaded again, unless it keeps going, which is a
// page that crashes as it loads: that is left alone for a minute, instead of being loaded again at
// once, for ever, and tried once more when the minute is over.

export interface CrashRecoveryDeps {
  /** The time now, in milliseconds. */
  now(): number
  /** Loads the page again (Electron's `webContents.reload`). */
  reload(): void
  /** Runs `run` after `ms` milliseconds (`setTimeout`). */
  later(run: () => void, ms: number): void
}

export interface CrashRecovery {
  /** For the "render-process-gone" event of the page, with the reason that it gives. */
  onGone(reason: string): 'reloaded' | 'gave-up' | 'ignored'
}

/** The reason of a page that was asked to close and did: not a crash. */
const CLEAN_EXIT = 'clean-exit'

export function createCrashRecovery(deps: CrashRecoveryDeps, options: { maxReloads?: number; windowMs?: number } = {}): CrashRecovery {
  const maxReloads = options.maxReloads ?? 3
  const windowMs = options.windowMs ?? 60_000
  /** When the page was loaded again after a crash, newest last, for the last minute only. */
  let reloads: number[] = []
  /** Whether a try is waiting for the minute to be over. */
  let waiting = false

  function reload(): void {
    reloads.push(deps.now())
    deps.reload()
  }

  return {
    onGone(reason) {
      if (reason === CLEAN_EXIT) return 'ignored'
      const now = deps.now()
      reloads = reloads.filter((at) => now - at <= windowMs)
      if (reloads.length >= maxReloads) {
        if (!waiting) {
          waiting = true
          deps.later(() => {
            waiting = false
            reload()
          }, windowMs)
        }
        return 'gave-up'
      }
      reload()
      return 'reloaded'
    },
  }
}
