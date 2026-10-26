import type { GameData, RosterEntry } from '../types'
import type { Lookup } from '../logic/lookup'
import { entryFromDex } from '../logic/member'
import { MAX_TEAM } from '../logic/team'
import { PokemonEditor } from './PokemonEditor'
import { Suggest } from './Suggest'

interface Props {
  data: GameData
  lookup: Lookup
  roster: RosterEntry[]
  team: number[]
  openIndex: number | null
  onOpenIndex: (i: number | null) => void
  onRoster: (roster: RosterEntry[]) => void
  onTeam: (team: number[]) => void
}

/** Adds a Pokemon by name to the roster, and to the team while there is room. */
export function addToRoster(
  data: GameData,
  lookup: Lookup,
  roster: RosterEntry[],
  team: number[],
  name: string,
): { roster: RosterEntry[]; team: number[] } | null {
  const trimmed = name.trim()
  if (!trimmed) return null
  const next = [...roster, entryFromDex(data, trimmed, lookup.dexByName.get(trimmed.toLowerCase()))]
  return { roster: next, team: team.length < MAX_TEAM ? [...team, next.length - 1] : team }
}

export function PokedexTab(props: Props) {
  const { data, lookup, roster, team } = props

  const add = (name: string): void => {
    const next = addToRoster(data, lookup, roster, team, name)
    if (!next) return
    props.onRoster(next.roster)
    props.onTeam(next.team)
    props.onOpenIndex(next.roster.length - 1)
  }

  const removeAt = (i: number): void => {
    props.onRoster(roster.filter((_, j) => j !== i))
    // Indices after the removed one shift down by one.
    props.onTeam(team.filter((t) => t !== i).map((t) => (t > i ? t - 1 : t)))
    props.onOpenIndex(null)
  }

  const toggleTeam = (i: number): void => {
    if (team.includes(i)) props.onTeam(team.filter((t) => t !== i))
    else if (team.length < MAX_TEAM) props.onTeam([...team, i])
  }

  return (
    <div>
      <div class="card">
        <h2>Add a Pokémon</h2>
        <Suggest
          value=""
          placeholder="Search by name, or type a custom one"
          options={data.dex.map((d) => d.n)}
          onPick={add}
          clearOnPick
        />
        <p class="muted" style="margin:0.5rem 0 0">
          Not in the list? Type the name and press Enter to add it as a custom Pokémon.
        </p>
      </div>

      <h2 style="margin:1rem 0 0.5rem">
        Your Pokémon ({roster.length}) · team {team.length}/{MAX_TEAM}
      </h2>
      {roster.length === 0 ? (
        <p class="empty">Nothing added yet.</p>
      ) : (
        roster.map((entry, i) => (
          <PokemonEditor
            key={`${entry.n}-${i}`}
            data={data}
            entry={entry}
            open={props.openIndex === i}
            onToggle={() => props.onOpenIndex(props.openIndex === i ? null : i)}
            onChange={(next) => props.onRoster(roster.map((e, j) => (j === i ? next : e)))}
            onRemove={() => removeAt(i)}
            inTeam={team.includes(i)}
            onToggleTeam={() => toggleTeam(i)}
            teamFull={team.length >= MAX_TEAM}
          />
        ))
      )}
    </div>
  )
}
