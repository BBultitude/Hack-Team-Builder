import { useEffect, useRef } from 'preact/hooks'
import type { GameData, RosterEntry } from '../types'
import type { Lookup } from '../logic/lookup'
import { MAX_TEAM } from '../logic/team'
import { PokemonEditor } from './PokemonEditor'
import { removeFromRoster, toggleInTeam } from './PokedexTab'

interface Props {
  data: GameData
  lookup: Lookup
  roster: RosterEntry[]
  team: number[]
  /** Roster index shown, or null when closed. */
  index: number | null
  onClose: () => void
  onRoster: (roster: RosterEntry[]) => void
  onTeam: (team: number[]) => void
}

/**
 * One owned Pokémon's details over whatever tab is open. A native dialog:
 * Escape and the backdrop close it, focus stays inside, and screen readers
 * announce it as a dialog.
 */
export function PokemonModal(props: Props) {
  const { data, lookup, roster, team, index } = props
  const ref = useRef<HTMLDialogElement>(null)
  const entry = index === null ? undefined : roster[index]

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (entry && !dialog.open) dialog.showModal()
    if (!entry && dialog.open) dialog.close()
  }, [entry !== undefined])

  return (
    <dialog
      ref={ref}
      class="pokemon-modal"
      aria-labelledby="pokemon-modal-title"
      onClose={props.onClose}
      // A click on the dialog itself, not its content, is a click on the backdrop.
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close()
      }}
    >
      {entry && index !== null && (
        <div class="pokemon-modal-body">
          <div class="row" style="justify-content:flex-end">
            <button class="link" onClick={() => ref.current?.close()}>
              Close
            </button>
          </div>
          <PokemonEditor
            key={index}
            data={data}
            lookup={lookup}
            entry={entry}
            onChange={(next) => props.onRoster(roster.map((e, j) => (j === index ? next : e)))}
            onRemove={() => {
              const next = removeFromRoster(roster, team, index)
              props.onRoster(next.roster)
              props.onTeam(next.team)
              ref.current?.close()
            }}
            inTeam={team.includes(index)}
            onToggleTeam={() => props.onTeam(toggleInTeam(team, index))}
            teamFull={team.length >= MAX_TEAM}
          />
        </div>
      )}
    </dialog>
  )
}
