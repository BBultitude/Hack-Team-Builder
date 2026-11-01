import { useMemo } from 'preact/hooks'
import type { GameData, RosterEntry } from '../types'
import type { Lookup } from '../logic/lookup'
import { lookFor, rateCatches } from '../logic/team'
import { dexNames } from '../logic/setup'
import { Suggest } from './Suggest'
import { evolutionPath } from '../logic/member'
import { catchPlan } from '../logic/catching'
import { Types } from './Types'
import { Sprite } from './Sprite'

interface Props {
  data: GameData
  lookup: Lookup
  roster: RosterEntry[]
  team: number[]
  /** Emerald Rogue's run rules: only what they allow, every one ball-catchable. */
  allow?: (dexIndex: number) => boolean
  /** Adds the caught Pokemon by name, in place of roster index `replaces` when the team is full. */
  onCaught: (name: string, replaces?: number) => void
  /** Emerald Rogue: species on offer on this route, rated one by one. */
  available?: string[]
  onAvailable?: (names: string[]) => void
}

export function LookForTab(props: Props) {
  const { data, lookup, roster, team } = props

  const targets = useMemo(
    () => (roster.length ? lookFor(data, lookup, roster, team, undefined, props.allow) : []),
    [data, lookup, roster, team, props.allow],
  )

  const available = props.available ?? []
  const ratings = useMemo(
    () => (available.length ? rateCatches(data, lookup, roster, team, available) : []),
    [data, lookup, roster, team, available],
  )
  const options = useMemo(() => dexNames(data), [data])

  const typeName = (i: number): string => data.chart.types[i] ?? '?'
  const name = (i: number): string => data.dex[i]?.n ?? '?'

  if (roster.length === 0) {
    return <p class="empty">Add the Pokémon you own in the Pokédex tab first.</p>
  }

  return (
    <div class="cards">
      <div class="card">
        <h2>{props.allow ? 'Capture next' : 'Pokémon to look for'}</h2>
        {props.allow ? (
          <p class="muted" style="margin:0">
            Species that would most improve your party, swapping one out if it's full. Only what your run Pokédex
            lets appear, without legendaries, which only come from legendary rooms.
          </p>
        ) : (
          <p class="muted" style="margin:0">
            Species you don't own yet that would most improve {team.length ? 'your team' : 'the best six you own'}.
            {data.obtain
              ? ' Only what this hack lets you get, with where to find it.'
              : ' Legendaries, event Pokémon and very rare catches are left out. Where to find them depends on your hack.'}{' '}
            Anything an Ultra Ball can't realistically catch (under 10% a throw at 1 HP, asleep) is hidden.
          </p>
        )}
      </div>

      {props.onAvailable && (
        <div class="card stack">
          <div class="row">
            <h2 class="grow" style="margin:0">Available here</h2>
            <button onClick={() => props.onAvailable!([])} disabled={available.length === 0}>
              Clear
            </button>
          </div>
          <p class="muted" style="margin:0">
            Add what you can catch on this route; each one is checked against your party. Clear it for the next route.
          </p>
          <Suggest
            value=""
            placeholder="Add a Pokémon you can see"
            options={options}
            clearOnPick
            onPick={(n) => !available.includes(n) && props.onAvailable!([...available, n])}
          />
          {ratings.map((r) => {
            const seen = name(r.index)
            const swapOut = r.replaces === undefined ? undefined : roster[r.replaces]
            return (
              <div key={r.index} class="row wrap">
                <Sprite gen={data.gen} id={data.dex[r.index]?.id} size={40} />
                <span class="grow" style="min-width:0">
                  <strong>{seen}</strong>{' '}
                  {r.owned ? (
                    <span class="muted">Skip: already in your party.</span>
                  ) : r.gain > 0 ? (
                    <span>
                      <strong class="good">Catch</strong>
                      {r.target !== r.index && ` (as ${name(r.target)})`}
                      {swapOut ? `, replaces ${swapOut.n}` : ''}{' '}
                      <span class="lcd good">+{r.gain.toFixed(1)}</span>
                    </span>
                  ) : (
                    <span class="muted">Skip: doesn't beat your party.</span>
                  )}
                </span>
                {!r.owned && r.gain > 0 && (
                  <button
                    onClick={() => {
                      // Caught, so no longer on offer: it would only read "already in your party" from now on.
                      props.onAvailable!(available.filter((n) => n !== seen))
                      props.onCaught(seen, r.replaces)
                    }}
                  >
                    I caught {seen}
                  </button>
                )}
                <button
                  class="link"
                  aria-label={`Remove ${seen} from available`}
                  onClick={() => props.onAvailable!(available.filter((n) => n !== seen))}
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      )}

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
              {/* With no team picked, the full six is only the auto-built one: nothing of the player's to swap out. */}
              {t.replaces !== undefined && roster[t.replaces] && (props.allow || team.length > 0) && (
                <p style="margin:0.3rem 0 0">
                  <strong>{props.allow ? 'Replaces' : 'Swap out'}</strong>{' '}
                  <Sprite gen={data.gen} id={data.dex[roster[t.replaces]!.d]?.id} size={32} />
                  {roster[t.replaces]!.n}
                  <span class="muted"> — the swap that helps the whole team most</span>
                </p>
              )}
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
              <button style="margin-top:0.5rem" onClick={() => props.onCaught(name(t.catchFrom), t.replaces)}>
                {t.gift ? 'I got' : 'I caught'} {name(t.catchFrom)}
              </button>
            </div>
          )
        })
      )}
    </div>
  )
}
