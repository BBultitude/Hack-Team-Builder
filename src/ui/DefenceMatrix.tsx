import { useState } from 'preact/hooks'
import type { GameData } from '../types'
import type { Member } from '../logic/member'
import type { TypeExposure } from '../logic/team'
import { describeMultiplier } from '../logic/typeChart'

interface Props {
  data: GameData
  members: readonly Member[]
  grid: readonly TypeExposure[]
  /** Opens a member's details; the index is into `members`. */
  onOpen?: (memberIndex: number) => void
}

type View = 'takes' | 'hits'

/**
 * Which band of the diverging ramp a multiplier falls in. Abilities can
 * produce values off the usual 0/.25/.5/1/2/4 ladder — Filter turns a 2x
 * into 1.5x, Thick Fat turns a 4x into 2x — so these are ranges, not
 * equality checks.
 */
function cellClass(m: number): string {
  if (m === 0) return 'zero'
  if (m >= 3) return 'x4'
  if (m > 1) return 'x2'
  if (m === 1) return ''
  if (m <= 0.25) return 'qtr'
  return 'half'
}

/**
 * The same ramp read the other way for attacks: blue stays "good for you"
 * (a double-damage hit), red "bad for you" (a resisted or blanked one).
 */
function hitClass(m: number): string {
  if (m >= 2) return 'qtr'
  if (m > 1) return 'half'
  if (m === 1) return ''
  if (m === 0) return 'x4'
  return 'x2'
}

const FRACTIONS: Record<string, string> = {
  '0.25': '¼',
  '0.5': '½',
  '0.75': '¾',
  '1.5': '1½',
}

/** Compact label for a cell. Neutral cells show nothing at all. */
export function cellGlyph(m: number): string {
  if (m === 1) return ''
  return FRACTIONS[String(m)] ?? String(m)
}

/** Each member's matchup against every type: what hurts it (Takes) or what it hurts (Hits), one grid either way. */
export function DefenceMatrix({ data, members, grid, onOpen }: Props) {
  const [view, setView] = useState<View>('takes')
  const [readout, setReadout] = useState<string | null>(null)

  const typeName = (i: number): string => data.chart.types[i] ?? '?'
  const name = (i: number): string => members[i]?.entry.n ?? ''

  const explain = (memberIndex: number, type: number, m: number): string =>
    view === 'takes'
      ? `${name(memberIndex)} takes ${describeMultiplier(m)} from ${typeName(type)}`
      : `${name(memberIndex)} hits ${typeName(type)} for ${describeMultiplier(m)}`

  const teamCell = (row: TypeExposure) => {
    if (view === 'takes') {
      const text = `Team vs ${typeName(row.type)}: ${row.weak} weak, ${row.resist} resist`
      return { text, glyph: `${row.weak}/${row.resist}`, cls: row.weak > row.resist ? 'bad' : row.resist > 0 ? 'safe' : '' }
    }
    const best = Math.max(0, ...row.hits)
    const text = best > 1
      ? `Team's best into ${typeName(row.type)}: ${describeMultiplier(best)}`
      : `Nobody hits ${typeName(row.type)} super-effectively`
    return { text, glyph: best > 1 ? `×${cellGlyph(best)}` : 'none', cls: best > 1 ? 'safe' : 'bad' }
  }

  return (
    <div class="card">
      <div class="row" style="margin-bottom:0.5rem">
        <h2 class="grow" style="margin:0">Type matchups</h2>
        <div class="row" role="group" aria-label="Show">
          {(['takes', 'hits'] as const).map((v) => (
            <button
              key={v}
              aria-pressed={view === v}
              class={view === v ? 'primary' : ''}
              onClick={() => {
                setView(v)
                setReadout(null)
              }}
            >
              {v === 'takes' ? 'Takes' : 'Hits'}
            </button>
          ))}
        </div>
      </div>

      <ol class="matrix-key">
        {members.map((m, i) => (
          <li key={m.entry.n}>
            <span class="badge">{i + 1}</span>
            <span>{m.entry.n}</span>
          </li>
        ))}
      </ol>

      <table class="matrix">
        <thead>
          <tr>
            <th class="corner">
              <span class="visually-hidden">{view === 'takes' ? 'Attacking type' : 'Defending type'}</span>
            </th>
            {members.map((m, i) => (
              <th key={m.entry.n} scope="col" title={m.entry.n}>
                {onOpen ? (
                  <button class="matrix-member" aria-label={`Open ${m.entry.n}`} onClick={() => onOpen(i)}>
                    {i + 1}
                  </button>
                ) : (
                  i + 1
                )}
              </th>
            ))}
            <th scope="col" class="team-col">Team</th>
          </tr>
        </thead>
        <tbody>
          {grid.map((row) => {
            const team = teamCell(row)
            return (
              <tr key={row.type}>
                <th scope="row">
                  <span class="type" data-t={typeName(row.type)}>{typeName(row.type)}</span>
                </th>
                {(view === 'takes' ? row.cells : row.hits).map((m, i) => {
                  const text = explain(i, row.type, m)
                  return (
                    <td
                      key={i}
                      class={view === 'takes' ? cellClass(m) : hitClass(m)}
                      title={text}
                      onPointerEnter={() => setReadout(text)}
                      onPointerLeave={() => setReadout(null)}
                      onClick={() => setReadout(text)}
                    >
                      {cellGlyph(m)}
                    </td>
                  )
                })}
                <td class={`team-col ${team.cls}`} title={team.text} onClick={() => setReadout(team.text)}>
                  {team.glyph}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <p class="muted matrix-readout" aria-live="polite">
        {readout ??
          (view === 'takes'
            ? 'What each attacking type does to each member. Team: weak / resist counts. Tap a square for the detail.'
            : "What each member's moves do to a Pokémon of that type. Team: the best anyone has. Tap a square for the detail.")}
      </p>

      {view === 'takes' ? (
        <ul class="matrix-legend">
          <li><i class="lg-x4" /> quadruple</li>
          <li><i class="lg-x2" /> double</li>
          <li><i class="neutral" /> normal</li>
          <li><i class="lg-half" /> half</li>
          <li><i class="lg-qtr" /> quarter</li>
          <li><i class="lg-zero" /> immune</li>
        </ul>
      ) : (
        <ul class="matrix-legend">
          <li><i class="lg-qtr" /> double</li>
          <li><i class="neutral" /> normal</li>
          <li><i class="lg-x2" /> half</li>
          <li><i class="lg-x4" /> no effect</li>
        </ul>
      )}
    </div>
  )
}
