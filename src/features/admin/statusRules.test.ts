import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Status } from '../tasks/gateways'
import { freeStatusName, MAX_STATUS_NAME, newStatusKey, nextStatusSort, normalizeColor, openTasksNote, validateStatus } from './statusRules'

// What a status may be called and look like, and how a new one gets its key and its place. The key is made
// by the app and never by the person: it is how tasks keep their status, and it never changes.

const status = (key: string, name_he: string, patch: Partial<Status> = {}): Status => ({ key, name_he, color: '#22a559', sort: 1, is_active: true, ...patch })
const OTHERS = [status('processing', 'בטיפול'), status('cargo', 'Send to CARGO'), status('abroad', 'הזמנת חו"ל', { is_active: false })]

afterEach(() => {
  vi.restoreAllMocks()
})

describe('newStatusKey', () => {
  const SPACE = 36 ** 6
  const key = (n: number) => `custom-${n.toString(36).padStart(6, '0')}`
  /** The greatest number that Math.random() can give: the one just under 1. */
  const LAST_RANDOM = 1 - 2 ** -53

  it('is "custom-" and six lower-case letters or digits', () => {
    for (let i = 0; i < 50; i++) expect(newStatusKey([])).toMatch(/^custom-[a-z0-9]{6}$/)
  })

  it('is made from the random source, and from the whole range of it', () => {
    expect(newStatusKey([], () => 0)).toBe('custom-000000')
    expect(newStatusKey([], () => 0.5)).toBe(key(SPACE / 2))
    expect(newStatusKey([], () => LAST_RANDOM)).toBe('custom-zzzzzz')
  })

  it('takes Math.random when it is not given one', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25)
    expect(newStatusKey([])).toBe(key(SPACE / 4))
  })

  it('is never a key that exists, even when the random source says the same again and again', () => {
    const existing: string[] = []
    const made = new Set<string>()
    for (let i = 0; i < 30; i++) {
      const next = newStatusKey(existing, () => 0.123)
      expect(existing).not.toContain(next)
      made.add(next)
      existing.push(next)
    }
    expect(made.size).toBe(30)
  })

  it('goes on to the next key that is free, and round to the beginning at the end of the range', () => {
    expect(newStatusKey(['custom-000000'], () => 0)).toBe('custom-000001')
    expect(newStatusKey(['custom-000000', 'custom-000001', 'custom-000002'], () => 0)).toBe('custom-000003')
    expect(newStatusKey(['custom-zzzzzz'], () => LAST_RANDOM)).toBe('custom-000000')
  })

  it('is not one of the keys that the statuses of the old app have', () => {
    expect(newStatusKey(['processing', 'to-branch', 'on-hold'], () => 0)).toBe('custom-000000')
  })
})

describe('freeStatusName', () => {
  const named = (...names: string[]) => names.map((name_he) => ({ name_he }))

  it('is "סטטוס חדש" when no status has that name', () => {
    expect(freeStatusName([])).toBe('סטטוס חדש')
    expect(freeStatusName(named('בטיפול', 'הושלמו'))).toBe('סטטוס חדש')
  })

  it('goes on to the first of the numbered names that nobody has', () => {
    expect(freeStatusName(named('סטטוס חדש'))).toBe('סטטוס חדש 2')
    expect(freeStatusName(named('סטטוס חדש', 'סטטוס חדש 2'))).toBe('סטטוס חדש 3')
    expect(freeStatusName(named('סטטוס חדש', 'סטטוס חדש 3'))).toBe('סטטוס חדש 2')
  })

  it('compares the names as validateStatus does: without the spaces around them', () => {
    expect(freeStatusName(named('  סטטוס חדש '))).toBe('סטטוס חדש 2')
  })

  it('makes a name that validateStatus takes, whatever the statuses are called', () => {
    const others = [status('a', 'סטטוס חדש'), status('b', 'סטטוס חדש 2')]
    expect(validateStatus({ name_he: freeStatusName(others), color: '#6b7280' }, others)).toBeNull()
  })
})

describe('openTasksNote', () => {
  it('says nothing when no open task has the status', () => {
    expect(openTasksNote(0)).toBeNull()
  })

  it('says it in the singular for one task and in the plural, with the number, for more', () => {
    expect(openTasksNote(1)).toBe('יש משימה פתוחה אחת בסטטוס הזה. היא שומרת אותו.')
    expect(openTasksNote(2)).toBe('יש 2 משימות פתוחות בסטטוס הזה. הן שומרות אותו.')
    expect(openTasksNote(137)).toBe('יש 137 משימות פתוחות בסטטוס הזה. הן שומרות אותו.')
  })
})

