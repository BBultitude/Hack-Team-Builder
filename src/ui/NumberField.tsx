import { useEffect, useState } from 'preact/hooks'

interface Props {
  /** Committed value; undefined shows an empty box (only when `optional`). */
  value: number | undefined
  min: number
  max: number
  onChange: (value: number | undefined) => void
  /** An empty box means "unset" rather than "keep the last number". */
  optional?: boolean
  placeholder?: string
}

/**
 * A whole-number box that keeps what is typed. A controlled number input that
 * skips or clamps keystrokes shows one thing while state holds another, and
 * the next re-render (a sync status change a second later) writes the old
 * value back mid-edit. Here the draft is the box's own; only valid numbers
 * are committed, and the box tidies up when it loses focus.
 */
export function NumberField(props: Props) {
  const shown = props.value === undefined ? '' : String(props.value)
  const [draft, setDraft] = useState(shown)
  const parse = (s: string): number | null => (/^\d+$/.test(s) ? Number(s) : null)

  // Follow outside changes (another game loaded, a trainer pick), not our own commits.
  useEffect(() => {
    const n = parse(draft)
    if (draft === '' ? props.value !== undefined || !props.optional : n !== props.value) setDraft(shown)
  }, [props.value])

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autocomplete="off"
      placeholder={props.placeholder}
      value={draft}
      onInput={(e) => {
        const v = e.currentTarget.value
        setDraft(v)
        if (v === '' && props.optional) return props.onChange(undefined)
        const n = parse(v)
        if (n !== null && n >= props.min && n <= props.max) props.onChange(n)
      }}
      onBlur={() => {
        if (draft === '' && props.optional) return
        const n = parse(draft)
        if (n === null) return setDraft(shown)
        const clamped = Math.min(Math.max(n, props.min), props.max)
        setDraft(String(clamped))
        if (clamped !== props.value) props.onChange(clamped)
      }}
    />
  )
}
