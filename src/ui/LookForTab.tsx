import { useMemo } from 'preact/hooks'
import type { GameData, RosterEntry } from '../types'
import type { Lookup } from '../logic/lookup'
import { lookFor } from '../logic/team'
import { evolutionPath } from '../logic/member'
import { catchPlan } from '../logic/catching'
import { Types } from './Types'
import { Sprite } from './Sprite'

interface Props {
  data: GameData
  lookup: Lookup
  roster: RosterEntry[]
  team: number[]
  /** Adds the caught Pokemon by name. */
  onCaught: (name: string) => void
}

export function LookForTab(props: Props) {
  const { data, lookup, roster, team } = props

  const targets = useMemo(
    () => (roster.length ? lookFor(data, lookup, roster, team) : []),
    [data, lookup, roster, team],
  )

  const typeName = (i: number): string => data.chart.types[i] ?? '?'
  const name = (i: number): string => data.dex[i]?.n ?? '?'

  if (roster.length === 0) {
    return <p class="empty">Add the Pokémon you own in the Pokédex tab first.</p>
  }

  return (
    <div>
      <div class="card">
        <h2>Pokémon to look for</h2>
        <p class="muted" style="margin:0">
          Species you don't own yet that would most improve {team.length ? 'your team' : 'the best six you own'}.
          {data.obtain
            ? ' Only what this hack lets you get, with where to find it.'
            : ' Legendaries, event Pokémon and very rare catches are left out. Where to find them depends on your hack.'}{' '}
          Anything an Ultra Ball can't realistically catch (under 10% a throw at 1 HP, asleep) is hidden.
        </p>
      </div>

      {targets.length === 0 ? (
        <p class="empty">Nothing catchable would improve this team on type matchups.</p>
      ) : (
        targets.map((t) => {
          const dex = data.dex[t.index]!
          const plan = t.gift ? null : catchPlan(data, roster, team, t.catchFrom)
          return (
            <div key={t.index} class="card">
              <div class="row">
                <Sprite gen={data.gen} id={dex.id} size={96} />
                <span class="grow" style="min-width:0">
                  <strong class="truncate" style="display:block">{dex.n}</strong>
                  <Types data={data} types={dex.t} />
                </span>
                <span class="good lcd" title="Team score gain">+{t.gain.toFixed(1)}</span>
              </div>
              {t.catchFrom !== t.index && (
                <p style="margin:0.3rem 0 0">
                  Look for <Sprite gen={data.gen} id={data.dex[t.catchFrom]?.id} size={32} />
                  <strong>{name(t.catchFrom)}</strong>
                  {evolutionPath(data, t.catchFrom, t.index).slice(1).map((stage, i, rest) => {
                    const prev = i === 0 ? t.catchFrom : rest[i - 1]!
                    const how = data.dex[prev]?.eh?.[data.dex[prev]?.ev?.indexOf(stage) ?? -1]
                    return (
                      <span key={stage}>
                        {' → '}
                        {name(stage)}
                        {how && <span class="muted"> ({how})</span>}
                      </span>
                    )
                  })}
                </p>
              )}
              {t.where && (
                <p style="margin:0.3rem 0 0">
                  <strong>Where:</strong> {t.where}
                </p>
              )}
              {t.gift && <p class="muted" style="margin:0.3rem 0 0">Gift, egg or trade: no catch needed.</p>}
              {(t.resists.length > 0 || t.hits.length > 0) && (
                <p class="muted" style="margin:0.3rem 0 0">
                  {t.resists.length > 0 && `Covers your ${t.resists.map(typeName).join(', ')} weakness. `}
                  {t.hits.length > 0 && `Hits ${t.hits.map(typeName).join(', ')} super-effectively.`}
                </p>
              )}
              {plan && (
                <details style="margin-top:0.4rem">
                  <summary>How to catch {name(t.catchFrom)}</summary>
                  <ol class="moves">
                    {plan.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                  <p class="muted" style="margin:0.3rem 0 0">
                    Odds are estimates from the standard catch formula; hacks can tweak it.
                  </p>
                </details>
              )}
              <button style="margin-top:0.5rem" onClick={() => props.onCaught(name(t.catchFrom))}>
                {t.gift ? 'I got' : 'I caught'} {name(t.catchFrom)}
              </button>
            </div>
          )
        })
      )}
    </div>
  )
}
