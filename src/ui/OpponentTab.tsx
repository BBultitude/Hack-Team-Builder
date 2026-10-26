import { useMemo, useState } from 'preact/hooks'
import type { GameData, RosterEntry } from '../types'
import type { Lookup } from '../logic/lookup'
import { resolveMember } from '../logic/member'
import type { RankScope } from '../logic/storage'
import {
  type Opponent,
  describeIncoming,
  describeOffence,
  describeSpeed,
  learningTip,
  rankMembers,
} from '../logic/opponent'
import { Suggest } from './Suggest'

interface Props {
  data: GameData
  lookup: Lookup
  roster: RosterEntry[]
  team: number[]
  opponent: { name: string; ability: string } | null
  scope: RankScope
  onOpponent: (o: { name: string; ability: string } | null) => void
  onScope: (s: RankScope) => void
}

export function OpponentTab(props: Props) {
  const { data, lookup, roster, team, opponent, scope } = props
  const [abilityDraft, setAbilityDraft] = useState(opponent?.ability ?? '')

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
  const bestMember = best ? members[best.slot] : undefined
  const tip = bestMember && resolved ? learningTip(data, bestMember, resolved) : null

  const typeName = (i: number): string => data.chart.types[i] ?? '?'

  return (
    <div>
      <div class="card stack">
        <h2 style="margin:0">Opponent</h2>
        <Suggest
          value={opponent?.name ?? ''}
          placeholder="Search the dex"
          options={data.dex.map((d) => d.n)}
          onPick={(name) => {
            setAbilityDraft('')
            props.onOpponent({ name, ability: '' })
          }}
        />

        {opponentEntry && (
          <>
            <p class="row wrap" style="margin:0;gap:0.3rem">
              {opponentEntry.t.map((t) => (
                <span key={t} class="type">{typeName(t)}</span>
              ))}
              <span class="muted">Base Speed {opponentEntry.s[5]}</span>
            </p>
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
          {best && (
            <div class="card stack">
              <h2 style="margin:0">Best: {best.name}</h2>
              <ul style="margin:0;padding-left:1.1rem">
                {best.best && <li>{describeOffence(data, best.best, resolved.name)}</li>}
                {best.worstIncoming && (
                  <li>{describeIncoming(data, best.worstIncoming, resolved.name)}</li>
                )}
                <li>{describeSpeed(best, resolved.name)}</li>
              </ul>
              {best.neutral.length > 0 && (
                <p class="muted" style="margin:0">
                  Neutral options:{' '}
                  {best.neutral.map((o) => typeName(o.attackType)).join(', ')}.
                </p>
              )}
              {bestMember?.assumedFromTypes && (
                <p class="muted" style="margin:0">
                  No moves entered for {best.name}, so its own types are assumed.
                </p>
              )}
              {tip && (
                <p style="margin:0">
                  <strong>Tip:</strong> {best.name} could learn <strong>{tip.move.n}</strong> (
                  {typeName(tip.move.t)}, power {tip.move.p}
                  {tip.stab ? ', Same-Type Attack Bonus' : ''}) for a harder hit than anything it
                  currently knows.
                </p>
              )}
            </div>
          )}

          {worst && (
            <div class="card stack">
              <h2 style="margin:0">Worst: {worst.name}</h2>
              <ul style="margin:0;padding-left:1.1rem">
                {worst.best && <li>{describeOffence(data, worst.best, resolved.name)}</li>}
                {worst.worstIncoming && (
                  <li>{describeIncoming(data, worst.worstIncoming, resolved.name)}</li>
                )}
                <li>{describeSpeed(worst, resolved.name)}</li>
              </ul>
            </div>
          )}

          <div class="card">
            <h2>Full order</h2>
            <div class="stack">
              {ranked.map((r, i) => (
                <div key={r.slot} class="member-line">
                  <span class="rank-badge">{i + 1}.</span>
                  <span class="grow truncate">{r.name}</span>
                  <span class="muted">{r.score.toFixed(1)}</span>
                </div>
              ))}
            </div>
            <p class="muted" style="margin:0.6rem 0 0">
              Assumes {resolved.name} attacks only with moves of its own types. Higher is better.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
