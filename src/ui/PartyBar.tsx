import type { GameData, RosterEntry } from '../types'
import type { Lookup } from '../logic/lookup'
import { resolveMember } from '../logic/member'
import { MAX_TEAM } from '../logic/team'
import { rankMember } from '../logic/opponent'
import { Sprite } from './Sprite'

interface Props {
  data: GameData
  lookup: Lookup
  roster: RosterEntry[]
  team: number[]
  /** Set on the Opponent tab: each slot then shows how hard the opponent hits it. */
  opponent: { name: string; ability: string } | null
  /** Roster index currently out against the opponent. */
  out: number | null
  onPick: (rosterIndex: number) => void
  onEmpty: () => void
}

/** "x2" for the damage taken, with a tone: bad at x2 or more, safe at x0.5 or less. */
function mark(taken: number): { text: string; tone: string } {
  const text = taken === 0.5 ? '½' : taken === 0.25 ? '¼' : String(taken)
  return { text: `×${text}`, tone: taken >= 2 ? 'bad' : taken <= 0.5 ? 'safe' : 'even' }
}

/** The team's six slots, always in view, like the party screen in the games. */
export function PartyBar(props: Props) {
  const { data, lookup, roster, team, opponent } = props
  const opponentIndex = opponent ? lookup.dexByName.get(opponent.name.toLowerCase()) : undefined
  const foe = opponentIndex === undefined ? undefined : data.dex[opponentIndex]

  return (
    <nav class="party" aria-label={opponent ? 'Your party: choose who is out' : 'Your party'}>
      {Array.from({ length: MAX_TEAM }, (_, slot) => {
        const index = team[slot]
        const entry = index === undefined ? undefined : roster[index]
        if (index === undefined || !entry) {
          return (
            <button key={`empty-${slot}`} class="party-slot empty" onClick={props.onEmpty} aria-label="Empty slot: add a Pokémon">
              +
            </button>
          )
        }
        const taken = foe
          ? (rankMember(data, resolveMember(data, lookup, entry), {
              name: foe.n,
              types: foe.t,
              stats: foe.s,
              ability: opponent?.ability ?? '',
            }, slot).worstIncoming?.multiplier ?? 1)
          : null
        // Only marks that matter: a hard hit or a resisted one. Neutral is the default.
        const m = taken === null || taken === 1 ? null : mark(taken)
        return (
          <button
            key={`${entry.n}-${index}`}
            class="party-slot"
            aria-pressed={opponent ? props.out === index : undefined}
            aria-label={
              opponent
                ? `${entry.n}${m ? `, takes ${m.text}` : ''}${props.out === index ? ', currently out' : ''}`
                : `${entry.n}: open in Pokédex`
            }
            title={entry.n}
            onClick={() => props.onPick(index)}
          >
            {data.dex[entry.d] ? (
              <Sprite gen={data.gen} id={data.dex[entry.d]!.id} size={48} />
            ) : (
              <span aria-hidden="true">{entry.n.slice(0, 3)}</span>
            )}
            {m && <span class={`party-mark ${m.tone}`} aria-hidden="true">{m.text}</span>}
          </button>
        )
      })}
    </nav>
  )
}
