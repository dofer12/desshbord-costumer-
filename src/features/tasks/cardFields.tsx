import type { ChangeEvent, ReactNode } from 'react'
import { fieldId } from './fieldId'

// The inputs of the card of a task. Each one has a visible label, and a message that is an alert
// and is tied to the input, so that it is read with it. The id is made from the id of the card and
// the name of the field, so that the card can put the focus on the first field that is wrong.

interface Common {
  /** The id of the card, which the ids of the fields are made from. */
  form: string
  name: string
  label: string
  /** What is wrong with the field, if anything. */
  error?: string
  /** What stands beside the input: a button to copy the value, a link to open it. */
  actions?: ReactNode
}

function Wrapper({ form, name, label, error, actions, children }: Common & { children: ReactNode }) {
  const id = fieldId(form, name)
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="field-line">
        {children}
        {actions}
      </div>
      {error && (
        <p role="alert" id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  )
}

const linked = (form: string, name: string, error?: string) => ({
  id: fieldId(form, name),
  'aria-invalid': error ? true : undefined,
  'aria-describedby': error ? `${fieldId(form, name)}-error` : undefined,
})

interface TextProps extends Common {
  value: string
  onChange(value: string): void
  /** `tel` for a phone number, `date` and `time` for the moment. */
  type?: 'text' | 'tel' | 'date' | 'time'
  /** A value that reads left to right inside Hebrew text: a phone number, an id. */
  ltr?: boolean
  /** Asks the dialog to put the focus here when it opens. */
  autofocus?: boolean
}

export function TextField(props: TextProps) {
  const { form, name, value, onChange, error, type = 'text', ltr = false, autofocus = false } = props
  return (
    <Wrapper {...props}>
      <input
        {...linked(form, name, error)}
        type={type}
        value={value}
        data-autofocus={autofocus ? '' : undefined}
        dir={ltr ? 'ltr' : undefined}
        className={ltr ? 'num' : undefined}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      />
    </Wrapper>
  )
}

interface TextAreaProps extends Common {
  value: string
  onChange(value: string): void
  rows?: number
}

export function TextAreaField(props: TextAreaProps) {
  const { form, name, value, onChange, error, rows = 3 } = props
  return (
    <Wrapper {...props}>
      <textarea {...linked(form, name, error)} rows={rows} value={value} onChange={(event) => onChange(event.target.value)} />
    </Wrapper>
  )
}

interface SelectProps extends Common {
  value: string
  onChange(value: string): void
  options: Array<{ value: string; label: string }>
}

export function SelectField(props: SelectProps) {
  const { form, name, value, onChange, error, options } = props
  return (
    <Wrapper {...props}>
      <select {...linked(form, name, error)} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Wrapper>
  )
}

interface CheckboxProps {
  form: string
  name: string
  label: string
  checked: boolean
  onChange(checked: boolean): void
}

export function CheckboxField({ form, name, label, checked, onChange }: CheckboxProps) {
  const id = fieldId(form, name)
  return (
    <div className="field check">
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <label htmlFor={id}>{label}</label>
    </div>
  )
}
