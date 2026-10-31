import { useState } from 'preact/hooks'
import type { SetupMeta } from '../logic/storage'
import { MAX_GEN, genNotes } from '../logic/setup'

interface Props {
  setups: SetupMeta[]
  active: SetupMeta
  onRename: (name: string) => void
  onGen: (gen: number) => void
  /** Creates a setup and switches to it; copyFrom duplicates that setup's Pokedex and team. */
  onCreate: (name: string, gen: number, copyFrom?: string) => void
  onDelete: () => void
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
  const [confirmDelete, setConfirmDelete] = useState(false)

  const create = (): void => {
    props.onCreate(newName.trim() || 'New game', newGen)
    setCreating(false)
    setNewName('')
    setNewGen(MAX_GEN)
  }

  return (
    <details class="card">
      <summary>
        <strong>Game setup</strong> <span class="muted">{active.name}, Pokémon up to Gen {active.gen}</span>
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
            <button onClick={() => props.onCreate(`${active.name} copy`.slice(0, 60), active.gen, active.id)}>
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
