import { useMemo, useState } from 'preact/hooks'
import type { GameData, RosterEntry } from '../types'
import type { Lookup } from '../logic/lookup'
import { entryFromDex } from '../logic/member'
import { MAX_TEAM } from '../logic/team'
import { dexNames } from '../logic/setup'
import { type DexMode, dexList, hasEdits, ownership } from '../logic/checklist'
import { Sprite } from './Sprite'
import { Suggest } from './Suggest'
import { Types } from './Types'

interface Props {
  data: GameData
  lookup: Lookup
  roster: RosterEntry[]
  team: number[]
  /** The hack's own dex order, when it has one. */
  regional?: string[]
  onRoster: (roster: RosterEntry[]) => void
  onTeam: (team: number[]) => void
  /** Opens an owned Pokemon's details. */
  onOpen: (rosterIndex: number) => void
}

type Filter = 'all' | 'caught' | 'missing'

/** Adds a Pokemon by name to the roster, and to the team while there is room. */
export function addToRoster(
  data: GameData,
  lookup: Lookup,
  roster: RosterEntry[],
  team: number[],
  name: string,
): { roster: RosterEntry[]; team: number[] } | null {
  const trimmed = name.trim()
  if (!trimmed) return null
  const next = [...roster, entryFromDex(data, trimmed, lookup.dexByName.get(trimmed.toLowerCase()))]
  return { roster: next, team: team.length < MAX_TEAM ? [...team, next.length - 1] : team }
}

/** The roster without entry i; team indices after it shift down by one. */
export function removeFromRoster(roster: RosterEntry[], team: number[], i: number): { roster: RosterEntry[]; team: number[] } {
  return {
    roster: roster.filter((_, j) => j !== i),
    team: team.filter((t) => t !== i).map((t) => (t > i ? t - 1 : t)),
  }
}

export function toggleInTeam(team: number[], i: number): number[] {
  if (team.includes(i)) return team.filter((t) => t !== i)
  return team.length < MAX_TEAM ? [...team, i] : team
}

