import type { GameData } from '../types'

/** Type chips in their official colours (styled by data-t in styles.css). */
export function Types({ data, types, weak = false }: { data: GameData; types: readonly number[]; weak?: boolean }) {
  return (
    <span class="types">
      {types.map((t) => {
        const name = data.chart.types[t] ?? '?'
        return (
          <span key={t} class={weak ? 'type weak' : 'type'} data-t={name}>
            {name}
          </span>
        )
      })}
    </span>
  )
}
