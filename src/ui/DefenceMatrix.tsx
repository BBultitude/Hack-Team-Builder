import { useState } from 'preact/hooks'
import type { GameData } from '../types'
import type { Member } from '../logic/member'
import type { TypeExposure } from '../logic/team'
import { describeMultiplier } from '../logic/typeChart'

interface Props {
  data: GameData
  members: readonly Member[]
  grid: readonly TypeExposure[]
}

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

export function DefenceMatrix({ data, members, grid }: Props) {
  const [readout, setReadout] = useState<string | null>(null)

  const typeName = (i: number): string => data.chart.types[i] ?? '?'

  const explain = (memberIndex: number, type: number, m: number): string =>
    `${members[memberIndex]?.entry.n ?? ''} takes ${describeMultiplier(m)} from ${typeName(type)}`

  return (
    <div class="card">
      <h2>Defensive cover</h2>

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
              <span class="visually-hidden">Attacking type</span>
            </th>
            {members.map((m, i) => (
              <th key={m.entry.n} scope="col" title={m.entry.n}>
                {i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row) => (
            <tr key={row.type}>
              <th scope="row">{typeName(row.type)}</th>
              {row.cells.map((m, i) => {
                const text = explain(i, row.type, m)
                return (
                  <td
                    key={i}
                    class={cellClass(m)}
                    title={text}
                    onPointerEnter={() => setReadout(text)}
                    onPointerLeave={() => setReadout(null)}
                    onClick={() => setReadout(text)}
                  >
                    {cellGlyph(m)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <p class="muted matrix-readout" aria-live="polite">
        {readout ?? 'Tap a square for the detail. Blank means normal damage.'}
      </p>

      <ul class="matrix-legend">
        <li><i class="lg-x4" /> quadruple</li>
        <li><i class="lg-x2" /> double</li>
        <li><i class="neutral" /> normal</li>
        <li><i class="lg-half" /> half</li>
        <li><i class="lg-qtr" /> quarter</li>
        <li><i class="lg-zero" /> immune</li>
      </ul>
    </div>
  )
}
