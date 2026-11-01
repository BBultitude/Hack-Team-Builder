import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { GameData, HackPack, RosterEntry } from '../types'
import { buildLookup } from '../logic/lookup'
import { MAX_TEAM } from '../logic/team'
import {
  EMPTY_STATE,
  INDEX_KEY,
  type Hack,
  type RankScope,
  type SetupIndex,
  type SetupMeta,
  liveSetups,
  load,
  loadRaw,
  loadSetups,
  readSetups,
  newSetupId,
  removeState,
  save,
  saveRaw,
  saveSetups,
  stateKey,
  serialiseState,
} from '../logic/storage'
import { adaptRoster, forSetup, runFilter, withHack } from '../logic/setup'
import { type SyncStatus, mergeIndex, setAccessCode, statusFor, syncSetups } from '../logic/sync'
import { SetupPanel } from './SetupPanel'
import { PartyBar } from './PartyBar'
import { loadGameData, loadHack } from '../data/load'
import { PokedexTab, addToRoster } from './PokedexTab'
import { TeamTab } from './TeamTab'
import { LookForTab } from './LookForTab'
import { OpponentTab } from './OpponentTab'
import { PokemonModal } from './PokemonModal'
import { OverworldTab, ReplacePicker, addToParty } from './OverworldTab'

type Tab = 'dex' | 'team' | 'look' | 'opponent'

/** Unbound's middle trainer difficulty, used until the player picks one. */
const DEFAULT_DIFFICULTY = 'expert'

/** The open game: the index's active one, or the first live one if that is gone. */
const activeOf = (index: SetupIndex): SetupMeta => liveSetups(index).find((s) => s.id === index.active) ?? liveSetups(index)[0]!

/** A text box has focus: the player is mid-edit. Pickers and ticks commit at once, so they don't count. */
const isEditing = (): boolean => document.activeElement?.matches('input:not([type=checkbox], [type=radio]), textarea') ?? false

const TABS: { id: Tab; label: string; party?: string }[] = [
  { id: 'dex', label: 'Pokédex' },
  { id: 'team', label: 'Best Team', party: 'Party' },
  { id: 'look', label: 'Look For', party: 'Capture Next' },
  { id: 'opponent', label: 'Opponent' },
]

