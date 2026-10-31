import type { GameData, RosterEntry } from '../types'
import type { Lookup } from '../logic/lookup'
import { resolveMember } from '../logic/member'
import { MAX_TEAM } from '../logic/team'
import { rankMember, resolveOpponent } from '../logic/opponent'
import type { SavedOpponent } from '../logic/storage'
import { Sprite } from './Sprite'

interface Props {
  data: GameData
  lookup: Lookup
  roster: RosterEntry[]
  team: number[]
  /** Set on the Opponent tab: each slot then shows how hard the opponent hits it. */
  opponent: SavedOpponent | null
  /** Roster index currently out against the opponent. */
  out: number | null
  onPick: (rosterIndex: number) => void
  onEmpty: () => void
}

/** "45%" of Hit Points the opponent's hardest hit takes: bad when it can knock out, safe at a quarter or less. */
function mark(taken: number, ohko: boolean): { text: string; tone: string } {
  return { text: ohko ? 'KO' : `${Math.round(taken)}%`, tone: ohko ? 'bad' : taken <= 25 ? 'safe' : 'even' }
}

/** The team's six slots, always in view, like the party screen in the games. */
export function PartyBar(props: Props) {
  const { data, lookup, roster, team, opponent } = props
  const foe = resolveOpponent(data, lookup, opponent)

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
        const r = foe ? rankMember(data, resolveMember(data, lookup, entry), foe, slot) : null
        const m = r ? mark(r.takes?.max ?? 0, r.ohkoRisk) : null
        return (
          <button
            key={`${entry.n}-${index}`}
            class="party-slot"
            aria-pressed={opponent ? props.out === index : undefined}
            aria-label={
              opponent
                ? `${entry.n}${r?.ohkoRisk ? ', can be knocked out in one hit' : m ? `, takes up to ${m.text}` : ''}${props.out === index ? ', currently out' : ''}`
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