/** The game's Pokédex as a checklist: ticked when caught; tap a caught one for its details. */
export function PokedexTab(props: Props) {
  const { data, lookup, roster, team, regional } = props
  const [mode, setMode] = useState<DexMode>(regional?.length ? 'regional' : 'national')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  /** Dex index whose untick is waiting for a second tap, because the Pokémon has edits. */
  const [pending, setPending] = useState<number | null>(null)

  const list = useMemo(() => dexList(data, lookup, mode, regional), [data, lookup, mode, regional])
  const owned = useMemo(() => ownership(roster), [roster])
  const inList = useMemo(() => new Set(list), [list])
  const caught = list.filter((i) => owned.has(i)).length

  const q = query.trim().toLowerCase()
  const rows = list
    .map((dexIndex, position) => ({ dexIndex, number: mode === 'regional' && regional?.length ? position + 1 : data.dex[dexIndex]!.id }))
    .filter(({ dexIndex }) => {
      const has = owned.has(dexIndex)
      if ((filter === 'caught' && !has) || (filter === 'missing' && has)) return false
      return !q || data.dex[dexIndex]!.n.toLowerCase().includes(q)
    })
  /** Owned but not on this list: custom Pokémon, or species outside the regional dex. */
  const others = roster.map((e, i) => ({ e, i })).filter(({ e }) => !inList.has(e.d))

  const apply = (next: { roster: RosterEntry[]; team: number[] } | null): void => {
    if (!next) return
    props.onRoster(next.roster)
    props.onTeam(next.team)
  }

  const toggle = (dexIndex: number): void => {
    const mine = owned.get(dexIndex)
    if (!mine) {
      setPending(null)
      apply(addToRoster(data, lookup, roster, team, data.dex[dexIndex]!.n))
      return
    }
    // The newest one goes first; one with edits needs a second untick so work isn't lost by a slip.
    const last = mine[mine.length - 1]!
    if (hasEdits(data, roster[last]!) && pending !== dexIndex) {
      setPending(dexIndex)
      return
    }
    setPending(null)
    apply(removeFromRoster(roster, team, last))
  }

  return (
    <div>
      <div class="card stack">
        <div class="row">
          <h2 class="grow" style="margin:0">Pokédex</h2>
          <span class="lcd" aria-label={`${caught} of ${list.length} caught`}>
            {caught}/{list.length}
          </span>
        </div>
        {regional?.length ? (
          <div class="row" role="group" aria-label="Which dex">
            {(['regional', 'national'] as const).map((m) => (
              <button key={m} aria-pressed={mode === m} class={mode === m ? 'primary' : ''} onClick={() => setMode(m)}>
                {m === 'regional' ? 'Regional' : 'National'}
              </button>
            ))}
          </div>
        ) : null}
        <input
          type="search"
          placeholder="Filter by name"
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
          aria-label="Filter the Pokédex by name"
        />
        <div class="row" role="group" aria-label="Show">
          {(['all', 'caught', 'missing'] as const).map((f) => (
            <button key={f} aria-pressed={filter === f} class={filter === f ? 'primary' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'caught' ? 'Caught' : 'Missing'}
            </button>
          ))}
        </div>
      </div>

      {/* shortcut: renders every row (about 500-1,000); window it if this lags on a phone. */}
      <ul class="dex-list">
        {rows.map(({ dexIndex, number }) => {
          const dex = data.dex[dexIndex]!
          const mine = owned.get(dexIndex)
          const id = `caught-${dexIndex}`
          const body = (
            <>
              <span class="lcd dex-no">{String(number).padStart(3, '0')}</span>
              <Sprite gen={data.gen} id={dex.id} size={40} />
              <span class="grow" style="min-width:0">
                <span class="truncate" style="display:block">{dex.n}</span>
                <Types data={data} types={dex.t} />
              </span>
              {mine && mine.length > 1 && <span class="lcd">×{mine.length}</span>}
              {mine?.some((i) => team.includes(i)) && <span class="pill">Team</span>}
            </>
          )
          return (
            <li key={dexIndex} class={mine ? 'dex-row caught' : 'dex-row'}>
              <input
                type="checkbox"
                id={id}
                checked={!!mine}
                onChange={(e) => {
                  // Stay ticked until the second untick of an edited Pokémon.
                  e.currentTarget.checked = !!mine
                  toggle(dexIndex)
                }}
                aria-label={`${dex.n} caught`}
              />
              {mine ? (
                <button class="dex-open" onClick={() => props.onOpen(mine[mine.length - 1]!)} aria-label={`Open ${dex.n}`}>
                  {body}
                </button>
              ) : (
                <label class="dex-open" for={id}>
                  {body}
                </label>
              )}
              {pending === dexIndex && (
                <p class="danger dex-pending" role="status">
                  {dex.n} has edits. Untick again to remove it.
                </p>
              )}
            </li>
          )
        })}
      </ul>
      {rows.length === 0 && <p class="empty">Nothing matches.</p>}

      <div class="card stack">
        <h2 style="margin:0">Other Pokémon</h2>
        <p class="muted" style="margin:0">
          Custom Pokémon{regional?.length && mode === 'regional' ? ', and anything you own from outside the regional dex' : ''}.
          Type a name and press Enter to add one the dex doesn't have.
        </p>
        <Suggest
          value=""
          placeholder="Search by name, or type a custom one"
          options={dexNames(data)}
          onPick={(name) => {
            const next = addToRoster(data, lookup, roster, team, name)
            if (!next) return
            apply(next)
            props.onOpen(next.roster.length - 1)
          }}
          clearOnPick
        />
        {others.length > 0 && (
          <ul class="dex-list">
            {others.map(({ e, i }) => (
              <li key={i} class="dex-row caught">
                <button class="dex-open" onClick={() => props.onOpen(i)}>
                  <Sprite gen={data.gen} id={data.dex[e.d]?.id} size={40} />
                  <span class="grow" style="min-width:0">
                    <span class="truncate" style="display:block">{e.n}</span>
                    <Types data={data} types={e.b >= 0 ? [e.a, e.b] : [e.a]} />
                  </span>
                  {team.includes(i) && <span class="pill">Team</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
