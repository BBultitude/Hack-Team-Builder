import type { GameData, RosterEntry } from '../types'
import { STAT_NAMES } from '../types'
import { MODELLED_ABILITIES } from '../logic/abilities'
import { Suggest } from './Suggest'

interface Props {
  data: GameData
  entry: RosterEntry
  open: boolean
  onToggle: () => void
  onChange: (next: RosterEntry) => void
  onRemove: () => void
  inTeam: boolean
  onToggleTeam: () => void
  teamFull: boolean
}

const NONE = -1

export function PokemonEditor(props: Props) {
  const { data, entry, onChange } = props
  const vanilla = entry.d >= 0 ? data.dex[entry.d] : undefined

  const patch = (fields: Partial<RosterEntry>): void => onChange({ ...entry, ...fields })

  const typeName = (i: number): string => data.chart.types[i] ?? '?'

  const abilityOptions = [
    ...(vanilla ? [...vanilla.ab, ...vanilla.hab] : []),
    ...MODELLED_ABILITIES.map((a) => a.replace(/\b\w/g, (c) => c.toUpperCase())),
  ].filter((v, i, arr) => arr.indexOf(v) === i)

  const moveNames = data.moves.map((m) => m.n)
  const learnable = new Set(
    entry.d >= 0 ? (data.learnsets[entry.d] ?? []).map((i) => data.moves[i]?.n ?? '') : [],
  )

  const statsModified = entry.st !== null
  const currentStats = entry.st ?? vanilla?.s ?? [0, 0, 0, 0, 0, 0]

  return (
    <div class="card">
      <div class="row">
        <button class="editor-head grow" onClick={props.onToggle} aria-expanded={props.open}>
          <span aria-hidden="true">{props.open ? '▾' : '▸'}</span>
          <span class="grow truncate">
            <strong>{entry.n}</strong>{' '}
            <span class="muted">
              {entry.a >= 0 ? typeName(entry.a) : ''}
              {entry.b >= 0 ? ` / ${typeName(entry.b)}` : ''}
            </span>
          </span>
        </button>
        <button
          class={props.inTeam ? 'primary' : ''}
          onClick={props.onToggleTeam}
          disabled={!props.inTeam && props.teamFull}
          title={props.inTeam ? 'Remove from team' : 'Add to team'}
        >
          {props.inTeam ? 'On team' : 'Add'}
        </button>
      </div>

      {!entry.ab.trim() && (
        <p class="muted danger" style="margin:0.4rem 0 0">
          No ability set — defensive numbers may be wrong.
        </p>
      )}

      {props.open && (
        <div class="editor-body stack">
          <div class="row">
            <label class="field grow">
              <span>Primary type</span>
              <select
                value={String(entry.a)}
                onChange={(e) => patch({ a: Number(e.currentTarget.value) })}
              >
                {data.chart.types.map((n, i) => (
                  <option key={n} value={String(i)}>{n}</option>
                ))}
              </select>
            </label>
            <label class="field grow">
              <span>Secondary type</span>
              <select
                value={String(entry.b)}
                onChange={(e) => patch({ b: Number(e.currentTarget.value) })}
              >
                <option value={String(NONE)}>None</option>
                {data.chart.types.map((n, i) => (
                  <option key={n} value={String(i)}>{n}</option>
                ))}
              </select>
            </label>
          </div>

          <label class="field">
            <span>Ability</span>
            <Suggest
              value={entry.ab}
              placeholder="Ability"
              options={abilityOptions}
              onInput={(v) => patch({ ab: v })}
              onPick={(v) => patch({ ab: v })}
            />
          </label>

          <label class="field">
            <span>Nature</span>
            <select
              value={String(entry.nt)}
              onChange={(e) => patch({ nt: Number(e.currentTarget.value) })}
            >
              {data.natures.map((n, i) => (
                <option key={n.n} value={String(i)}>
                  {n.n}
                  {n.up === null
                    ? ' (neutral)'
                    : ` (+${STAT_NAMES[n.up]}, -${STAT_NAMES[n.down ?? 0]})`}
                </option>
              ))}
            </select>
          </label>

          <div class="field">
            <span>Moves</span>
            <div class="stack">
              {entry.mv.map((mv, slot) => (
                <div key={slot}>
                  <Suggest
                    value={mv}
                    placeholder={`Move ${slot + 1}`}
                    options={moveNames}
                    onInput={(v) => {
                      const next = [...entry.mv]
                      next[slot] = v
                      patch({ mv: next })
                    }}
                    onPick={(v) => {
                      const next = [...entry.mv]
                      next[slot] = v
                      patch({ mv: next })
                    }}
                  />
                  {mv && entry.d >= 0 && !learnable.has(mv) && (
                    <p class="muted danger" style="margin:0.2rem 0 0">
                      Not in the vanilla learnset — fine if your hack changed it.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div class="field">
            <span>
              Base stats
              {statsModified && <strong class="danger"> — modified from vanilla</strong>}
            </span>
            <div class="stat-grid">
              {STAT_NAMES.map((name, i) => (
                <label key={name} class="field">
                  <span>{name}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={999}
                    value={String(currentStats[i] ?? 0)}
                    onInput={(e) => {
                      const next = [...currentStats]
                      next[i] = Math.max(1, Number(e.currentTarget.value) || 1)
                      patch({ st: next })
                    }}
                  />
                </label>
              ))}
            </div>
            {statsModified && vanilla && (
              <button class="link" style="margin-top:0.5rem" onClick={() => patch({ st: null })}>
                Reset to vanilla
              </button>
            )}
          </div>

          <button class="danger" onClick={props.onRemove}>Remove {entry.n}</button>
        </div>
      )}
    </div>
  )
}
