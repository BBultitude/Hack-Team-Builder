import { useMemo } from 'preact/hooks'
import type { GameData, RosterEntry } from '../types'
import type { Lookup } from '../logic/lookup'
import { resolveMember } from '../logic/member'
import {
  MAX_TEAM,
  analyseTeam,
  autoBuild,
  learnableFixes,
  suggestAdditions,
} from '../logic/team'
import { DefenceMatrix } from './DefenceMatrix'
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

function newEntry(data: GameData, name: string, dexIndex: number | undefined): RosterEntry {
  const vanilla = dexIndex === undefined ? undefined : data.dex[dexIndex]
  return {
    n: vanilla?.n ?? name,
    a: vanilla?.t[0] ?? 0,
    b: vanilla?.t[1] ?? -1,
    ab: vanilla?.ab[0] ?? '',
    nt: Math.max(data.natures.findIndex((n) => n.up === null), 0),
    mv: ['', '', '', ''],
    st: null,
    d: dexIndex ?? -1,
  }
}

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
  const fixes = useMemo(
    () => learnableFixes(data, members, analysis.uncovered),
    [data, members, analysis.uncovered],
  )
  const suggestions = useMemo(
    () => suggestAdditions(data, lookup, roster, team),
    [data, lookup, roster, team],
  )

  const typeName = (i: number): string => data.chart.types[i] ?? '?'

  const add = (name: string): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    const dexIndex = lookup.dexByName.get(trimmed.toLowerCase())
    const entry = newEntry(data, trimmed, dexIndex)
    const next = [...roster, entry]
    props.onRoster(next)
    if (team.length < MAX_TEAM) props.onTeam([...team, next.length - 1])
    props.onOpenIndex(next.length - 1)
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
            Nothing on the team yet. Add Pokémon below, or use Auto-build.
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
                No attack option hits these super-effectively.
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
                {members.some((m) => m.assumedFromTypes) &&
                  ' Members with no moves entered are assumed to attack with their own types.'}
              </p>
            </div>
          </div>

          {fixes.length > 0 && (
            <div class="card">
              <h2>Learnable fixes</h2>
              <p class="muted" style="margin:0 0 0.5rem">
                Best move each member could learn to close a coverage gap.
              </p>
              <div class="stack">
                {fixes.map((f) => (
                  <p key={f.type} style="margin:0">
                    <span class="type">{typeName(f.type)}</span>{' '}
                    <strong>{f.memberName}</strong> could learn <strong>{f.move.n}</strong>{' '}
                    <span class="muted">
                      ({typeName(f.move.t)}, power {f.move.p}
                      {f.stab ? ', Same-Type Attack Bonus' : ''})
                    </span>
                  </p>
                ))}
              </div>
            </div>
          )}

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
                    <button onClick={() => toggleTeam(s.index)} disabled={team.length >= MAX_TEAM}>
                      Add
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <h2 style="margin:1rem 0 0.5rem">Your Pokémon ({roster.length})</h2>
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
