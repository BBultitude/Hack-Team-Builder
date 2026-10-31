import { useMemo, useState } from 'preact/hooks'
import type { GameData, HackPack, RosterEntry } from '../types'
import type { Lookup } from '../logic/lookup'
import { entryFromDex } from '../logic/member'
import { MAX_TEAM } from '../logic/team'
import { DAYCARE_SLOTS } from '../logic/storage'
import { dexNames, runVariant } from '../logic/setup'
import { dexList } from '../logic/checklist'
import { Sprite } from './Sprite'
import { Suggest } from './Suggest'
import { Types } from './Types'

interface Props {
  data: GameData
  lookup: Lookup
  /** The run's party: in Emerald Rogue everything owned is in it. */
  roster: RosterEntry[]
  overworld: string[]
  daycare: string[]
  pack: HackPack | null
  runDex: string
  /** Adds a species to the party, asking which member it replaces when full. */
  onJoin: (name: string) => void
  onOverworld: (names: string[]) => void
  onDaycare: (names: string[]) => void
  onRunDex: (id: string) => void
  /** Clears the party (and opponent) for a fresh run. */
  onNewRun: () => void
}

type Filter = 'all' | 'overworld' | 'daycare'

/** The party with `name` added, or put in place of slot `replace` when full; null when full and no slot given. */
export function addToParty(
  data: GameData,
  lookup: Lookup,
  party: readonly RosterEntry[],
  name: string,
  replace?: number,
): RosterEntry[] | null {
  const entry = entryFromDex(data, name, lookup.dexByName.get(name.trim().toLowerCase()))
  if (party.length < MAX_TEAM) return [...party, entry]
  if (replace === undefined || !party[replace]) return null
  return party.map((e, i) => (i === replace ? entry : e))
}

/**
 * Emerald Rogue's Pokédex: the Pokémon roaming the hub (ticked), which of them
 * sit in the Day Care, and the party for the current run. Any species can join
 * the party, ticked or not, since starters can be random.
 */
