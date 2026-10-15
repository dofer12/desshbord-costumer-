import type { Status } from './gateways'

interface Props {
  statuses: Status[]
  /** How many tasks have each status, among the ones that the other filters let through. */
  counts: Record<string, number>
  total: number
  /** The status key that is chosen, or null for all. */
  selected: string | null
  onSelect(key: string | null): void
}

const NEUTRAL = '#8a9aa1'

const tasksWord = (n: number) => (n === 1 ? 'משימה אחת' : `${n} משימות`)

/** One chip for each status that has tasks (and the one that is chosen), with the number, and "all" first. */
export function StatusChips({ statuses, counts, total, selected, onSelect }: Props) {
  const known = new Set(statuses.map((s) => s.key))
  const shown: Array<{ key: string; name: string; color: string }> = [
    ...statuses.filter((s) => (counts[s.key] ?? 0) > 0 || s.key === selected).map((s) => ({ key: s.key, name: s.name_he, color: s.color })),
    // A task can carry a status that the directory does not have (yet); it is still a status to filter by.
    ...Object.keys(counts)
      .filter((key) => !known.has(key))
      .sort()
      .map((key) => ({ key, name: key, color: NEUTRAL })),
  ]
  if (selected !== null && !shown.some((chip) => chip.key === selected)) shown.push({ key: selected, name: selected, color: NEUTRAL })

  return (
    <div className="chips" role="group" aria-label="סינון לפי סטטוס">
      <button
        type="button"
        className="chip"
        aria-pressed={selected === null}
        aria-label={`הכול, ${tasksWord(total)}`}
        onClick={() => onSelect(null)}
      >
        הכול<span className="count">{total}</span>
      </button>
      {shown.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className="chip"
          aria-pressed={selected === chip.key}
          aria-label={`${chip.name}, ${tasksWord(counts[chip.key] ?? 0)}`}
          onClick={() => onSelect(selected === chip.key ? null : chip.key)}
        >
          <span className="dot" style={{ background: chip.color }} aria-hidden="true" />
          {chip.name}
          <span className="count">{counts[chip.key] ?? 0}</span>
        </button>
      ))}
    </div>
  )
}
