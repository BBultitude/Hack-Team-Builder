import { useEffect, useMemo, useState } from 'preact/hooks'
import type { GameData, RosterEntry } from '../types'
import { buildLookup } from '../logic/lookup'
import { EMPTY_STATE, type RankScope, load, save } from '../logic/storage'
import { loadGameData } from '../data/load'
import { PokedexTab, addToRoster } from './PokedexTab'
import { TeamTab } from './TeamTab'
import { LookForTab } from './LookForTab'
import { OpponentTab } from './OpponentTab'

type Tab = 'dex' | 'team' | 'look' | 'opponent'

const TABS: { id: Tab; label: string }[] = [
  { id: 'dex', label: 'Pokédex' },
  { id: 'team', label: 'Best Team' },
  { id: 'look', label: 'Look For' },
  { id: 'opponent', label: 'Opponent' },
]

export function App() {
  const [data, setData] = useState<GameData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('dex')
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const [roster, setRoster] = useState<RosterEntry[]>(EMPTY_STATE.roster)
  const [team, setTeam] = useState<number[]>(EMPTY_STATE.team)
  const [opponent, setOpponent] = useState(EMPTY_STATE.opponent)
  const [scope, setScope] = useState<RankScope>(EMPTY_STATE.scope)
  const [restored, setRestored] = useState(false)

  const lookup = useMemo(() => (data ? buildLookup(data) : null), [data])

  useEffect(() => {
    loadGameData().then(setData).catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!data || !lookup || restored) return
    const saved = load(data, lookup)
    setRoster(saved.roster)
    setTeam(saved.team)
    setOpponent(saved.opponent)
    setScope(saved.scope)
    setRestored(true)
  }, [data, lookup, restored])

  useEffect(() => {
    // Only persist once the saved state has been restored, so the first
    // render never writes an empty roster over a real one.
    if (!restored) return
    save({ roster, team, opponent, scope })
  }, [restored, roster, team, opponent, scope])

  if (error) {
    return (
      <main>
        <p class="empty danger">Could not load the Pokémon data: {error}</p>
      </main>
    )
  }

  if (!data || !lookup) {
    return <main><p class="empty">Loading…</p></main>
  }

  return (
    <>
      <header class="topbar">
        <h1>Hack Team Builder</h1>
        <span class="muted">{roster.length} owned</span>
      </header>

      <nav class="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'dex' && (
          <PokedexTab
            data={data}
            lookup={lookup}
            roster={roster}
            team={team}
            openIndex={openIndex}
            onOpenIndex={setOpenIndex}
            onRoster={setRoster}
            onTeam={setTeam}
          />
        )}
        {tab === 'team' && (
          <TeamTab data={data} lookup={lookup} roster={roster} team={team} onTeam={setTeam} />
        )}
        {tab === 'look' && (
          <LookForTab
            data={data}
            lookup={lookup}
            roster={roster}
            team={team}
            onCaught={(name) => {
              const next = addToRoster(data, lookup, roster, team, name)
              if (!next) return
              setRoster(next.roster)
              setTeam(next.team)
            }}
          />
        )}
        {tab === 'opponent' && (
          <OpponentTab
            data={data}
            lookup={lookup}
            roster={roster}
            team={team}
            opponent={opponent}
            scope={scope}
            onOpponent={setOpponent}
            onScope={setScope}
          />
        )}

        <p class="muted" style="margin-top:1.5rem">
          Vanilla Generation 1–9 data from PokeAPI. Hack differences are handled by editing each
          Pokémon. Types and basic abilities only — no damage numbers, items, weather or terrain.
        </p>
      </main>
    </>
  )
}
