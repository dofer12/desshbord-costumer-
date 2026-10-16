import { describe, expect, it } from 'vitest'
import type { Profile } from '../auth/types'
import type { Status, TaskEvent, TaskEventType } from './gateways'
import { ACTOR_SYSTEM, ACTOR_UNKNOWN, actorName, describeEvent, shorten, type Names } from './historyText'

const status = (key: string, name_he: string, sort: number): Status => ({ key, name_he, color: '#000000', sort, is_active: true })
const person = (id: string, display_name: string, is_active = true): Profile => ({
  id,
  email: `${id}@example.com`,
  display_name,
  role: 'employee',
  is_active,
  must_change_password: false,
})

const NAMES: Names = {
  statuses: [status('processing', 'בטיפול', 1), status('completed', 'הושלמו', 3)],
  profiles: [person('u-dana', 'דנה'), person('u-owner', 'הבעלים'), person('u-gone', 'אבי', false)],
}

function event(type: TaskEventType, changes: Record<string, [unknown, unknown]> = {}, actor: string | null = 'u-dana'): TaskEvent {
  return { id: 1, task_id: 'a', actor_id: actor, type, changes, at: '2026-10-12T07:03:00.000Z' }
}

const lines = (type: TaskEventType, changes: Record<string, [unknown, unknown]> = {}) => describeEvent(event(type, changes), NAMES)
const updated = (changes: Record<string, [unknown, unknown]>) => lines('updated', changes)

describe('actorName', () => {
  it('gives the name of the person, also of one who is not active any more', () => {
    expect(actorName('u-dana', NAMES.profiles)).toBe('דנה')
    expect(actorName('u-gone', NAMES.profiles)).toBe('אבי')
  })

  it('says "the system" when nobody made the change, and "another user" for somebody the directory does not know', () => {
    expect(actorName(null, NAMES.profiles)).toBe('המערכת')
    expect(ACTOR_SYSTEM).toBe('המערכת')
    expect(actorName('u-nobody', NAMES.profiles)).toBe('משתמש אחר')
    expect(ACTOR_UNKNOWN).toBe('משתמש אחר')
  })
})

describe('shorten', () => {
  it('leaves a short text alone, and puts a single space between the words of a text with line breaks', () => {
    expect(shorten('שלום עולם')).toBe('שלום עולם')
    expect(shorten('  שורה\n\nשנייה \t שלישית ')).toBe('שורה שנייה שלישית')
  })

  it('cuts a text that is longer than 60 characters, and shows that it was cut', () => {
    const long = 'א'.repeat(61)
    expect(shorten(long)).toBe(`${'א'.repeat(59)}…`)
    expect(shorten(long)).toHaveLength(60)
    expect(shorten('א'.repeat(60))).toBe('א'.repeat(60))
  })

  it('does not leave a space before the dots', () => {
    expect(shorten(`${'א'.repeat(58)} ${'ב'.repeat(10)}`)).toBe(`${'א'.repeat(58)}…`)
  })
})

describe('describeEvent: the events that say what happened', () => {
  it.each([
    ['created', 'המשימה נוצרה'],
    ['done', 'המשימה סומנה כבוצעה'],
    ['reopened', 'סימון הביצוע בוטל'],
    ['deleted', 'המשימה נמחקה'],
    ['restored', 'המשימה שוחזרה'],
    ['attachment_added', 'נוספה תמונה'],
    ['attachment_removed', 'הוסרה תמונה'],
  ] as Array<[TaskEventType, string]>)('says what a "%s" event is', (type, text) => {
    expect(lines(type)).toEqual([text])
  })

  it('does not put what changed into the sentence of a "done" event, which would only repeat it', () => {
    expect(lines('done', { done_at: [null, '2026-10-12T07:03:00.000Z'] })).toEqual(['המשימה סומנה כבוצעה'])
  })
})