describe('nextStatusSort', () => {
  it('is the place after the last one, wherever it is in the list', () => {
    expect(nextStatusSort([])).toBe(1)
    expect(nextStatusSort([{ sort: 1 }, { sort: 17 }, { sort: 5 }])).toBe(18)
    expect(nextStatusSort([{ sort: 0 }])).toBe(1)
  })
})

describe('normalizeColor', () => {
  it('is lower-case and has no space around it', () => {
    expect(normalizeColor('#ABCDEF')).toBe('#abcdef')
    expect(normalizeColor('  #AbCdEf ')).toBe('#abcdef')
    expect(normalizeColor('#abcdef')).toBe('#abcdef')
  })
})

describe('validateStatus', () => {
  const good = { name_he: 'ממתין ללקוח', color: '#a1b2c3' }

  it('says nothing about a name and a colour that can be used', () => {
    expect(validateStatus(good, OTHERS)).toBeNull()
    expect(validateStatus(good, [])).toBeNull()
  })

  it.each([
    ['nothing', ''],
    ['only spaces', '   '],
  ])('asks for a name when it is %s', (_what, name_he) => {
    expect(validateStatus({ ...good, name_he }, OTHERS)).toBe('הזינו שם לסטטוס.')
  })

  it('takes a name of 40 characters, counted as a person counts them, and not one of 41', () => {
    expect(MAX_STATUS_NAME).toBe(40)
    expect(validateStatus({ ...good, name_he: 'א'.repeat(40) }, OTHERS)).toBeNull()
    expect(validateStatus({ ...good, name_he: 'א'.repeat(41) }, OTHERS)).toBe('השם ארוך מדי: עד 40 תווים.')
    expect(validateStatus({ ...good, name_he: '😀'.repeat(40) }, OTHERS)).toBeNull()
    expect(validateStatus({ ...good, name_he: '😀'.repeat(41) }, OTHERS)).toBe('השם ארוך מדי: עד 40 תווים.')
  })

  it('measures the name without the spaces around it', () => {
    expect(validateStatus({ ...good, name_he: `  ${'א'.repeat(40)}  ` }, OTHERS)).toBeNull()
  })

  it('refuses a name that another status has, whatever the case and the spaces around it', () => {
    expect(validateStatus({ ...good, name_he: 'בטיפול' }, OTHERS)).toBe('יש כבר סטטוס בשם הזה.')
    expect(validateStatus({ ...good, name_he: '  בטיפול ' }, OTHERS)).toBe('יש כבר סטטוס בשם הזה.')
    expect(validateStatus({ ...good, name_he: 'SEND TO cargo' }, OTHERS)).toBe('יש כבר סטטוס בשם הזה.')
  })

  it('compares with the names of the others as they are kept, with spaces around them or without', () => {
    expect(validateStatus({ ...good, name_he: 'ממתין' }, [status('x', '  ממתין ')])).toBe('יש כבר סטטוס בשם הזה.')
    expect(validateStatus({ ...good, name_he: 'ממתין' }, [status('x', 'ממתין  ')])).toBe('יש כבר סטטוס בשם הזה.')
  })

  it('counts the names of the statuses that are blocked, too: they come back', () => {
    expect(validateStatus({ ...good, name_he: 'הזמנת חו"ל' }, OTHERS)).toBe('יש כבר סטטוס בשם הזה.')
  })

  it('takes the name of the status itself when it is not among the others, which is how a status keeps its name', () => {
    expect(validateStatus({ ...good, name_he: 'בטיפול' }, OTHERS.slice(1))).toBeNull()
  })

  it('refuses a name with a character that cannot be shown', () => {
    expect(validateStatus({ ...good, name_he: 'ממתין\tללקוח' }, OTHERS)).toBe('השם מכיל תו שאי אפשר להציג.')
  })

  it.each(['#ABCDEF', '#abcdef', '#012345', '#a1B2c3', '  #abcdef  '])('takes the colour %j', (color) => {
    expect(validateStatus({ ...good, color }, OTHERS)).toBeNull()
  })

  it.each([
    ['nothing', ''],
    ['no hash', 'abcdef'],
    ['three digits', '#abc'],
    ['five digits', '#abcde'],
    ['seven digits', '#abcdef0'],
    ['a letter beyond f', '#abcdeg'],
    ['a name of a colour', 'red'],
    ['a function', 'rgb(1,2,3)'],
    ['a hash and spaces', '# abcdef'],
    ['two hashes', '##abcdef'],
  ])('refuses the colour of %s', (_what, color) => {
    expect(validateStatus({ ...good, color }, OTHERS)).toBe('הצבע צריך להיות בצורה #rrggbb.')
  })

  it('says what is wrong with the name first, when both are', () => {
    expect(validateStatus({ name_he: '', color: 'red' }, OTHERS)).toBe('הזינו שם לסטטוס.')
  })
})
