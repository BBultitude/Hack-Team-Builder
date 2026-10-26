import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'

const MAX_SUGGESTIONS = 6

/** Breathing room left below the list when the page has to scroll. */
const SCROLL_MARGIN = 8

interface Props {
  value: string
  placeholder?: string
  /** Full candidate list; filtering happens here. */
  options: readonly string[]
  onPick: (value: string) => void
  onInput?: (value: string) => void
  /** Empties the field after a pick, for "add another" style inputs. */
  clearOnPick?: boolean
  id?: string
}

/** Prefix matches first, then anything containing the query. */
export function filterOptions(options: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const prefix: string[] = []
  const contains: string[] = []
  for (const o of options) {
    const lower = o.toLowerCase()
    if (lower.startsWith(q)) {
      prefix.push(o)
      if (prefix.length >= MAX_SUGGESTIONS) break
    } else if (lower.includes(q)) {
      contains.push(o)
    }
  }
  return [...prefix, ...contains].slice(0, MAX_SUGGESTIONS)
}

/**
 * Pixels the page must scroll so `contentBottom` sits inside `visibleBottom`.
 * Zero when it already fits — the page should never move unnecessarily.
 */
export function scrollCorrection(
  contentBottom: number,
  visibleBottom: number,
  margin = SCROLL_MARGIN,
): number {
  const overflow = contentBottom + margin - visibleBottom
  return overflow > 0 ? overflow : 0
}

/**
 * Bottom of the area the user can actually see. On a phone the on-screen
 * keyboard shrinks visualViewport but leaves innerHeight untouched, so the
 * visual viewport is the only honest answer.
 */
function visibleBottom(): number {
  const vv = window.visualViewport
  return vv ? vv.offsetTop + vv.height : window.innerHeight
}

/**
 * A custom suggestion list rather than a native datalist, which on mobile
 * renders above the on-screen keyboard and covers the input.
 */
export function Suggest({ value, placeholder, options, onPick, onInput, clearOnPick, id }: Props) {
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  /**
   * Blur closes the list on a timer so a pointerdown on a suggestion lands
   * first. Any newer intent — refocusing, or typing again — has to cancel
   * that timer, or it fires afterwards and closes a list the user just
   * reopened.
   */
  const cancelPendingClose = (): void => {
    if (blurTimer.current !== undefined) {
      clearTimeout(blurTimer.current)
      blurTimer.current = undefined
    }
  }

  useEffect(() => cancelPendingClose, [])

  const matches = open ? filterOptions(options, query) : []
  const listShown = matches.length > 0

  const choose = (name: string): void => {
    cancelPendingClose()
    setQuery(clearOnPick ? '' : name)
    setOpen(false)
    inputRef.current?.blur()
    onPick(name)
  }

  /**
   * Scroll only when the open list genuinely does not fit, and only by the
   * shortfall. Focusing a field never moves the page on its own.
   */
  const ensureVisible = (): void => {
    const el = wrapRef.current
    if (!el) return
    const correction = scrollCorrection(el.getBoundingClientRect().bottom, visibleBottom())
    if (correction > 0) window.scrollBy({ top: correction })
  }

  useLayoutEffect(() => {
    if (listShown) ensureVisible()
  }, [listShown, matches.length])

  useEffect(() => {
    if (!listShown) return
    // The keyboard animates in after focus, shrinking the visual viewport.
    const vv = window.visualViewport
    vv?.addEventListener('resize', ensureVisible)
    return () => vv?.removeEventListener('resize', ensureVisible)
  }, [listShown])

  useEffect(() => {
    // Extra scroll room at the foot of the page, but only while it is needed.
    if (!listShown) return
    document.body.classList.add('suggest-open')
    return () => document.body.classList.remove('suggest-open')
  }, [listShown])

  return (
    <div class="suggest" ref={wrapRef}>
      <input
        id={id}
        ref={inputRef}
        type="text"
        value={query}
        placeholder={placeholder}
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        onFocus={() => {
          cancelPendingClose()
          setOpen(true)
        }}
        onBlur={() => {
          cancelPendingClose()
          blurTimer.current = setTimeout(() => setOpen(false), 0)
        }}
        onInput={(e) => {
          cancelPendingClose()
          const next = e.currentTarget.value
          setQuery(next)
          setOpen(true)
          onInput?.(next)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && matches[0]) {
            e.preventDefault()
            choose(matches[0])
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {listShown && (
        <div class="suggest-list">
          {matches.map((name) => (
            <button
              key={name}
              type="button"
              // pointerdown, not click: blur would close the list first.
              onPointerDown={(e) => {
                e.preventDefault()
                choose(name)
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