describe('describeEvent: the status and the person', () => {
  it('shows the names of the statuses', () => {
    expect(lines('status', { status_key: ['processing', 'completed'] })).toEqual(['סטטוס: מ-בטיפול ל-הושלמו'])
  })

  it('shows the key of a status that is not known, as it is', () => {
    expect(lines('status', { status_key: ['processing', 'retired'] })).toEqual(['סטטוס: מ-בטיפול ל-retired'])
  })

  it('says who the task was given to, and who it was taken from', () => {
    expect(lines('assigned', { assignee_id: [null, 'u-dana'] })).toEqual(['שיוך: נקבע ל-דנה'])
    expect(lines('assigned', { assignee_id: ['u-dana', null] })).toEqual(['שיוך: הוסר (היה דנה)'])
    expect(lines('assigned', { assignee_id: ['u-dana', 'u-owner'] })).toEqual(['שיוך: מ-דנה ל-הבעלים'])
  })

  it('names a person who is not known as such', () => {
    expect(lines('assigned', { assignee_id: ['u-nobody', 'u-dana'] })).toEqual(['שיוך: מ-משתמש לא ידוע ל-דנה'])
  })

  it('counts an empty text as nobody, as well as nothing', () => {
    expect(lines('assigned', { assignee_id: ['', 'u-dana'] })).toEqual(['שיוך: נקבע ל-דנה'])
    expect(lines('assigned', { assignee_id: ['u-dana', ''] })).toEqual(['שיוך: הוסר (היה דנה)'])
  })

  it('has a line for a status event that holds nothing, and not an empty one', () => {
    expect(lines('status')).toEqual(['הסטטוס שונה'])
    expect(lines('assigned')).toEqual(['השיוך שונה'])
  })
})

