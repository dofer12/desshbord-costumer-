// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createCrashRecovery } from './crashRecovery'

// The window of the Windows app lives for days in the tray, and the reminders are timers of its page.
// When the page crashes, the timers are gone and nothing rings, so the page is loaded again; but a page
// that crashes as it loads must not be loaded again at once, for ever: it is left for a minute.

function setup(options: { maxReloads?: number; windowMs?: number } = {}) {
  let now = 1_000_000
  const reload = vi.fn()
  const timers: Array<{ at: number; run: () => void }> = []
  const recovery = createCrashRecovery(
    { now: () => now, reload, later: (run, ms) => void timers.push({ at: now + ms, run }) },
    options,
  )
  return {
    recovery,
    reload,
    timers,
    /** Lets time pass, and runs what was asked to run in it, in order. */
    advance(ms: number) {
      const end = now + ms
      for (;;) {
        const next = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0]
        if (!next) break
        timers.splice(timers.indexOf(next), 1)
        now = Math.max(now, next.at)
        next.run()
      }
      now = end
    },
  }
}

describe('a page that is gone', () => {
  it.each(['crashed', 'abnormal-exit', 'killed', 'oom', 'launch-failed', 'integrity-failure'])('is loaded again after "%s"', (reason) => {
    const { recovery, reload } = setup()
    expect(recovery.onGone(reason)).toBe('reloaded')
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('is left alone after a clean exit, which is the page closing as it was asked to', () => {
    const { recovery, reload } = setup()
    expect(recovery.onGone('clean-exit')).toBe('ignored')
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('a page that keeps crashing', () => {
  it('is loaded again three times in a minute, and then left, so that a page that crashes as it loads does not loop', () => {
    const { recovery, reload, advance } = setup()
    expect(recovery.onGone('crashed')).toBe('reloaded')
    advance(5_000)
    expect(recovery.onGone('crashed')).toBe('reloaded')
    advance(5_000)
    expect(recovery.onGone('crashed')).toBe('reloaded')
    advance(5_000)
    expect(recovery.onGone('crashed')).toBe('gave-up')
    expect(reload).toHaveBeenCalledTimes(3)
  })

  it('is loaded again once the minute has passed since the crashes that counted', () => {
    const { recovery, reload, advance } = setup()
    for (let i = 0; i < 3; i++) recovery.onGone('crashed')
    expect(recovery.onGone('crashed')).toBe('gave-up')
    advance(60_001) // the try that was waiting is the fourth reload
    expect(reload).toHaveBeenCalledTimes(4)
    expect(recovery.onGone('crashed')).toBe('reloaded') // and the crashes of the minute before no longer count
    expect(reload).toHaveBeenCalledTimes(5)
  })

  it('forgets a crash after a minute, one at a time, as the minute slides', () => {
    const { recovery, advance } = setup()
    recovery.onGone('crashed') // at 0
    advance(40_000)
    recovery.onGone('crashed') // at 40 s
    recovery.onGone('crashed') // at 40 s
    expect(recovery.onGone('crashed')).toBe('gave-up')
    advance(21_000) // 61 s: the first one is out of the minute, the other two are in
    expect(recovery.onGone('crashed')).toBe('reloaded')
    expect(recovery.onGone('crashed')).toBe('gave-up')
  })

  it('counts a reload for the whole of its minute, and forgets it one moment after', () => {
    const { recovery, advance } = setup({ maxReloads: 1 })
    recovery.onGone('crashed') // at 0
    advance(60_000)
    expect(recovery.onGone('crashed')).toBe('gave-up') // exactly a minute later it still counts
    const second = setup({ maxReloads: 1 })
    second.recovery.onGone('crashed')
    second.advance(60_001)
    expect(second.recovery.onGone('crashed')).toBe('reloaded') // a moment later it does not
  })

  it('tries once more when the minute is over, so that a page that was gone for a while comes back', () => {
    const { recovery, reload, advance } = setup()
    for (let i = 0; i < 3; i++) recovery.onGone('crashed')
    expect(recovery.onGone('crashed')).toBe('gave-up')
    expect(reload).toHaveBeenCalledTimes(3)
    advance(59_000)
    expect(reload).toHaveBeenCalledTimes(3)
    advance(2_000)
    expect(reload).toHaveBeenCalledTimes(4)
  })

  it('has one more try waiting at most, however many times it gave up', () => {
    const { recovery, reload, advance, timers } = setup()
    for (let i = 0; i < 3; i++) recovery.onGone('crashed')
    for (let i = 0; i < 5; i++) recovery.onGone('crashed')
    expect(timers).toHaveLength(1)
    advance(61_000)
    expect(reload).toHaveBeenCalledTimes(4)
  })

  it('counts the try as a reload, and waits another minute when that page goes at once too', () => {
    const { recovery, reload, advance } = setup({ maxReloads: 1 })
    recovery.onGone('crashed')
    expect(recovery.onGone('crashed')).toBe('gave-up')
    advance(61_000) // the try: the second reload
    expect(reload).toHaveBeenCalledTimes(2)
    expect(recovery.onGone('crashed')).toBe('gave-up') // it went at once, so it is left again
    advance(61_000)
    expect(reload).toHaveBeenCalledTimes(3)
  })

  it('does not count a clean exit among the crashes', () => {
    const { recovery } = setup()
    for (let i = 0; i < 10; i++) recovery.onGone('clean-exit')
    expect(recovery.onGone('crashed')).toBe('reloaded')
  })

  it('takes the number of reloads and the length of the minute from its options', () => {
    const { recovery, reload, advance } = setup({ maxReloads: 1, windowMs: 1_000 })
    expect(recovery.onGone('crashed')).toBe('reloaded')
    expect(recovery.onGone('crashed')).toBe('gave-up')
    advance(999)
    expect(reload).toHaveBeenCalledTimes(1)
    advance(2) // the try comes after the length of the minute that was given
    expect(reload).toHaveBeenCalledTimes(2)
  })
})
