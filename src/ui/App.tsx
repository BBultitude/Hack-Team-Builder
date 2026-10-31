import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { GameData, RosterEntry } from '../types'
import { buildLookup } from '../logic/lookup'
import {
  EMPTY_STATE,
  type RankScope,
  type SetupIndex,
  type SetupMeta,
  liveSetups,
  load,
  loadRaw,
  loadSetups,
  newSetupId,
  removeState,
  save,
  saveRaw,
  saveSetups,
  serialiseState,
} from '../logic/storage'
import { adaptRoster, forSetup } from '../logic/setup'
import { type SyncStatus, mergeIndex, setAccessCode, statusFor, syncSetups } from '../logic/sync'
import { SetupPanel } from './SetupPanel'
import { PartyBar } from './PartyBar'
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
  /** Vanilla data as loaded; `data` below is it adjusted for the active setup's generation. */
  const [vanilla, setVanilla] = useState<GameData | null>(null)
  const [setups, setSetupsState] = useState<SetupIndex>(() => loadSetups())
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('dex')
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const [roster, setRoster] = useState<RosterEntry[]>(EMPTY_STATE.roster)
  const [team, setTeam] = useState<number[]>(EMPTY_STATE.team)
  const [opponent, setOpponent] = useState(EMPTY_STATE.opponent)
  const [scope, setScope] = useState<RankScope>(EMPTY_STATE.scope)
  const [restored, setRestored] = useState(false)
  /** Roster index of the Pokemon currently out against the opponent. */
  const [outIndex, setOutIndex] = useState<number | null>(null)
  /** What was last written for the active setup; unchanged state is never re-stamped as newer. */
  const lastSaved = useRef('')
  const [sync, setSync] = useState<SyncStatus>('saving')
  const [codeDraft, setCodeDraft] = useState('')
  // The async sync reads the latest index through this, not a stale closure.
  const setupsRef = useRef(setups)
  setupsRef.current = setups
  const syncing = useRef(false)
  const syncAgain = useRef(false)
  /** Newest updatedAt the server is known to have; anything newer here needs pushing. */
  const syncedStamp = useRef(-1)

  const active: SetupMeta = liveSetups(setups).find((s) => s.id === setups.active) ?? liveSetups(setups)[0]!
  const data = useMemo(() => (vanilla ? forSetup(vanilla, active.gen) : null), [vanilla, active.gen])
  // Names and indices are the same in every generation, so one lookup serves all setups.
  const lookup = useMemo(() => (vanilla ? buildLookup(vanilla) : null), [vanilla])

  const setSetups = (next: SetupIndex): void => {
    saveSetups(next)
    setSetupsState(next)
  }
  const patchActive = (fields: Partial<SetupMeta>): void =>
    setSetups({
      ...setups,
      list: setups.list.map((s) => {
        if (s.id !== active.id) return s
        // Any edit makes the automatic first setup a real one worth keeping.
        const { fresh: _fresh, ...rest } = s
        return { ...rest, ...fields, updatedAt: Date.now() }
      }),
    })

  useEffect(() => {
    loadGameData().then(setVanilla).catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!data || !lookup || restored) return
    const saved = load(data, lookup, active.id)
    lastSaved.current = JSON.stringify(serialiseState(saved))
    setRoster(saved.roster)
    setTeam(saved.team)
    setOpponent(saved.opponent)
    setScope(saved.scope)
    setOpenIndex(null)
    setOutIndex(null)
    setRestored(true)
  }, [data, lookup, restored, active.id])

  useEffect(() => {
    // Only persist once the saved state has been restored, so the first
    // render never writes an empty roster over a real one.
    if (!restored) return
    const state = { roster, team, opponent, scope }
    const json = JSON.stringify(serialiseState(state))
    if (json === lastSaved.current) return
    lastSaved.current = json
    save(active.id, state)
    patchActive({})
  }, [restored, roster, team, opponent, scope])

  const stampOf = (index: SetupIndex): number => Math.max(...index.list.map((s) => s.updatedAt))

  const runSync = async (): Promise<void> => {
    if (syncing.current) {
      syncAgain.current = true
      return
    }
    syncing.current = true
    setSync('saving')
    try {
      const { index, pulled, dropped } = await syncSetups(setupsRef.current)
      const merged = mergeIndex(setupsRef.current, index, dropped)
      syncedStamp.current = stampOf(merged)
      saveSetups(merged)
      setSetupsState(merged)
      // The open game changed on the server, or was deleted there: reload it from the browser copy.
      if (pulled.includes(setupsRef.current.active) || merged.active !== setupsRef.current.active) setRestored(false)
      setSync('synced')
    } catch (e) {
      // Retry on the next change rather than waiting for the window to regain focus.
      syncedStamp.current = 0
      setSync(statusFor(e))
    } finally {
      syncing.current = false
      if (syncAgain.current) {
        syncAgain.current = false
        void runSync()
      }
    }
  }

  useEffect(() => {
    void runSync()
    const onFocus = (): void => {
      if (document.visibilityState === 'visible') void runSync()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [])

  // Push one second after the last change.
  useEffect(() => {
    if (syncedStamp.current < 0 || stampOf(setups) <= syncedStamp.current) return
    const timer = setTimeout(() => void runSync(), 1000)
    return () => clearTimeout(timer)
  }, [setups])

  const switchTo = (id: string): void => {
    if (id === active.id) return
    // State is already saved on every change; just point at the other setup and reload.
    setRestored(false)
    setSetups({ ...setups, active: id })
  }

  const createSetup = (name: string, gen: number, copyFrom?: string): void => {
    const meta: SetupMeta = { id: newSetupId(), name, gen, updatedAt: Date.now() }
    if (copyFrom) saveRaw(meta.id, loadRaw(copyFrom))
    setRestored(false)
    setSetups({ active: meta.id, list: [...setups.list, meta] })
  }

  const deleteActive = (): void => {
    const rest = liveSetups(setups).filter((s) => s.id !== active.id)
    if (rest.length === 0) return
    removeState(active.id)
    setRestored(false)
    setSetups({
      active: rest[0]!.id,
      list: setups.list.map((s) =>
        s.id === active.id ? { id: s.id, name: s.name, gen: s.gen, updatedAt: Date.now(), deleted: true } : s,
      ),
    })
  }

  const changeGen = (gen: number): void => {
    if (!vanilla || !data || gen === active.gen) return
    setRoster(adaptRoster(data, forSetup(vanilla, gen), roster))
    patchActive({ gen })
  }

  const syncLabel =
    sync === 'synced' ? 'Synced' : sync === 'saving' ? 'Saving…' : sync === 'locked' ? 'Needs access code' : 'Offline'
  const syncHelp =
    sync === 'offline'
      ? 'Saved on this device. Will sync when online.'
      : sync === 'locked'
        ? 'Saved on this device. Enter the access code to sync.'
        : syncLabel

  const shellTop = (
    <header class="shell-top">
      <div class="shell-row">
        <span class={`lens sync-${sync}`} aria-hidden="true" />
        <span class="leds" aria-hidden="true"><i /><i /><i /></span>
        <h1>Hack Team Builder</h1>
        <span class={`sync-status sync-${sync}`} role="status" title={syncHelp}>
          {syncLabel}
        </span>
      </div>
      {data && (
        <label class="setup-pick">
          <span class="visually-hidden">Game</span>
          <select value={active.id} onChange={(e) => switchTo(e.currentTarget.value)}>
            {liveSetups(setups).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · Gen {s.gen}
              </option>
            ))}
          </select>
        </label>
      )}
    </header>
  )

  if (error || !data || !lookup) {
    return (
      <div class="dex">
        {shellTop}
        <div class="bezel">
          <div class="screen">
            <main>
              {error ? (
                <p class="empty danger">Could not load the Pokémon data: {error}</p>
              ) : (
                <p class="empty">Loading…</p>
              )}
            </main>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div class="dex">
      {shellTop}

      <div class="bezel">
        <div class="screen">
          <PartyBar
            data={data}
            lookup={lookup}
            roster={roster}
            team={team}
            opponent={tab === 'opponent' ? opponent : null}
            out={outIndex}
            onPick={(i) => {
              if (tab === 'opponent') {
                setOutIndex(outIndex === i ? null : i)
              } else {
                setTab('dex')
                setOpenIndex(i)
              }
            }}
            onEmpty={() => setTab('dex')}
          />

          {sync === 'locked' && (
            <form
              class="card row wrap"
              style="margin:0 1rem"
              onSubmit={(e) => {
                e.preventDefault()
                setAccessCode(codeDraft.trim())
                void runSync()
              }}
            >
              <label class="field grow">
                <span>This server needs an access code to sync your games.</span>
                <input
                  type="password"
                  autocomplete="current-password"
                  value={codeDraft}
                  onInput={(e) => setCodeDraft(e.currentTarget.value)}
                />
              </label>
              <button class="primary" type="submit">Unlock sync</button>
            </form>
          )}

          <main>
            {tab === 'dex' && (
              <SetupPanel
                setups={liveSetups(setups)}
                active={active}
                onRename={(name) => patchActive({ name })}
                onGen={changeGen}
                onCreate={createSetup}
                onDelete={deleteActive}
              />
            )}
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
                out={outIndex}
                onOut={setOutIndex}
                onOpponent={setOpponent}
                onScope={setScope}
              />
            )}

            <p class="muted" style="margin-top:1.5rem">
              Vanilla data from PokeAPI, Pokémon up to Generation {active.gen}. Hack differences are handled by
              editing each Pokémon. Types and basic abilities only, with no damage numbers, items, weather or
              terrain.
            </p>
          </main>
        </div>
      </div>

      <nav class="tabs" role="tablist" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