describe('describeEvent: an update of fields', () => {
  it('names the field in Hebrew and shows the old and the new text', () => {
    expect(updated({ title: ['לחזור ללקוח', 'לחזור ללקוחה'] })).toEqual(['כותרת: מ-לחזור ללקוח ל-לחזור ללקוחה'])
    expect(updated({ customer_phone: ['050-1', '050-2'] })).toEqual(['טלפון: מ-050-1 ל-050-2'])
  })

  it('has a line for each field, in the order of the card, whatever the order they came in', () => {
    expect(updated({ ship_to: ['', 'רחוב 1'], notes: ['', 'חשוב'], title: ['א', 'ב'], order_number: ['1', '2'] })).toEqual([
      'כותרת: מ-א ל-ב',
      'הערות: נקבע ל-חשוב',
      'מספר הזמנה: מ-1 ל-2',
      'כתובת למשלוח: נקבע ל-רחוב 1',
    ])
  })

  it('says that a field was set, and that it was taken away with what it was', () => {
    expect(updated({ notes: ['', 'חשוב'] })).toEqual(['הערות: נקבע ל-חשוב'])
    expect(updated({ notes: [undefined, 'חשוב'] })).toEqual(['הערות: נקבע ל-חשוב'])
    expect(updated({ notes: ['חשוב', undefined] })).toEqual(['הערות: הוסר (היה חשוב)'])
    expect(updated({ notes: [null, 'חשוב'] })).toEqual(['הערות: נקבע ל-חשוב'])
    expect(updated({ notes: ['חשוב', ''] })).toEqual(['הערות: הוסר (היה חשוב)'])
    expect(updated({ notes: ['חשוב', null] })).toEqual(['הערות: הוסר (היה חשוב)'])
  })

  it('shortens a long text, so that the history stays a list of lines', () => {
    const long = `${'מילה '.repeat(30)}סוף`
    const [line] = updated({ notes: [long, 'קצר'] })
    expect(line).toBe(`הערות: מ-${shorten(long)} ל-קצר`)
    expect(line.length).toBeLessThan(100)
  })

  it('shows yes and no for a tick', () => {
    expect(updated({ no_glassix: [false, true] })).toEqual(['אין שיחה ב-Glassix: מ-לא ל-כן'])
    expect(updated({ sent_to_cargo: [true, false] })).toEqual(['נשלח ל-CARGO: מ-כן ל-לא'])
  })

  it('shows the kind and the priority by their names', () => {
    expect(updated({ kind: ['general', 'pickup'], priority: ['normal', 'urgent'] })).toEqual(['סוג: מ-כללית ל-איסוף', 'עדיפות: מ-רגילה ל-דחוף מאוד'])
  })

  it('shows a kind or a priority that it does not know as it was written', () => {
    expect(updated({ kind: ['x', 'general'], priority: ['normal', 'weird'] })).toEqual(['סוג: מ-x ל-כללית', 'עדיפות: מ-רגילה ל-weird'])
  })

  it('shows a moment as a date and a time on the wall in Jerusalem', () => {
    expect(updated({ due_at: [null, '2026-10-16T06:00:00.000Z'] })).toEqual(['מועד: נקבע ל-16.10.2026 09:00'])
    expect(updated({ due_at: ['2026-10-16T06:00:00.000Z', '2026-12-01T10:30:00.000Z'] })).toEqual(['מועד: מ-16.10.2026 09:00 ל-1.12.2026 12:30'])
    expect(updated({ due_at: ['2026-10-16T06:00:00.000Z', null] })).toEqual(['מועד: הוסר (היה 16.10.2026 09:00)'])
  })

  it('shows a moment that is not a date as it was written', () => {
    expect(updated({ due_at: ['not a date', '2026-10-16T06:00:00.000Z'] })).toEqual(['מועד: מ-not a date ל-16.10.2026 09:00'])
  })

  it('shows a length or a reminder that is not a number as it was written', () => {
    expect(updated({ remind_min: ['x', null] })).toEqual(['תזכורת: הוסר (היה x)'])
  })

  it('shows the length and the reminder in words', () => {
    expect(updated({ duration_min: [30, 60] })).toEqual(['משך: מ-30 דקות ל-60 דקות'])
    expect(updated({ remind_min: [null, 10] })).toEqual(['תזכורת: נקבע ל-10 דקות לפני'])
    expect(updated({ remind_min: [10, 0] })).toEqual(['תזכורת: מ-10 דקות לפני ל-בזמן המשימה'])
  })

  it('shows the person, the status and the date of finishing by name, the same as their own events do', () => {
    expect(updated({ status_key: ['processing', 'completed'], assignee_id: ['u-dana', 'u-owner'] })).toEqual(['שיוך: מ-דנה ל-הבעלים', 'סטטוס: מ-בטיפול ל-הושלמו'])
    expect(updated({ done_at: ['2026-10-16T06:00:00.000Z', '2026-10-17T06:00:00.000Z'] })).toEqual(['מועד הסיום: מ-16.10.2026 09:00 ל-17.10.2026 09:00'])
  })

  it('says only that the picture of the product was set, taken away or replaced, not the ids', () => {
    expect(updated({ thumb_attachment_id: [null, 'p1'] })).toEqual(['תמונת מוצר: נקבעה'])
    expect(updated({ thumb_attachment_id: ['p1', null] })).toEqual(['תמונת מוצר: הוסרה'])
    expect(updated({ thumb_attachment_id: ['p1', 'p2'] })).toEqual(['תמונת מוצר: הוחלפה'])
  })

  it('has the title before the kind, as the card has it', () => {
    expect(updated({ kind: ['general', 'pickup'], title: ['א', 'ב'] })).toEqual(['כותרת: מ-א ל-ב', 'סוג: מ-כללית ל-איסוף'])
  })

  it('does not show the picture of the product when it stays without one, or a change of three values', () => {
    expect(updated({ thumb_attachment_id: [null, null] })).toEqual(['פרטי המשימה עודכנו'])
    expect(updated({ title: ['a', 'b', 'c'] as unknown as [unknown, unknown] })).toEqual(['פרטי המשימה עודכנו'])
    expect(updated({ title: 'ab' as unknown as [unknown, unknown] })).toEqual(['פרטי המשימה עודכנו'])
  })

  it('does not show a field that the person never sees, and does not show a change that is nothing', () => {
    expect(updated({ legacy_id: [null, 'L1'], legacy_handler: ['', 'x'], title: ['א', 'ב'] })).toEqual(['כותרת: מ-א ל-ב'])
    expect(updated({ notes: ['', null] })).toEqual(['פרטי המשימה עודכנו'])
  })

  it('says that the details were updated when no field of the event is one that is shown', () => {
    expect(updated({ legacy_id: [null, 'L1'] })).toEqual(['פרטי המשימה עודכנו'])
    expect(updated({})).toEqual(['פרטי המשימה עודכנו'])
  })

  it('skips a field whose change is not a pair of an old and a new value, instead of failing', () => {
    expect(updated({ title: 'not a pair' as unknown as [unknown, unknown], notes: ['', 'x'] })).toEqual(['הערות: נקבע ל-x'])
  })

  it('shows a value of a kind that it does not expect as text', () => {
    expect(updated({ duration_min: ['x', null] })).toEqual(['משך: הוסר (היה x)'])
    expect(updated({ no_glassix: ['yes', 'no'] })).toEqual(['אין שיחה ב-Glassix: מ-yes ל-no'])
  })
})
