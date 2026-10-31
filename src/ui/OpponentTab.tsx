import { useMemo, useState } from 'preact/hooks'
import type { GameData, RosterEntry, Trainer, TrainerMon } from '../types'
import type { Lookup } from '../logic/lookup'
import { type Member, resolveMember } from '../logic/member'
import type { RankScope, SavedOpponent } from '../logic/storage'
import {
  type Opponent,
  type Ranking,
  describeHit,
  describeIncoming,
  describeOffence,
  describeSpeed,
  learningTip,
  rankMembers,
  resolveOpponent,
} from '../logic/opponent'
import { Suggest } from './Suggest'
import { dexNames, moveNames } from '../logic/setup'
import { Sprite } from './Sprite'
import { Types } from './Types'

interface Props {
  data: GameData
  lookup: Lookup
  roster: RosterEntry[]
  team: number[]
  opponent: SavedOpponent | null
  scope: RankScope
  /** Roster index of the Pokemon currently out; also set from the party bar. */
  out: number | null
  onOut: (rosterIndex: number | null) => void
  onOpponent: (o: SavedOpponent | null) => void
  onScope: (s: RankScope) => void
  /** Boss teams for the setup's hack and difficulty; empty without hack data. */
  trainers: Trainer[]
}

/** A trainer's Pokemon as the opponent, with everything the hack's docs give. */
function fromTrainer(data: GameData, trainer: string, mon: TrainerMon): SavedOpponent {
  const nt = data.natures.findIndex((n) => n.n === mon.nt)
  return {
    name: mon.n,
    ability: mon.ab,
    lv: mon.lv,
    mv: mon.mv,
    ...(mon.it ? { item: mon.it } : {}),
    ...(nt >= 0 ? { nt } : {}),
    ev: mon.ev,
    iv: mon.iv,
    trainer,
  }
}