export function OverworldTab(props: Props) {
  const { data, lookup, roster, overworld, daycare, pack } = props
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [confirmNewRun, setConfirmNewRun] = useState(false)

  const list = useMemo(() => dexList(data, lookup, 'national'), [data, lookup])
  const ticked = new Set(overworld)
  const inParty = new Set(roster.map((e) => e.n))
  const variant = runVariant(pack, props.runDex)

  const q = query.trim().toLowerCase()
  const rows = list.filter((i) => {
    const n = data.dex[i]!.n
    if (filter === 'overworld' && !ticked.has(n)) return false
    if (filter === 'daycare' && !daycare.includes(n)) return false
    return !q || n.toLowerCase().includes(q)
  })

  const toggleOverworld = (name: string): void => {
    if (ticked.has(name)) {
      props.onOverworld(overworld.filter((n) => n !== name))
      props.onDaycare(daycare.filter((n) => n !== name))
    } else props.onOverworld([...overworld, name])
  }

  const toggleDaycare = (name: string): void =>
    props.onDaycare(daycare.includes(name) ? daycare.filter((n) => n !== name) : [...daycare, name].slice(0, DAYCARE_SLOTS))

  return (
    <div>
      <div class="card stack">
        <div class="row">
          <h2 class="grow" style="margin:0">Overworld</h2>
          <span class="lcd" aria-label={`${overworld.length} in the overworld`}>
            {overworld.length}
          </span>
        </div>
        <p class="muted" style="margin:0">
          Tick the Pokémon roaming your hub, and mark up to {DAYCARE_SLOTS} you keep in the Day Care. Start a run
          by adding your starter to the party: one from here, or search for the random one you were given.
        </p>
        {pack?.variants?.length ? (
          <label class="field">
            <span>Run Pokédex</span>
            <select value={variant?.id ?? ''} onChange={(e) => props.onRunDex(e.currentTarget.value)}>
              {pack.variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} (up to Gen {v.gen})
                </option>
              ))}
            </select>
            <span class="muted">Capture next only suggests what this Pokédex lets appear in a run.</span>
          </label>
        ) : null}
        <label class="field">
          <span>Add to party</span>
          <Suggest value="" placeholder="Search any Pokémon" options={dexNames(data)} onPick={props.onJoin} clearOnPick />
        </label>
        <div class="row wrap">
          {confirmNewRun ? (
            <>
              <button
                class="danger"
                onClick={() => {
                  setConfirmNewRun(false)
                  props.onNewRun()
                }}
              >
                Yes, clear the party
              </button>
              <button onClick={() => setConfirmNewRun(false)}>Cancel</button>
            </>
          ) : (
            <button onClick={() => setConfirmNewRun(true)} disabled={roster.length === 0}>
              New run
            </button>
          )}
        </div>
      </div>

      <div class="card stack">
        <input
          type="search"
          placeholder="Filter by name"
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
          aria-label="Filter the Pokédex by name"
        />
        <div class="row" role="group" aria-label="Show">
          {(['all', 'overworld', 'daycare'] as const).map((f) => (
            <button key={f} aria-pressed={filter === f} class={filter === f ? 'primary' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'overworld' ? 'Overworld' : `Day Care ${daycare.length}/${DAYCARE_SLOTS}`}
            </button>
          ))}
        </div>
      </div>

      {/* shortcut: renders every row (about 1,000); window it if this lags on a phone. */}
      <ul class="dex-list">
        {rows.map((dexIndex) => {
          const dex = data.dex[dexIndex]!
          const on = ticked.has(dex.n)
          const cared = daycare.includes(dex.n)
          const id = `overworld-${dexIndex}`
          return (
            <li key={dexIndex} class={on ? 'dex-row caught' : 'dex-row'}>
              <input type="checkbox" id={id} checked={on} onChange={() => toggleOverworld(dex.n)} aria-label={`${dex.n} in the overworld`} />
              <label class="dex-open" for={id}>
                <span class="lcd dex-no">{String(dex.id).padStart(3, '0')}</span>
                <Sprite gen={data.gen} id={dex.id} size={40} />
                <span class="grow" style="min-width:0">
                  <span class="truncate" style="display:block">{dex.n}</span>
                  <Types data={data} types={dex.t} />
                </span>
                {inParty.has(dex.n) && <span class="pill">Party</span>}
              </label>
              {on && (
                <button
                  aria-pressed={cared}
                  class={cared ? 'primary' : ''}
                  disabled={!cared && daycare.length >= DAYCARE_SLOTS}
                  onClick={() => toggleDaycare(dex.n)}
                  aria-label={`${dex.n} in the Day Care`}
                >
                  Day Care
                </button>
              )}
              <button onClick={() => props.onJoin(dex.n)} aria-label={`Add ${dex.n} to the party`}>
                + Party
              </button>
            </li>
          )
        })}
      </ul>
      {rows.length === 0 && <p class="empty">Nothing matches.</p>}
    </div>
  )
}

/** Asks which party member a new Pokémon replaces, once the party is full. */
export function ReplacePicker(props: {
  data: GameData
  party: RosterEntry[]
  name: string
  onPick: (slot: number) => void
  onCancel: () => void
}) {
  return (
    <div class="card stack" role="group" aria-label="Party is full" style="margin:0 1rem">
      <p style="margin:0">
        <strong>Party is full.</strong> Who does {props.name} replace?
      </p>
      <div class="row wrap">
        {props.party.map((e, i) => (
          <button key={i} onClick={() => props.onPick(i)}>
            <Sprite gen={props.data.gen} id={props.data.dex[e.d]?.id} size={32} />
            {e.n}
          </button>
        ))}
        <button onClick={props.onCancel}>Cancel</button>
      </div>
    </div>
  )
}
