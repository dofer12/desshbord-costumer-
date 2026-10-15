import { describe, expect, it } from 'vitest'
import { newTask, type Task } from './model'
import { TASK_MESSAGES, fallbackTitle, fromDueAt, glassixUrl, toDueAt, validateTask } from './validation'

/** A task that passes every rule: it has an order number and the "no Glassix conversation" tick. */
function task(patch: Partial<Task> = {}): Task {
  return { ...newTask('user-1', 'task-1'), no_glassix: true, order_number: '1234', ...patch }
}
const noDue = { dueDate: '', dueTime: '' }

describe('fallbackTitle', () => {
  const base = { title: '', order_number: '', customer_name: '' }

  it('keeps the title that was typed', () => {
    expect(fallbackTitle({ ...base, title: 'לחזור ללקוח', order_number: '1234' })).toBe('לחזור ללקוח')
  })

  it('makes a title from the order number, without a leading #', () => {
    expect(fallbackTitle({ ...base, order_number: '#1234' })).toBe('טיפול בהזמנה #1234')
    expect(fallbackTitle({ ...base, order_number: '1234' })).toBe('טיפול בהזמנה #1234')
    expect(fallbackTitle({ ...base, order_number: ' # 1234 ' })).toBe('טיפול בהזמנה #1234')
  })

  it('makes a title from the customer name when there is no order number', () => {
    expect(fallbackTitle({ ...base, customer_name: 'דנה' })).toBe('לחזור אל דנה')
  })

  it('prefers the order number to the name, and gives nothing when there is neither', () => {
    expect(fallbackTitle({ ...base, order_number: '77', customer_name: 'דנה' })).toBe('טיפול בהזמנה #77')
    expect(fallbackTitle(base)).toBe('')
  })

  it('treats a title of spaces as no title', () => {
    expect(fallbackTitle({ ...base, title: '   ', customer_name: 'דנה' })).toBe('לחזור אל דנה')
  })
})

describe('validateTask', () => {
  it('accepts a general task with an order number and the Glassix tick', () => {
    expect(validateTask(task(), noDue)).toEqual({})
  })

  it('asks for a title and for a contact when the form has neither', () => {
    const errors = validateTask(task({ order_number: '' }), noDue)
    expect(errors).toEqual({ title: 'כתוב מה צריך לעשות, או מלא מספר הזמנה או שם לקוח.', contact: TASK_MESSAGES.contact })
  })

  it('accepts a customer name alone, because the title falls back to it', () => {
    expect(validateTask(task({ order_number: '', customer_name: 'דנה' }), noDue)).toEqual({})
  })

  it('counts a service call number or a phone as a contact, but they cannot make a title', () => {
    const expected = { title: 'כתוב מה צריך לעשות, או מלא מספר הזמנה או שם לקוח.' }
    expect(validateTask(task({ order_number: '', service_call_number: '77' }), noDue)).toEqual(expected)
    expect(validateTask(task({ order_number: '', customer_phone: '050-1234567' }), noDue)).toEqual(expected)
    expect(validateTask(task({ order_number: '', customer_phone: '050-1234567', title: 'להתקשר' }), noDue)).toEqual({})
  })

  it('does not count fields of spaces', () => {
    expect(validateTask(task({ order_number: '  ', customer_name: ' ', customer_phone: ' ' }), noDue)).toMatchObject({
      contact: TASK_MESSAGES.contact,
    })
  })

  it('refuses a time without a date', () => {
    expect(validateTask(task(), { dueDate: '', dueTime: '10:30' })).toEqual({
      due: 'נבחרה שעה בלי תאריך. בחר גם תאריך טיפול.',
    })
  })

  it('accepts a date without a time, and a date with a time', () => {
    expect(validateTask(task(), { dueDate: '2026-10-15', dueTime: '' })).toEqual({})
    expect(validateTask(task(), { dueDate: '2026-10-15', dueTime: '10:30' })).toEqual({})
  })

  it('refuses a date or a time that cannot exist', () => {
    const invalid = { due: 'התאריך או השעה לא תקינים.' }
    expect(validateTask(task(), { dueDate: '2026-02-30', dueTime: '' })).toEqual(invalid)
    expect(validateTask(task(), { dueDate: '2026-13-01', dueTime: '' })).toEqual(invalid)
    expect(validateTask(task(), { dueDate: '15/10/2026', dueTime: '' })).toEqual(invalid)
    expect(validateTask(task(), { dueDate: '2026-10-15', dueTime: '25:00' })).toEqual(invalid)
    expect(validateTask(task(), { dueDate: '2026-10-15', dueTime: '10:75' })).toEqual(invalid)
  })

  it('wants a Glassix conversation id or the tick', () => {
    expect(validateTask(task({ no_glassix: false }), noDue)).toEqual({ glassix: TASK_MESSAGES.glassix })
    expect(validateTask(task({ no_glassix: false, glassix_conversation_id: '  ' }), noDue)).toEqual({
      glassix: TASK_MESSAGES.glassix,
    })
    expect(validateTask(task({ no_glassix: false, glassix_conversation_id: 'c-4821' }), noDue)).toEqual({})
    expect(validateTask(task({ no_glassix: true, glassix_conversation_id: '' }), noDue)).toEqual({})
  })

  it('wants a product name for a pickup, and only for a pickup', () => {
    expect(validateTask(task({ kind: 'pickup' }), noDue)).toEqual({ product: TASK_MESSAGES.product })
    expect(validateTask(task({ kind: 'pickup', product_name: '  ' }), noDue)).toEqual({ product: TASK_MESSAGES.product })
    expect(validateTask(task({ kind: 'pickup', product_name: 'מקדחה' }), noDue)).toEqual({})
    expect(validateTask(task({ kind: 'delivery' }), noDue)).toEqual({})
  })

  it('reports every problem at once', () => {
    const errors = validateTask(task({ kind: 'pickup', order_number: '', no_glassix: false }), {
      dueDate: '',
      dueTime: '09:00',
    })
    expect(Object.keys(errors).sort()).toEqual(['contact', 'due', 'glassix', 'product', 'title'])
  })
})