export function OpponentTab(props: Props) {
  const { data, lookup, roster, team, opponent, scope } = props
  const [abilityDraft, setAbilityDraft] = useState(opponent?.ability ?? '')
  const [trainerDraft, setTrainerDraft] = useState(opponent?.trainer ?? '')
  const trainer = props.trainers.find((t) => t.name === trainerDraft)
  const outIndex = props.out

  const resolved: Opponent | null = useMemo(() => resolveOpponent(data, lookup, opponent), [data, lookup, opponent])
  const opponentEntry = resolved ? data.dex[resolved.d] : undefined
  const patchOpponent = (fields: Partial<SavedOpponent>): void => {
    if (opponent) props.onOpponent({ ...opponent, ...fields })
  }
  const opponentMoves = opponent?.mv ?? []
  const allMoves = useMemo(() => moveNames(data), [data])

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
    [data, members, resolved],
  )

  const best = ranked[0]
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : undefined
  const outRank = outIndex === null ? -1 : ranked.findIndex((r) => indices[r.slot] === outIndex)
  const out = ranked[outRank]

  const spriteOf = (slot: number): number | undefined => data.dex[members[slot]?.entry.d ?? -1]?.id

  return (
    <div>
      <div class="card stack">
        <h2 style="margin:0">Opponent</h2>
        {props.trainers.length > 0 && (
          <label class="field">
            <span>Trainer</span>
            <Suggest
              value={trainerDraft}
              placeholder="Leader, rival, boss…"
              options={props.trainers.map((t) => t.name)}
              onInput={setTrainerDraft}
              onPick={setTrainerDraft}
            />
          </label>
        )}
        {trainer && (
          <div class="row wrap" role="group" aria-label={`${trainer.name}'s team`}>
            {trainer.team.map((mon, i) => {
              const picked = opponent?.trainer === trainer.name && opponent.name === mon.n && opponent.lv === mon.lv
              return (
                <button
                  key={i}
                  class={picked ? 'primary' : ''}
                  aria-pressed={picked}
                  title={`${mon.n}, level ${mon.lv}`}
                  aria-label={`${mon.n}, level ${mon.lv}`}
                  onClick={() => {
                    setAbilityDraft(mon.ab)
                    props.onOpponent(fromTrainer(data, trainer.name, mon))
                  }}
                >
                  <Sprite gen={data.gen} id={data.dex[lookup.dexByName.get(mon.n.toLowerCase()) ?? -1]?.id} size={40} />
                  <span class="lcd">{mon.lv}</span>
                </button>
              )
            })}
          </div>
        )}
        <Suggest
          value={opponent?.name ?? ''}
          placeholder={props.trainers.length ? "Or search the dex" : "Search the dex"}
          options={dexNames(data)}
          onPick={(name) => {
            setAbilityDraft('')
            setTrainerDraft('')
            props.onOpponent({ name, ability: '' })
          }}
        />

        {opponentEntry && (
          <>
            <div class="row" style="gap:0.75rem">
              <Sprite gen={data.gen} id={opponentEntry.id} size={96} />
              <div class="stack">
                <strong>
                  {opponent?.trainer ? `${opponent.trainer}'s ` : ''}
                  {opponentEntry.n}
                  {resolved?.level !== null && resolved?.level !== undefined && `, level ${resolved.level}`}
                </strong>
                <div>
                  <Types data={data} types={opponentEntry.t} />
                </div>
                <div class="muted">
                  Base Speed <span class="lcd">{opponentEntry.s[5]}</span>
                  {opponent?.item && <> · holds {opponent.item}</>}
                </div>
              </div>
            </div>
            <label class="field">
              <span>Level (optional)</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                placeholder="Same as each of yours"
                value={opponent?.lv === undefined ? '' : String(opponent.lv)}
                onInput={(e) => {
                  const v = e.currentTarget.value
                  patchOpponent({ lv: v === '' ? undefined : Math.min(Math.max(Math.trunc(Number(v) || 1), 1), 100) })
                }}
              />
            </label>
            <div class="field">
              <span>Its moves (optional)</span>
              <div class="stat-grid">
                {[0, 1, 2, 3].map((slot) => {
                  const set = (v: string): void => {
                    const next = [0, 1, 2, 3].map((i) => opponentMoves[i] ?? '')
                    next[slot] = v
                    patchOpponent({ mv: next })
                  }
                  return (
                    <Suggest
                      key={slot}
                      value={opponentMoves[slot] ?? ''}
                      placeholder={`Move ${slot + 1}`}
                      options={allMoves}
                      onInput={set}
                      onPick={set}
                    />
                  )
                })}
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
                  patchOpponent({ ability: v })
                }}
                onPick={(v) => {
                  setAbilityDraft(v)
                  patchOpponent({ ability: v })
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
              {out.deals && out.deals.max > 0 && !out.dealsGuessed && (
                <p style="margin:0">
                  Aim with <strong>{out.deals.move.n}</strong>.
                </p>
              )}
              {out.survives && !out.wins && (out.takes?.max ?? 0) >= 50 && (
                <p class="danger" style="margin:0">
                  {out.takes!.move.n} takes half its Hit Points or more, so don't stay in long.
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
              Sorted by: survives its hardest hit, then wins the exchange (hits to knock out, Speed for
              ties), then takes longest to knock out. Damage is a share of Hit Points from full.
              {resolved.moves.length
                ? ` Uses ${resolved.name}'s known moves.`
                : ` ${resolved.name}'s moves are unknown, so its strongest learnable moves of its own types are assumed.`}
              {resolved.level === null && ` Its level is assumed to match each of yours.`} Your Pokémon are
              assumed untrained (no EVs, perfect IVs); no critical hits or weather.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

const hits = (n: number): string => (n === 1 ? 'one hit' : `${n} hits`)

function verdict(out: Ranking, best: Ranking, opponentName: string): string {
  if (out.myHits === Infinity) return `Nothing it knows hurts ${opponentName}. Switch out.`
  const swap = out === best ? '' : ` Switch to ${best.name} if you can.`
  if (!out.survives) return `It knocks ${out.name} out in one hit.${swap || ' Nothing you have does better.'}`
  if (out.wins) return `Wins this: knocks it out in ${hits(out.myHits)} before it can.${out === best ? ' Stay in.' : ''}`
  return `Survives a hit but loses the exchange.${swap}`
}

/** "Knocks it out in 2 hits; it needs 3." */
function exchange(r: Ranking): string {
  const mine = r.myHits === Infinity ? "Can't knock it out" : `Knocks it out in ${hits(r.myHits)}`
  const theirs = r.theirHits === Infinity ? "it can't hurt you" : `it needs ${hits(r.theirHits)}`
  return `${mine}; ${theirs}.`
}

function MatchupDetails(props: { data: GameData; r: Ranking; member: Member; opponent: Opponent }) {
  const { data, r, member, opponent } = props
  const typeName = (i: number): string => data.chart.types[i] ?? '?'
  const tip = learningTip(data, member, opponent)
  return (
    <>
      {opponent.setup && r.setupRisk && (
        <p class="danger" style="margin:0">
          It has {opponent.setup}: finish it within two hits or it snowballs.
        </p>
      )}
      <ul style="margin:0;padding-left:1.1rem">
        <li>{exchange(r)}</li>
        {r.takes && (
          <li class={r.ohkoRisk ? 'danger' : ''}>
            Takes {describeHit(r.takes)}
            {r.ohkoRisk && ' — can be knocked out in one hit'}
          </li>
        )}
        {r.coverage && (
          <li class="danger">
            Could also know {describeHit(r.coverage)} — coverage outside its own types
          </li>
        )}
        {r.deals && (
          <li>
            Deals {describeHit(r.deals)}
            {r.dealsGuessed && ' — guessed, no moves entered'}
          </li>
        )}
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
          {tip.stab ? ', Same-Type Attack Bonus' : ''}): up to {tip.value}%
          {tip.currentValue > 0 ? ` instead of ${tip.currentValue}%` : ''}.
        </p>
      )}
    </>
  )
}

/** "takes 45% deals 80%" (top rolls) in the Dex's digital face; "KO" when one hit can knock it out. */
function Readout({ r }: { r: Ranking }) {
  const takes = Math.round(r.takes?.max ?? 0)
  const deals = Math.round(r.deals?.max ?? 0)
  return (
    <span
      class="readout"
      aria-label={`${r.ohkoRisk ? 'can be knocked out in one hit' : `takes up to ${takes}%`}, deals up to ${deals}%, ${r.wins ? 'wins' : 'loses'} the exchange`}
    >
      <span class={r.ohkoRisk ? 'bad' : takes <= 25 ? 'safe' : ''}>
        takes <span class="lcd">{r.ohkoRisk ? 'KO' : `${takes}%`}</span>
      </span>
      <span class={deals === 0 ? 'bad' : deals >= 100 ? 'safe' : ''}>
        deals <span class="lcd">{deals}%</span>
      </span>
      <span class={r.wins ? 'safe' : 'bad'}>{r.wins ? 'wins' : 'loses'}</span>
    </span>
  )
}
