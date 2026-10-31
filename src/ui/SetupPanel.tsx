import { useState } from 'preact/hooks'
import type { HackPack } from '../types'
import { HACKS, type Hack, type SetupMeta } from '../logic/storage'
import { MAX_GEN, genNotes } from '../logic/setup'

interface Props {
  setups: SetupMeta[]
  active: SetupMeta
  onRename: (name: string) => void
  onGen: (gen: number) => void
  onHack: (hack: Hack | undefined) => void
  /** Trainer difficulties the active hack's data has, in game order; empty when it has no boss teams. */
  difficulties: NonNullable<HackPack['difficulties']>
  difficulty: NonNullable<HackPack['difficulties']>[number] | undefined
  onDifficulty: (d: string) => void
  /** Creates a setup and switches to it; copyFrom duplicates that setup's Pokedex and team. */
  onCreate: (name: string, gen: number, hack: Hack | undefined, copyFrom?: string) => void
  onDelete: () => void
}

export const HACK_NAMES: Record<Hack, string> = { unbound: 'Pokémon Unbound', rogue: 'Emerald Rogue' }

/** Generation each hack's Pokemon go up to, suggested when it is picked. */
const HACK_GENS: Record<Hack, number> = { unbound: 8, rogue: 9 }

function HackSelect(props: { value: Hack | undefined; onChange: (hack: Hack | undefined) => void }) {
  return (
    <select
      value={props.value ?? ''}
      onChange={(e) => props.onChange((e.currentTarget.value || undefined) as Hack | undefined)}
    >
      <option value="">Vanilla (no hack data)</option>
      {HACKS.map((h) => (
        <option key={h} value={h}>{HACK_NAMES[h]}</option>
      ))}
    </select>
  )
}

const GENS = Array.from({ length: MAX_GEN }, (_, i) => i + 1)

function GenSelect(props: { value: number; onChange: (gen: number) => void }) {
  return (
    <select value={String(props.value)} onChange={(e) => props.onChange(Number(e.currentTarget.value))}>
      {GENS.map((g) => (
        <option key={g} value={String(g)}>
          Generation {g}
        </option>
      ))}
    </select>
  )
}

function GenHint({ gen }: { gen: number }) {
  const notes = genNotes(gen)
  return (
    <span class="muted">
      {notes.length ? `Gen ${gen} rules: ${notes.join(', ')}.` : 'Modern rules.'}
    </span>
  )
}

/** One save per game: name, generation cap, and new / duplicate / delete. */
export function SetupPanel(props: Props) {
  const { active } = props
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newGen, setNewGen] = useState(MAX_GEN)
  const [newHack, setNewHack] = useState<Hack | undefined>(undefined)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const create = (): void => {
    props.onCreate(newName.trim() || (newHack ? HACK_NAMES[newHack] : 'New game'), newGen, newHack)
    setCreating(false)
    setNewName('')
    setNewGen(MAX_GEN)
    setNewHack(undefined)
  }

  return (
    <details class="card">
      <summary>
        <strong>Game setup</strong> <span class="muted">
          {[active.name, active.hack ? HACK_NAMES[active.hack] : 'vanilla']
            .filter((v, i, all) => all.indexOf(v) === i)
            .join(', ')}
          , Pokémon up to Gen {active.gen}
        </span>
      </summary>
      <div class="stack" style="margin-top:0.6rem">
        <label class="field">
          <span>Name</span>
          <input
            value={active.name}
            maxLength={60}
            onChange={(e) => props.onRename(e.currentTarget.value.trim() || active.name)}
          />
        </label>
        <label class="field">
          <span>Hack data</span>
          <HackSelect value={active.hack} onChange={props.onHack} />
          <span class="muted">Types, stats, abilities and boss teams from the hack's own sources.</span>
        </label>
        {props.difficulties.length > 0 && (
          <label class="field">
            <span>Trainer difficulty</span>
            <select value={props.difficulty?.id ?? ''} onChange={(e) => props.onDifficulty(e.currentTarget.value)}>
              {props.difficulties.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
            {props.difficulty?.note && <span class="muted">{props.difficulty.note}</span>}
            <span class="muted">
              Picks which boss teams the Opponent tab offers. Boss levels come from the trainer docs; if your
              game scaled them, edit Level on the Opponent tab.
            </span>
          </label>
        )}
        <label class="field">
          <span>Pokémon up to and including</span>
          <GenSelect value={active.gen} onChange={props.onGen} />
          <GenHint gen={active.gen} />
        </label>

        {creating ? (
          <div class="stack sub-panel">
            <label class="field">
              <span>New game name</span>
              <input
                value={newName}
                maxLength={60}
                placeholder="Pokémon Unbound"
                onInput={(e) => setNewName(e.currentTarget.value)}
              />
            </label>
            <label class="field">
              <span>Hack data</span>
              <HackSelect
                value={newHack}
                onChange={(h) => {
                  setNewHack(h)
                  if (h) setNewGen(HACK_GENS[h])
                }}
              />
            </label>
            <label class="field">
              <span>Pokémon up to and including</span>
              <GenSelect value={newGen} onChange={setNewGen} />
              <GenHint gen={newGen} />
            </label>
            <div class="row">
              <button class="primary" onClick={create}>Create game</button>
              <button onClick={() => setCreating(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div class="row wrap">
            <button onClick={() => setCreating(true)}>New game</button>
            <button onClick={() => props.onCreate(`${active.name} copy`.slice(0, 60), active.gen, active.hack, active.id)}>
              Duplicate
            </button>
            {confirmDelete ? (
              <>
                <button class="danger" onClick={() => { setConfirmDelete(false); props.onDelete() }}>
                  Yes, delete {active.name}
                </button>
                <button onClick={() => setConfirmDelete(false)}>Cancel</button>
              </>
            ) : (
              <button
                class="danger"
                disabled={props.setups.length <= 1}
                title={props.setups.length <= 1 ? 'Keep at least one game' : undefined}
                onClick={() => setConfirmDelete(true)}
              >
                Delete game
              </button>
            )}
          </div>
        )}
      </div>
    </details>
  )
}
