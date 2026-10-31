import { useMemo, useState } from 'preact/hooks'
import type { GameData, RosterEntry } from '../types'
import type { Lookup } from '../logic/lookup'
import { type Member, resolveMember } from '../logic/member'
import type { RankScope } from '../logic/storage'
import {
  type Opponent,
  type Ranking,
  describeIncoming,
  describeOffence,
  describeSpeed,
  learningTip,
  rankMembers,
} from '../logic/opponent'
import { Suggest } from './Suggest'
import { dexNames } from '../logic/setup'
import { Sprite } from './Sprite'
import { Types } from './Types'

interface Props {
  data: GameData
  lookup: Lookup
  roster: RosterEntry[]
  team: number[]
  opponent: { name: string; ability: string } | null
  scope: RankScope
  /** Roster index of the Pokemon currently out; also set from the party bar. */
  out: number | null
  onOut: (rosterIndex: number | null) => void
  onOpponent: (o: { name: string; ability: string } | null) => void
  onScope: (s: RankScope) => void
}

export function OpponentTab(props: Props) {
  const { data, lookup, roster, team, opponent, scope } = props
  const [abilityDraft, setAbilityDraft] = useState(opponent?.ability ?? '')
  const outIndex = props.out

  const opponentIndex = opponent ? lookup.dexByName.get(opponent.name.toLowerCase()) : undefined
  const opponentEntry = opponentIndex === undefined ? undefined : data.dex[opponentIndex]

  const resolved: Opponent | null = opponentEntry
    ? {
        name: opponentEntry.n,
        types: opponentEntry.t,
        stats: opponentEntry.s,
        ability: opponent?.ability ?? '',
      }
    : null

  const indices = scope === 'team' ? team : roster.map((_, i) => i)

  const members = useMemo(
    () =>
      indices
        .map((i) => roster[i])
        .filter((e): e is RosterEntry => e !== undefined)
        .map((e) => resolveMember(data, lookup, e)),
    [data, lookup, roster, indices.join(',')],
  )

  const ranked = useMemo(
    () => (resolved ? rankMembers(data, members, resolved) : []),
    [data, members, resolved?.name, resolved?.ability],
  )

  const best = ranked[0]
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : undefined
  const outRank = outIndex === null ? -1 : ranked.findIndex((r) => indices[r.slot] === outIndex)
  const out = ranked[outRank]

  const typeName = (i: number): string => data.chart.types[i] ?? '?'
  const spriteOf = (slot: number): number | undefined => data.dex[members[slot]?.entry.d ?? -1]?.id

  return (
    <div>
      <div class="card stack">
        <h2 style="margin:0">Opponent</h2>
        <Suggest
          value={opponent?.name ?? ''}
          placeholder="Search the dex"
          options={dexNames(data)}
          onPick={(name) => {
            setAbilityDraft('')
            props.onOpponent({ name, ability: '' })
          }}
        />

        {opponentEntry && (
          <>
            <div class="row" style="gap:0.75rem">
              <Sprite gen={data.gen} id={opponentEntry.id} size={96} />
              <div class="stack">
                <div>
                  <Types data={data} types={opponentEntry.t} />
                </div>
                <div class="muted">
                  Base Speed <span class="lcd">{opponentEntry.s[5]}</span>
                </div>
              </div>
            </div>
            <label class="field">
              <span>Ability (optional)</span>
              <Suggest
                value={abilityDraft}
                placeholder="Leave blank if unknown"
                options={[...opponentEntry.ab, ...opponentEntry.hab]}
                onInput={(v) => {
                  setAbilityDraft(v)
                  props.onOpponent({ name: opponentEntry.n, ability: v })
                }}
                onPick={(v) => {
                  setAbilityDraft(v)
                  props.onOpponent({ name: opponentEntry.n, ability: v })
                }}
              />
            </label>
          </>
        )}

        <div class="row">
          <span class="muted grow">Rank</span>
          <button
            aria-pressed={scope === 'team'}
            class={scope === 'team' ? 'primary' : ''}
            onClick={() => props.onScope('team')}
          >
            My team
          </button>
          <button
            aria-pressed={scope === 'all'}
            class={scope === 'all' ? 'primary' : ''}
            onClick={() => props.onScope('all')}
          >
            Everything I own
          </button>
        </div>

        {members.length > 0 && (
          <label class="field">
            <span>Currently out</span>
            <select
              value={outIndex ?? ''}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value
                props.onOut(v === '' ? null : Number(v))
              }}
            >
              <option value="">None</option>
              {members.map((m, slot) => (
                <option key={indices[slot]} value={indices[slot]}>
                  {m.entry.n}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {!resolved ? (
        <p class="empty">Pick an opponent to see who handles it best.</p>
      ) : members.length === 0 ? (
        <p class="empty">
          {scope === 'team'
            ? 'No team selected yet. Build one on the Team tab, or rank everything you own.'
            : 'You have not added any Pokémon yet.'}
        </p>
      ) : (
        <>
          {out && best && (
            <div class="card stack">
              <h2 class="row" style="margin:0">
                <Sprite gen={data.gen} id={spriteOf(out.slot)} />
                <span class="grow">Out: {out.name}</span>
                <span class="muted">
                  rank {outRank + 1} of {ranked.length}
                </span>
              </h2>
              <p style="margin:0">
                <strong>{verdict(out, best, resolved.name)}</strong>
              </p>
              {out.best && out.best.value > 0 && usingMoves(members[out.slot]!, out.best.attackType)}
              {out.worstIncoming && out.worstIncoming.multiplier >= 2 && (
                <p class="danger" style="margin:0">
                  Watch out for {typeName(out.worstIncoming.attackType)} attacks: they hit you hard, so
                  don't stay in long.
                </p>
              )}
              <MatchupDetails data={data} r={out} member={members[out.slot]!} opponent={resolved} />
            </div>
          )}

          {best && (
            <div class="card stack">
              <h2 class="row" style="margin:0">
                <Sprite gen={data.gen} id={spriteOf(best.slot)} />
                Best: {best.name}
              </h2>
              <MatchupDetails data={data} r={best} member={members[best.slot]!} opponent={resolved} />
            </div>
          )}

          {worst && (
            <div class="card stack">
              <h2 class="row" style="margin:0">
                <Sprite gen={data.gen} id={spriteOf(worst.slot)} />
                Worst: {worst.name}
              </h2>
              <MatchupDetails data={data} r={worst} member={members[worst.slot]!} opponent={resolved} />
            </div>
          )}

          <div class="card">
            <h2>Full order</h2>
            <div class="stack">
              {ranked.map((r, i) => (
                <div key={r.slot} class="member-line">
                  <span class="rank-badge">{i + 1}.</span>
                  <Sprite gen={data.gen} id={spriteOf(r.slot)} size={32} />
                  <span class="grow truncate">
                    {r.name}
                    {r === out && <span class="muted"> (out)</span>}
                  </span>
                  <Readout r={r} />
                </div>
              ))}
            </div>
            <p class="muted" style="margin:0.6rem 0 0">
              Sorted by least damage taken, then most damage dealt. Assumes {resolved.name} attacks
              only with moves of its own types.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function verdict(out: Ranking, best: Ranking, opponentName: string): string {
  if (!out.best || out.best.value === 0) return `Nothing it knows hurts ${opponentName}. Switch out.`
  if (out === best) return 'Best pick here. Stay in.'
  const takes = (r: Ranking): number => r.worstIncoming?.multiplier ?? 1
  return takes(best) < takes(out) ? `Switch to ${best.name} if you can.` : 'Fine to stay in.'
}

/** "Aim with Earthquake, Bulldoze." for the known moves of its best attack type. */
function usingMoves(member: Member, attackType: number) {
  const names = member.moves.filter((m) => m.t === attackType).map((m) => m.n)
  if (!names.length) return null
  return (
    <p style="margin:0">
      Aim with <strong>{names.join(', ')}</strong>.
    </p>
  )
}

function MatchupDetails(props: { data: GameData; r: Ranking; member: Member; opponent: Opponent }) {
  const { data, r, member, opponent } = props
  const typeName = (i: number): string => data.chart.types[i] ?? '?'
  const tip = learningTip(data, member, opponent)
  return (
    <>
      <ul style="margin:0;padding-left:1.1rem">
        {r.best && <li>{describeOffence(data, r.best, opponent.name)}</li>}
        {r.worstIncoming && <li>{describeIncoming(data, r.worstIncoming, opponent.name)}</li>}
        <li>{describeSpeed(r, opponent.name)}</li>
      </ul>
      {r.neutral.length > 0 && (
        <p class="muted" style="margin:0">
          Neutral options: {r.neutral.map((o) => typeName(o.attackType)).join(', ')}.
        </p>
      )}
      {member.assumedFromTypes && (
        <p class="muted" style="margin:0">
          No moves entered for {r.name}, so its own types are assumed.
        </p>
      )}
      {tip && (
        <p style="margin:0">
          <strong>Tip:</strong> {r.name} could learn <strong>{tip.move.n}</strong> (
          {typeName(tip.move.t)}, power {tip.move.p}
          {tip.stab ? ', Same-Type Attack Bonus' : ''}) for a harder hit than anything it
          currently knows.
        </p>
      )}
    </>
  )
}

/** "takes ×2  deals ×3" in the Dex's digital face, red when it hurts and blue when it's safe. */
function Readout({ r }: { r: Ranking }) {
  const takes = r.worstIncoming?.multiplier ?? 1
  const deals = r.best?.value ?? 0
  return (
    <span class="readout" aria-label={`takes ${takes} times, deals ${deals} times`}>
      <span class={takes >= 2 ? 'bad' : takes <= 0.5 ? 'safe' : ''}>
        takes <span class="lcd">×{takes}</span>
      </span>
      <span class={deals === 0 ? 'bad' : ''}>
        deals <span class="lcd">×{deals}</span>
      </span>
    </span>
  )
}
