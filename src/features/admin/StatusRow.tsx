import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Status } from '../tasks/gateways'
import type { StatusPatch } from './gateways'
import { checkColor, checkStatusName, normalizeColor, openTasksNote } from './statusRules'

/** What came of a request to save: it worked, it failed (and the page said why), or another one was still on its way and nothing was sent. */
export type SaveResult = 'saved' | 'failed' | 'skipped'

/** Where the cursor goes when the row is where it is meant to be. */
export type FocusTarget = 'name' | 'up' | 'down'

/** Enter saves what is in the field and Escape gives the change up. A keyboard that is still composing a word is left alone. */
function onKeys(event: KeyboardEvent<HTMLInputElement>, save: () => void, giveUp: () => void) {
  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
    event.preventDefault()
    save()
  } else if (event.key === 'Escape') {
    giveUp()
  }
}

/** The colour that the swatch and the colour input show: the code being typed when it is one, else the colour that the status has. */
function shownColor(draft: string, saved: string): string {
  if (checkColor(draft) === null) return normalizeColor(draft)
  return checkColor(saved) === null ? normalizeColor(saved) : '#000000'
}

interface Props {
  status: Status
  /** The other statuses, the blocked ones too: a name may not be the name of one of them. */
  others: Status[]
  index: number
  count: number
  /** How many open tasks have this status. */
  openTasks: number
  /** A request is on its way: nothing else is sent until it is answered. */
  busy: boolean
  onSave(patch: StatusPatch): Promise<SaveResult>
  onMove(direction: 'up' | 'down'): void
  /** Where the cursor goes now, or null. The row says so when it has put it there. */
  focusRequest: FocusTarget | null
  onFocused(): void
}

/**
 * One status: its colour, its name, whether it is in use, and its place in the order. The name and the
 * colour are edited in the row and saved when the person presses Enter or leaves the field (Escape gives
 * the change up); what is wrong with them is said in the row, and nothing is sent until it is put right.
 * What the row shows is always what the server has, except for what is being typed.
 */
