import { useMemo } from 'preact/hooks'
import type { GameData, RosterEntry } from '../types'
import type { Lookup } from '../logic/lookup'
import { resolveMember } from '../logic/member'
import {
  MAX_TEAM,
  analyseTeam,
  autoBuild,
  keptMoves,
  recommendMoves,
  suggestAdditions,
  swapReasons,
} from '../logic/team'
import { ATTACK_ABILITIES } from '../logic/abilities'
import { DefenceMatrix } from './DefenceMatrix'
import { Sprite } from './Sprite'
import { Types } from './Types'

interface Props {
  data: GameData
  lookup: Lookup
  roster: RosterEntry[]
  team: number[]
  /** Emerald Rogue: the team is the run's party, with no boxes to build from. */
  partyOnly?: boolean
  onTeam: (team: number[]) => void
  /** Opens a roster entry's details. */
  onOpen: (rosterIndex: number) => void
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
    () => (props.partyOnly ? [] : suggestAdditions(data, lookup, roster, team)),
    [data, lookup, roster, team, props.partyOnly],
  )

  const typeName = (i: number): string => data.chart.types[i] ?? '?'

  return (
    <div class="cards">
      <div class="card">
        <div class="row">
          <h2 class="grow" style="margin:0">
            {props.partyOnly ? 'Party' : 'Team'} ({team.length}/{MAX_TEAM})
          </h2>
          {!props.partyOnly && (
            <button
              onClick={() => props.onTeam(autoBuild(data, lookup, roster))}
              disabled={roster.length === 0}
            >
              Auto-build
            </button>
          )}
        </div>
        {props.partyOnly && (
          <p class="muted" style="margin:0.5rem 0 0">
            Runs are short and there are no boxes to swap from, so get the most out of the party you have: teach
            the moves below, and cover the gaps with your next catch.
          </p>
        )}
        {team.length === 0 ? (
          <p class="muted" style="margin:0.5rem 0 0">
            {props.partyOnly
              ? 'No party yet. Add your starter in the Pokédex tab.'
              : 'Nothing on the team yet. Add Pokémon in the Pokédex tab, or use Auto-build to pick the best six you own.'}
          </p>
        ) : (
          <>
            <p class="muted" style="margin:0.6rem 0 0">
              Team score <strong class="lcd">{analysis.score.toFixed(1)}</strong>. Defence{' '}
              <span class="lcd">{analysis.defensiveScore.toFixed(1)}</span>, coverage{' '}
              <span class="lcd">{analysis.covered.length}/{data.chart.types.length}</span> types.
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
              possible. Each Pokémon leans to its stronger attacking stat (nature included) and its
              ability; Defence, HP and Speed don't change which attack hits hardest. Status moves you
              entered are kept. Based on vanilla learnsets; ones it doesn't know yet are marked to teach.
            </p>
            <div class="stack">
              {members.map((m, slot) => {
                const recs = recommended[slot]
                const knows = (name: string): boolean => m.moves.some((mv) => mv.n === name)
                // Entered attacks the plan leaves out, each paired with a taught move to take its slot.
                const spare = recs ? m.moves.filter((mv) => mv.p > 0 && !recs.some((r) => r.move.n === mv.n)) : []
                // Same type first, so Ember pairs with Flamethrower rather than whatever comes next.
                const untaught = recs ? recs.filter((r) => !knows(r.move.n)) : []
                const pairs = spare.map((old) => {
                  const i = Math.max(untaught.findIndex((r) => r.move.t === old.t), 0)
                  return { old, rec: untaught.splice(i, 1)[0] }
                })
                const kept = keptMoves(m)
                const drivers = [
                  m.role,
                  m.nature?.up != null ? m.nature.n : null,
                  m.ability && ATTACK_ABILITIES.has(m.ability.trim().toLowerCase()) ? m.ability : null,
                ].filter(Boolean)
                return (
                  <div key={`${m.entry.n}-${slot}`}>
                    <h3 class="row" style="margin:0 0 0.2rem;gap:0.3rem">
                      <Sprite gen={data.gen} id={data.dex[m.entry.d]?.id} />
                      {m.entry.n} <span class="muted">({drivers.join(' · ')})</span>
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
                            {m.moves.length > 0 && (knows(r.move.n) ? <span class="pill">Knows it</span> : <span class="muted">(teach)</span>)}{' '}
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
                    {kept.length > 0 && (
                      <p class="muted" style="margin:0.2rem 0 0">Keeps: {kept.join(', ')}.</p>
                    )}
                    {pairs.map(({ old, rec }, i) => {
                      if (!rec) return null
                      const why = swapReasons(data, m, old, rec)
                      return (
                        <p key={i} style="margin:0.2rem 0 0">
                          Swap <strong>{old.n}</strong> → <strong>{rec.move.n}</strong>
                          <span class="muted">
                            : {why.length ? why.join('; ') : `close call, keeping ${old.n} costs little`}.
                          </span>
                        </p>
                      )
                    })}
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

          <DefenceMatrix
            data={data}
            members={members}
            grid={analysis.grid}
            onOpen={(i) => props.onOpen(roster.indexOf(members[i]!.entry))}
          />

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
                  <Types data={data} types={analysis.exposed} weak />
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
                  <span class="muted">None — the team hits all {data.chart.types.length} types.</span>
                ) : (
                  <Types data={data} types={analysis.uncovered} />
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
                  <div key={s.index}>
                    <div class="row">
                      <Sprite gen={data.gen} id={data.dex[roster[s.index]?.d ?? -1]?.id} size={32} />
                      <span class="grow truncate">{roster[s.index]?.n}</span>
                      <span class={s.gain >= 0 ? 'good lcd' : 'muted lcd'} title="Team score gain">
                        {s.gain >= 0 ? '+' : ''}
                        {s.gain.toFixed(1)}
                      </span>
                      <button onClick={() => props.onTeam([...team, s.index])} disabled={team.length >= MAX_TEAM}>
                        Add
                      </button>
                    </div>
                    {(s.resists.length > 0 || s.hits.length > 0) && (
                      <p class="muted" style="margin:0.2rem 0 0">
                        {s.resists.length > 0 && `Covers your ${s.resists.map(typeName).join(', ')} weakness. `}
                        {s.hits.length > 0 && `Hits ${s.hits.map(typeName).join(', ')} super-effectively.`}
                      </p>
                    )}
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
