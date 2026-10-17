import { describe, expect, it } from 'vitest'
import { checkDisplayName, validateProfileForm } from './profileForm'

// The two things a person may change about themselves: the name that the team sees, and how many minutes
// before the due time a new task of theirs reminds them. The same limits as the function of the
// administrators (a name of 1 to 60 characters, trimmed, with no control characters).

const good = (name: string, remind: string) => {
  const result = validateProfileForm(name, remind)
  if (!result.ok) throw new Error(`expected a form that can be sent, got ${JSON.stringify(result.errors)}`)
  return result.input
}
const bad = (name: string, remind: string) => {
  const result = validateProfileForm(name, remind)
  if (result.ok) throw new Error(`expected a refusal, got ${JSON.stringify(result.input)}`)
  return result.errors
}

describe('the name', () => {
  it('is trimmed', () => {
    expect(good('  דנה כהן \n', '15').display_name).toBe('דנה כהן')
  })

  it.each([['nothing', ''], ['only spaces', '   '], ['only a line break', '\n']])('is asked for when it is %s', (_what, name) => {
    expect(bad(name, '15').name).toBe('הזינו שם.')
  })

  it('may have 60 characters and not 61, counted as a person counts them', () => {
    expect(good('א'.repeat(60), '15').display_name).toHaveLength(60)
    expect(bad('א'.repeat(61), '15').name).toBe('השם ארוך מדי: עד 60 תווים.')
    // An emoji is one character, though JavaScript counts two for it.
    expect(good('😀'.repeat(60), '15').display_name).toBe('😀'.repeat(60))
    expect(bad('😀'.repeat(61), '15').name).toBe('השם ארוך מדי: עד 60 תווים.')
  })

  it('may not hold a control character, such as a tab or a line break inside it', () => {
    for (const name of ['דנה\tכהן', 'דנה\nכהן', 'דנה\u0000כהן', 'דנה\u001fכהן', 'דנה\u007fכהן', 'דנה\u009fכהן']) {
      expect(bad(name, '15').name, JSON.stringify(name)).toBe('השם מכיל תו שאי אפשר להציג.')
    }
  })

  it('may have any letters, digits and marks in it', () => {
    expect(good("דנה כהן-לוי (המוקד) 2 O'Neil", '15').display_name).toBe("דנה כהן-לוי (המוקד) 2 O'Neil")
    // The characters at the edges of the ones that are refused: the tilde, a no-break space.
    expect(good('דנה~כהן', '15').display_name).toBe('דנה~כהן')
    expect(good('דנה\u00a0כהן', '15').display_name).toBe('דנה\u00a0כהן')
  })
})

describe('the default reminder', () => {
  it.each([['0', 0], ['15', 15], ['1440', 1440], [' 30 ', 30], ['007', 7]])('takes %j as %d minutes', (text, minutes) => {
    expect(good('דנה', text).default_remind_min).toBe(minutes)
  })

  it.each([
    ['nothing', ''],
    ['only spaces', '  '],
    ['a negative number', '-1'],
    ['more than a day', '1441'],
    ['a number with a fraction', '1.5'],
    ['a number with a comma', '1,5'],
    ['a word', 'abc'],
    ['an exponent', '1e2'],
    ['a sign', '+5'],
    ['digits of another alphabet', '١٥'],
    ['two numbers', '1 5'],
    ['too many digits', '00015'],
  ])('is refused when it is %s', (_what, text) => {
    expect(bad('דנה', text).remind).toBe('התזכורת היא מספר שלם של דקות, מ-0 עד 1440.')
  })
})

// The name of a person is judged the same wherever it is typed: the profile, the new employee, the rename.
describe('checkDisplayName', () => {
  it('says nothing about a name that can be used, trimmed or not', () => {
    expect(checkDisplayName('דנה כהן')).toBeNull()
    expect(checkDisplayName('  דנה כהן \n')).toBeNull()
  })

  it('says what is wrong with the other names, as the profile does', () => {
    expect(checkDisplayName('   ')).toBe('הזינו שם.')
    expect(checkDisplayName('דנה\tכהן')).toBe('השם מכיל תו שאי אפשר להציג.')
    expect(checkDisplayName('א'.repeat(61))).toBe('השם ארוך מדי: עד 60 תווים.')
    expect(checkDisplayName('א'.repeat(60))).toBeNull()
  })

  it('is what the form says about the name', () => {
    for (const text of ['', '   ', 'דנה', 'א'.repeat(61), 'דנה\tכהן']) {
      const result = validateProfileForm(text, '15')
      expect(result.ok ? null : (result.errors.name ?? null), JSON.stringify(text)).toBe(checkDisplayName(text))
    }
  })
})

describe('both together', () => {
  it('reports both problems at once, and sends nothing', () => {
    expect(bad('', 'x')).toEqual({ name: 'הזינו שם.', remind: 'התזכורת היא מספר שלם של דקות, מ-0 עד 1440.' })
  })

  it('sends exactly the two fields', () => {
    expect(validateProfileForm('דנה', '15')).toEqual({ ok: true, input: { display_name: 'דנה', default_remind_min: 15 } })
  })
})