export function App() {
  /** Vanilla data as loaded; `data` below is it adjusted for the active setup's generation. */
  const [vanilla, setVanilla] = useState<GameData | null>(null)
  const [setups, setSetupsState] = useState<SetupIndex>(() => loadSetups())
  const [error, setError] = useState<string | null>(null)
  /** The loaded hack pack and which hack it is for, so a stale one is never applied. */
  const [packed, setPacked] = useState<{ hack: Hack; pack: HackPack } | null>(null)
  const [tab, setTab] = useState<Tab>('dex')
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const [roster, setRoster] = useState<RosterEntry[]>(EMPTY_STATE.roster)
  const [team, setTeam] = useState<number[]>(EMPTY_STATE.team)
  const [opponent, setOpponent] = useState(EMPTY_STATE.opponent)
  const [scope, setScope] = useState<RankScope>(EMPTY_STATE.scope)
  const [level, setLevel] = useState(EMPTY_STATE.level)
  const [overworld, setOverworld] = useState(EMPTY_STATE.overworld)
  const [daycare, setDaycare] = useState(EMPTY_STATE.daycare)
  const [runDex, setRunDex] = useState(EMPTY_STATE.runDex)
  /** Emerald Rogue: a Pokémon waiting for a full party to make room. */
  const [incoming, setIncoming] = useState<string | null>(null)
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
  /** A sync asked for while a field had focus, run when it loses focus. */
  const editPending = useRef(false)

  const active = activeOf(setups)
  const pack = active.hack && packed?.hack === active.hack ? packed.pack : null
  // Until the active hack's pack arrives there is no data, so nothing restores against the wrong dex.
  const hacked = useMemo(
    () => (vanilla && (!active.hack || pack) ? withHack(vanilla, pack) : null),
    [vanilla, active.hack, pack],
  )
  const data = useMemo(() => (hacked ? forSetup(hacked, active.gen) : null), [hacked, active.gen])
  // Names and indices are the same in every generation, so one lookup serves a hack's every cap.
  const lookup = useMemo(() => (hacked ? buildLookup(hacked) : null), [hacked])
  const difficulties = pack?.difficulties ?? []
  const difficulty =
    difficulties.find((d) => d.id === active.difficulty) ?? difficulties.find((d) => d.id === DEFAULT_DIFFICULTY) ?? difficulties[0]
  const trainers = difficulty ? (pack?.trainers?.[difficulty.sets] ?? []) : []
  /** Emerald Rogue has no boxes: everything owned is the run's party. */
  const partyOnly = active.hack === 'rogue'
  const party = useMemo(() => (partyOnly ? roster.map((_, i) => i) : team), [partyOnly, roster, team])
  const allow = useMemo(
    () => (partyOnly && data && lookup ? runFilter(data, lookup, pack, runDex) : undefined),
    [partyOnly, data, lookup, pack, runDex],
  )

  /** Publishes the sticky header's height as --head, so the party bar pins just below it. */
  const observeHead = useMemo(() => {
    let observer: ResizeObserver | null = null
    return (el: HTMLElement | null): void => {
      observer?.disconnect()
      if (!el) return
      observer = new ResizeObserver(() => document.documentElement.style.setProperty('--head', `${el.offsetHeight}px`))
      observer.observe(el)
    }
  }, [])

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
    const hack = active.hack
    if (!hack || packed?.hack === hack) return
    loadHack(hack)
      .then((p) => setPacked({ hack, pack: p }))
      .catch((e: Error) => setError(e.message))
  }, [active.hack])

  useEffect(() => {
    if (!data || !lookup || restored) return
    // From the ref, not this render's `active`: two reloads in quick succession (another tab deleting the
    // open game) can run an older render's effect, which would load the deleted game under the new one.
    const saved = load(data, lookup, activeOf(setupsRef.current).id)
    lastSaved.current = JSON.stringify(serialiseState(saved))
    setRoster(saved.roster)
    setTeam(saved.team)
    setOpponent(saved.opponent)
    setScope(saved.scope)
    setLevel(saved.level)
    setOverworld(saved.overworld)
    setDaycare(saved.daycare)
    setRunDex(saved.runDex)
    setIncoming(null)
    setOpenIndex(null)
    setOutIndex(null)
    setRestored(true)
  }, [data, lookup, restored, active.id])

  useEffect(() => {
    // Only persist once the saved state has been restored, so the first
    // render never writes an empty roster over a real one.
    if (!restored) return
    const state = { roster, team, opponent, scope, level, overworld, daycare, runDex }
    const json = JSON.stringify(serialiseState(state))
    if (json === lastSaved.current) return
    lastSaved.current = json
    save(active.id, state)
    patchActive({})
  }, [restored, roster, team, opponent, scope, level, overworld, daycare, runDex])

  const stampOf = (index: SetupIndex): number => Math.max(...index.list.map((s) => s.updatedAt))

  /** `force` skips the mid-edit wait: for a hidden page, where nobody is typing and the OS may freeze it next. */
  const runSync = async (force = false): Promise<void> => {
    // Mid-edit, wait: a pull could reload the open game under the box being typed in. Leaving the field syncs.
    if (!force && isEditing()) {
      editPending.current = true
      // Only when something is waiting to go up: coming back with the cursor still in a box has nothing to send.
      if (stampOf(setupsRef.current) > syncedStamp.current) setSync('saving')
      return
    }
    if (syncing.current) {
      syncAgain.current = true
      return
    }
    syncing.current = true
    setSync('saving')
    try {
      const { index, pulled, dropped } = await syncSetups(setupsRef.current)
      const merged = mergeIndex(setupsRef.current, index, dropped)
      // What the server now has; edits made while this was in flight are newer and still get pushed.
      syncedStamp.current = stampOf(index)
      saveSetups(merged)
      setupsRef.current = merged
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
        void runSync(document.visibilityState === 'hidden')
      }
    }
  }

  useEffect(() => {
    void runSync()
    // Back in view: pull. Going out of view (phone locked, app switched): push, even mid-edit.
    const onFocus = (): void => void runSync(document.visibilityState === 'hidden')
    // Another tab wrote: take its games list, and reload the open game if that tab changed it,
    // so this tab never writes a stale copy over the other's edits.
    const onStorage = (e: StorageEvent): void => {
      if (e.key === INDEX_KEY) {
        // Read only: writing it back would bounce one more event to the other tab.
        const merged = mergeIndex(setupsRef.current, { active: setupsRef.current.active, list: readSetups().list })
        // The open game was deleted there: reload whichever is open now, or its Pokédex would be saved over that one.
        if (merged.active !== setupsRef.current.active) setRestored(false)
        setupsRef.current = merged
        setSetupsState(merged)
      } else if (e.key === stateKey(setupsRef.current.active)) setRestored(false)
    }
    const onLeaveField = (): void => {
      if (!editPending.current) return
      editPending.current = false
      // focusout fires before focus lands on the next field, so this runs even when tabbing between boxes.
      void runSync()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    document.addEventListener('focusout', onLeaveField)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('focusout', onLeaveField)
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

  const createSetup = (name: string, gen: number, hack: Hack | undefined, copyFrom?: string): void => {
    const meta: SetupMeta = { id: newSetupId(), name, gen, ...(hack ? { hack } : {}), updatedAt: Date.now() }
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
    if (!hacked || !data || gen === active.gen) return
    setRoster(adaptRoster(data, forSetup(hacked, gen), roster))
    patchActive({ gen })
  }

  /** Switches the hack, moving to its generation cap and bringing the Pokedex over to its data. */
  /** Gives a vanilla game (one saved before hack data existed) its hack; set once, never changed. */
  const changeHack = async (hack: Hack): Promise<void> => {
    if (!vanilla || !data || active.hack) return
    // Rogue's roster is the party; the picker already blocks a bigger game, this keeps it that way.
    if (hack === 'rogue' && roster.length > MAX_TEAM) return
    try {
      const next = await loadHack(hack)
      const gen = next.gen ?? active.gen
      setPacked({ hack, pack: next })
      setRoster(adaptRoster(data, forSetup(withHack(vanilla, next), gen), roster))
      patchActive({ hack, gen })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  /** Emerald Rogue: adds to the party, or asks who to replace when it is full. */
  const join = (name: string, replace?: number): void => {
    if (!data || !lookup) return
    const next = addToParty(data, lookup, roster, name, replace)
    if (!next) {
      setIncoming(name)
      return
    }
    setIncoming(null)
    setRoster(next)
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
    <header class="shell-top" ref={observeHead}>
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
      {/* Pinned to the bottom on a phone, within thumb reach; a row of the lid on a wide screen. */}
      {data && (
        <nav class="tabs" role="tablist" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {(partyOnly && t.party) || t.label}
            </button>
          ))}
        </nav>
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
            team={party}
            level={level}
            opponent={tab === 'opponent' ? opponent : null}
            out={outIndex}
            onPick={(i) => {
              if (tab === 'opponent') setOutIndex(outIndex === i ? null : i)
              else setOpenIndex(i)
            }}
            onEmpty={() => setTab('dex')}
          />

          {incoming && (
            <ReplacePicker data={data} party={roster} name={incoming} onPick={(slot) => join(incoming, slot)} onCancel={() => setIncoming(null)} />
          )}

          {sync === 'locked' && (
            <form
              class="card row wrap"
              style="margin:0 1rem"
              onSubmit={(e) => {
                e.preventDefault()
                setAccessCode(codeDraft.trim())
                // Leaving the box runs the sync (see runSync).
                ;(document.activeElement as HTMLElement | null)?.blur()
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
                onHack={(h) => void changeHack(h)}
                difficulties={difficulties}
                difficulty={difficulty}
                onDifficulty={(d) => patchActive({ difficulty: d })}
                onCreate={createSetup}
                onDelete={deleteActive}
                owned={roster.length}
              />
            )}
            {tab === 'dex' && partyOnly && (
              <OverworldTab
                data={data}
                lookup={lookup}
                roster={roster}
                overworld={overworld}
                daycare={daycare}
                pack={pack}
                runDex={runDex}
                onJoin={join}
                onOverworld={setOverworld}
                onDaycare={setDaycare}
                onRunDex={setRunDex}
                onNewRun={() => {
                  setRoster([])
                  setTeam([])
                  setOpponent(null)
                  setOutIndex(null)
                  setIncoming(null)
                }}
              />
            )}
            {tab === 'dex' && !partyOnly && (
              <PokedexTab
                data={data}
                lookup={lookup}
                roster={roster}
                team={team}
                regional={pack?.regional}
                onRoster={setRoster}
                onTeam={setTeam}
                onOpen={setOpenIndex}
              />
            )}
            {tab === 'team' && (
              <TeamTab
                data={data}
                lookup={lookup}
                roster={roster}
                team={party}
                partyOnly={partyOnly}
                onTeam={setTeam}
                onOpen={setOpenIndex}
              />
            )}
            {tab === 'look' && (
              <LookForTab
                data={data}
                lookup={lookup}
                roster={roster}
                team={party}
                allow={allow}
                onCaught={(name, replaces) => {
                  if (partyOnly) return join(name, replaces)
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
                team={party}
                level={level}
                onLevel={setLevel}
                opponent={opponent}
                scope={partyOnly ? 'team' : scope}
                partyOnly={partyOnly}
                out={outIndex}
                onOut={setOutIndex}
                onOpponent={setOpponent}
                onScope={setScope}
                trainers={trainers}
              />
            )}

            <p class="muted" style="margin-top:1.5rem">
              {pack
                ? `${pack.name} data from ${pack.source}, over vanilla data from PokeAPI.`
                : 'Vanilla data from PokeAPI.'}{' '}
              Pokémon up to Generation {active.gen}. Damage numbers are estimates: no critical hits, weather,
              terrain or stat changes.
            </p>
          </main>
        </div>
      </div>

      <PokemonModal
        data={data}
        lookup={lookup}
        roster={roster}
        team={party}
        party={partyOnly}
        index={openIndex}
        onClose={() => setOpenIndex(null)}
        onRoster={setRoster}
        onTeam={setTeam}
      />
    </div>
  )
}