describe('toDueAt and fromDueAt', () => {
  it('gives no moment for no date', () => {
    expect(toDueAt('', '')).toBeNull()
    expect(toDueAt('  ', '10:00')).toBeNull()
    expect(fromDueAt(null)).toEqual({ dueDate: '', dueTime: '' })
  })

  it('reads a date without a time as 09:00 in Jerusalem, in summer time', () => {
    expect(toDueAt('2026-10-15', '')).toBe('2026-10-15T06:00:00.000Z')
  })

  it('reads a date without a time as 09:00 in Jerusalem, in winter time', () => {
    expect(toDueAt('2026-10-26', '')).toBe('2026-10-26T07:00:00.000Z')
    expect(toDueAt('2026-01-15', '')).toBe('2026-01-15T07:00:00.000Z')
  })

  it('follows the clock changes of 2026, on either side', () => {
    // The clocks go forward on Friday 27 March at 02:00, and back on Sunday 25 October at 02:00.
    expect(toDueAt('2026-03-26', '')).toBe('2026-03-26T07:00:00.000Z')
    expect(toDueAt('2026-03-27', '')).toBe('2026-03-27T06:00:00.000Z')
    expect(toDueAt('2026-10-24', '')).toBe('2026-10-24T06:00:00.000Z')
    expect(toDueAt('2026-10-25', '')).toBe('2026-10-25T07:00:00.000Z')
  })

  it('takes a time of day when there is one', () => {
    expect(toDueAt('2026-10-15', '14:30')).toBe('2026-10-15T11:30:00.000Z')
  })

  it('keeps the Jerusalem date for a time just after midnight, when UTC is still on the day before', () => {
    expect(toDueAt('2026-10-15', '00:30')).toBe('2026-10-14T21:30:00.000Z')
    expect(fromDueAt('2026-10-14T21:30:00.000Z')).toEqual({ dueDate: '2026-10-15', dueTime: '00:30' })
  })

  it('gives back the date and the time that went in, on every day of the year', () => {
    for (let day = 0; day < 365; day++) {
      const date = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10)
      for (const time of ['00:00', '01:30', '09:00', '12:00', '23:59']) {
        expect(fromDueAt(toDueAt(date, time)), `${date} ${time}`).toEqual({ dueDate: date, dueTime: time })
      }
    }
  })

  it('shows the 09:00 that a date without a time stands for', () => {
    expect(fromDueAt(toDueAt('2026-10-15', ''))).toEqual({ dueDate: '2026-10-15', dueTime: '09:00' })
  })

  it('moves a time that the clock skips to the same minute after the jump', () => {
    // On 27 March 2026 the clock goes from 02:00 to 03:00, so 02:30 does not exist.
    expect(fromDueAt(toDueAt('2026-03-27', '02:30'))).toEqual({ dueDate: '2026-03-27', dueTime: '03:30' })
  })

  it('accepts a time that happens twice when the clock goes back', () => {
    expect(fromDueAt(toDueAt('2026-10-25', '01:30'))).toEqual({ dueDate: '2026-10-25', dueTime: '01:30' })
  })

  it('throws for a date or a time that cannot exist', () => {
    expect(() => toDueAt('2026-02-30', '')).toThrow()
    expect(() => toDueAt('2026-13-01', '')).toThrow()
    expect(() => toDueAt('not a date', '')).toThrow()
    expect(() => toDueAt('2026-10-15', '24:00')).toThrow()
    expect(() => toDueAt('2026-10-15', '9:5')).toThrow()
  })

  it('shows nothing for a value that is not a date', () => {
    expect(fromDueAt('garbage')).toEqual({ dueDate: '', dueTime: '' })
  })
})

describe('glassixUrl', () => {
  const template = 'https://app.glassix.example/conversations/{id}'

  it('puts the conversation id into the template', () => {
    expect(glassixUrl(template, 'c-4821')).toBe('https://app.glassix.example/conversations/c-4821')
  })

  it('encodes an id that has a space or a slash, so it stays one piece of the address', () => {
    expect(glassixUrl(template, 'a b/c')).toBe('https://app.glassix.example/conversations/a%20b%2Fc')
    expect(glassixUrl(template, ' c-1 ')).toBe('https://app.glassix.example/conversations/c-1')
  })

  it('fills every {id} of the template', () => {
    expect(glassixUrl('https://example.com/{id}?ref={id}', 'x')).toBe('https://example.com/x?ref=x')
  })

  it('gives no link without an id', () => {
    expect(glassixUrl(template, '')).toBeNull()
    expect(glassixUrl(template, '   ')).toBeNull()
  })

  it('gives no link without a template, or with one that has no {id}', () => {
    expect(glassixUrl('', 'c-1')).toBeNull()
    expect(glassixUrl('https://example.com/conversations', 'c-1')).toBeNull()
  })

  it('gives no link for a template that is not https', () => {
    expect(glassixUrl('http://example.com/{id}', 'c-1')).toBeNull()
    expect(glassixUrl('javascript:alert("{id}")', 'c-1')).toBeNull()
    expect(glassixUrl('//example.com/{id}', 'c-1')).toBeNull()
    expect(glassixUrl('example.com/{id}', 'c-1')).toBeNull()
  })

  it('gives no link when the filled template is not an address', () => {
    expect(glassixUrl('https://{id}', 'a b')).toBeNull()
  })
})