export function StatusRow({ status, others, index, count, openTasks, busy, onSave, onMove, focusRequest, onFocused }: Props) {
  const [name, setName] = useState(status.name_he)
  const [color, setColor] = useState(status.color)
  const [seenName, setSeenName] = useState(status.name_he)
  const [seenColor, setSeenColor] = useState(status.color)
  const [nameProblem, setNameProblem] = useState<string | null>(null)
  const [colorProblem, setColorProblem] = useState<string | null>(null)
  const nameProblemId = useId()
  const colorProblemId = useId()

  const nameInput = useRef<HTMLInputElement>(null)
  const colorInput = useRef<HTMLInputElement>(null)
  const up = useRef<HTMLButtonElement>(null)
  const down = useRef<HTMLButtonElement>(null)

  // What the server has is what the row shows: a name or a colour that changed there (here, a moment ago,
  // or by another administrator) replaces what is in the field.
  if (status.name_he !== seenName) {
    setSeenName(status.name_he)
    setName(status.name_he)
    setNameProblem(null)
  }
  if (status.color !== seenColor) {
    setSeenColor(status.color)
    setColor(status.color)
    setColorProblem(null)
  }

  // The latest of what the row is given, for the things that finish after it has been drawn again.
  const latest = useRef({ status, onSave, onFocused })
  useEffect(() => {
    latest.current = { status, onSave, onFocused }
  })

  useLayoutEffect(() => {
    if (focusRequest === null) return
    if (focusRequest === 'name') {
      nameInput.current?.focus()
      nameInput.current?.select()
    } else {
      // The button that was used, or the other one when the status has reached the end of the list.
      const used = focusRequest === 'up' ? up.current : down.current
      const other = focusRequest === 'up' ? down.current : up.current
      ;(used ?? other)?.focus()
    }
    latest.current.onFocused()
  }, [focusRequest])

  async function commitName() {
    const trimmed = name.trim()
    if (trimmed === status.name_he) {
      setName(status.name_he)
      setNameProblem(null)
      return
    }
    const problem = checkStatusName(name, others)
    setNameProblem(problem)
    if (problem) return
    setName(trimmed)
    const result = await onSave({ name_he: trimmed })
    if (result === 'failed') setName(latest.current.status.name_he)
  }

  async function commitColor(value: string) {
    const problem = checkColor(value)
    setColorProblem(problem)
    if (problem) return
    const next = normalizeColor(value)
    if (next === normalizeColor(status.color)) {
      setColor(status.color)
      return
    }
    setColor(next)
    const result = await onSave({ color: next })
    if (result === 'failed') setColor(latest.current.status.color)
  }

  // The colour input says that the choice is made with a `change` event, when its window closes. React's
  // onChange is the `input` event, which comes all the time while the person drags in the window.
  const commitPicked = useRef((value: string) => void commitColor(value))
  useEffect(() => {
    commitPicked.current = (value) => void commitColor(value)
  })
  useEffect(() => {
    const input = colorInput.current
    if (!input) return
    const onPicked = () => commitPicked.current(input.value)
    input.addEventListener('change', onPicked)
    return () => input.removeEventListener('change', onPicked)
  }, [])

  const shown = shownColor(color, status.color)
  const note = status.is_active ? null : openTasksNote(openTasks)

  return (
    <li className={status.is_active ? 'status-row' : 'status-row status-off'}>
      <span className="swatch" style={{ backgroundColor: shown }} aria-hidden="true" />

      <div className="status-name">
        <input
          ref={nameInput}
          type="text"
          autoComplete="off"
          aria-label="שם הסטטוס"
          value={name}
          readOnly={busy}
          onChange={(event) => {
            setName(event.target.value)
            setNameProblem(null)
          }}
          onKeyDown={(event) =>
            onKeys(
              event,
              () => void commitName(),
              () => {
                setName(status.name_he)
                setNameProblem(null)
              },
            )
          }
          onBlur={() => void commitName()}
          aria-invalid={nameProblem ? true : undefined}
          aria-describedby={nameProblem ? nameProblemId : undefined}
        />
        {nameProblem && (
          <p id={nameProblemId} className="field-error">
            {nameProblem}
          </p>
        )}
      </div>

      <div className="status-color">
        <input
          ref={colorInput}
          type="color"
          aria-label="צבע"
          value={shown}
          disabled={busy}
          onChange={(event) => {
            setColor(event.target.value)
            setColorProblem(null)
          }}
        />
        <input
          type="text"
          dir="ltr"
          className="num status-hex"
          autoComplete="off"
          spellCheck={false}
          aria-label="קוד הצבע"
          value={color}
          readOnly={busy}
          onChange={(event) => {
            setColor(event.target.value)
            setColorProblem(null)
          }}
          onKeyDown={(event) =>
            onKeys(
              event,
              () => void commitColor(color),
              () => {
                setColor(status.color)
                setColorProblem(null)
              },
            )
          }
          onBlur={() => void commitColor(color)}
          aria-invalid={colorProblem ? true : undefined}
          aria-describedby={colorProblem ? colorProblemId : undefined}
        />
        {colorProblem && (
          <p id={colorProblemId} className="field-error">
            {colorProblem}
          </p>
        )}
      </div>

      <label className="status-active">
        <input type="checkbox" checked={status.is_active} disabled={busy} onChange={() => void onSave({ is_active: !status.is_active })} />
        <span>פעיל</span>
      </label>

      <div className="status-moves">
        {index > 0 && (
          <button type="button" ref={up} className="btn" aria-label={`הזזה למעלה: ${status.name_he}`} disabled={busy} onClick={() => onMove('up')}>
            <span aria-hidden="true">↑</span>
          </button>
        )}
        {index < count - 1 && (
          <button type="button" ref={down} className="btn" aria-label={`הזזה למטה: ${status.name_he}`} disabled={busy} onClick={() => onMove('down')}>
            <span aria-hidden="true">↓</span>
          </button>
        )}
      </div>

      {note && <p className="sub status-note">{note}</p>}
    </li>
  )
}
