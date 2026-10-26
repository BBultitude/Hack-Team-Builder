import { useMemo } from 'preact/hooks'
import type { GameData, RosterEntry } from '../types'
import type { Lookup } from '../logic/lookup'
import { resolveMember } from '../logic/member'
import {
  MAX_TEAM,
  analyseTeam,
  autoBuild,
  recommendMoves,
  suggestAdditions,
} from '../logic/team'
import { DefenceMatrix } from './DefenceMatrix'

interface Props {
  data: GameData
  lookup: Lookup
  roster: RosterEntry[]
  team: number[]
  onTeam: (team: number[]) => void
}

/** The Best Team tab: the chosen six, how they hold up, and what to teach them. */
export function TeamTab(props: Props) {
  const { data, lookup, roster, team } = props

  const members = useMemo(
    () =>
      team
        .map((i) => roster[i])
        .filter((e): e is RosterEntry => e !== undefined)
        .map((e) => resolveMember(data, lookup, e)),
    [data, lookup, roster, team],
  )

  const analysis = useMemo(() => analyseTeam(data, members), [data, members])
  const recommended = useMemo(() => recommendMoves(data, members), [data, members])
  const suggestions = useMemo(
    () => suggestAdditions(data, lookup, roster, team),
    [data, lookup, roster, team],
  )

  const typeName = (i: number): string => data.chart.types[i] ?? '?'

  return (
    <div>
      <div class="card">
        <div class="row">
          <h2 class="grow" style="margin:0">
            Team ({team.length}/{MAX_TEAM})
          </h2>
          <button
            onClick={() => props.onTeam(autoBuild(data, lookup, roster))}
            disabled={roster.length === 0}
          >
            Auto-build
          </button>
        </div>
        {team.length === 0 ? (
          <p class="muted" style="margin:0.5rem 0 0">
            Nothing on the team yet. Add Pokémon in the Pokédex tab, or use Auto-build to pick the
            best six you own.
          </p>
        ) : (
          <>
            <p class="row wrap" style="margin:0.6rem 0 0;gap:0.3rem">
              {members.map((m) => (
                <span key={m.entry.n} class="type">{m.entry.n}</span>
              ))}
            </p>
            <p class="muted" style="margin:0.6rem 0 0">
              Team score <strong>{analysis.score.toFixed(1)}</strong> — defence{' '}
              {analysis.defensiveScore.toFixed(1)}, coverage {analysis.covered.length}/18 types.
            </p>
          </>
        )}
      </div>

      {team.length > 0 && (
        <>
          <div class="card">
            <h2>Recommended moves</h2>
            <p class="muted" style="margin:0 0 0.5rem">
              Four learnable moves each, chosen so the team between them hits as many types as
              possible. Based on vanilla learnsets.
            </p>
            <div class="stack">
              {members.map((m, slot) => {
                const recs = recommended[slot]
                return (
                  <div key={`${m.entry.n}-${slot}`}>
                    <h3 style="margin:0 0 0.2rem">
                      {m.entry.n} <span class="muted">({m.role})</span>
                    </h3>
                    {recs === null || recs === undefined ? (
                      <p class="muted" style="margin:0">
                        Custom Pokémon — no learnset known, so enter its moves yourself.
                      </p>
                    ) : (
                      <ol class="moves">
                        {recs.map((r) => (
                          <li key={r.move.n}>
                            <strong>{r.move.n}</strong>{' '}
                            <span class="muted">
                              {typeName(r.move.t)}, power {r.move.p}
                              {r.stab ? ', Same-Type Attack Bonus' : ''}
                              {r.covers.length > 0 &&
                                `, covers ${r.covers.map(typeName).join(', ')}`}
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {analysis.membersMissingAbility.length > 0 && (
            <div class="card">
              <p class="danger" style="margin:0">
                No ability set for {analysis.membersMissingAbility.join(', ')}. Immunities such as
                Levitate change the defensive picture, so set them if your hack keeps them.
              </p>
            </div>
          )}

          <DefenceMatrix data={data} members={members} grid={analysis.grid} />

          <div class="card stack">
            <div>
              <h3>Exposed types</h3>
              <p class="muted" style="margin:0.1rem 0 0.3rem">
                Something on the team is weak to these and nothing resists them.
              </p>
              <div class="chip-row">
                {analysis.exposed.length === 0 ? (
                  <span class="muted">None — every weakness is covered by a resistance.</span>
                ) : (
                  analysis.exposed.map((t) => (
                    <span key={t} class="type weak">{typeName(t)}</span>
                  ))
                )}
              </div>
            </div>

            <div>
              <h3>Uncovered types</h3>
              <p class="muted" style="margin:0.1rem 0 0.3rem">
                No attack option hits these super-effectively. Moves you have entered count; if a
                Pokémon has none, its own types are assumed.
              </p>
              <div class="chip-row">
                {analysis.uncovered.length === 0 ? (
                  <span class="muted">None — the team hits all 18 types.</span>
                ) : (
                  analysis.uncovered.map((t) => (
                    <span key={t} class="type">{typeName(t)}</span>
                  ))
                )}
              </div>
            </div>

            <div>
              <h3>Attack balance</h3>
              <p class="muted" style="margin:0.1rem 0 0">
                {analysis.roles.physical} physical, {analysis.roles.special} special,{' '}
                {analysis.roles.mixed} mixed.
              </p>
            </div>
          </div>

          {suggestions.length > 0 && (
            <div class="card">
              <h2>Suggested additions</h2>
              <div class="stack">
                {suggestions.map((s) => (
                  <div key={s.index} class="row">
                    <span class="grow truncate">{roster[s.index]?.n}</span>
                    <span class={s.gain >= 0 ? 'muted good' : 'muted'}>
                      {s.gain >= 0 ? '+' : ''}
                      {s.gain.toFixed(1)}
                    </span>
                    <button onClick={() => props.onTeam([...team, s.index])} disabled={team.length >= MAX_TEAM}>
                      Add
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
