import type { GameData, RosterEntry } from '../types'
import type { Lookup } from './lookup'
import { MAX_TEAM } from './team'

const KEY = 'ptb2'

export type RankScope = 'team' | 'all'

export interface SavedState {
  roster: RosterEntry[]
  team: number[]
  opponent: { name: string; ability: string } | null
  scope: RankScope
}

export const EMPTY_STATE: SavedState = { roster: [], team: [], opponent: null, scope: 'team' }

interface StoredShape {
  v?: number
  r?: unknown
  t?: unknown
  o?: unknown
  s?: unknown
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Parses one roster entry defensively. Saves outlive data regenerations, so
 * the dex index is re-resolved by name and anything unrecognised falls back
 * to the custom-Pokemon path rather than pointing at the wrong species.
 */
function parseEntry(raw: unknown, data: GameData, lookup: Lookup): RosterEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>

  const name = str(o.n).trim()
  if (!name) return null

  const typeCount = data.chart.types.length
  const clampType = (v: unknown, allowNone: boolean): number => {
    const n = Math.trunc(num(v, allowNone ? -1 : 0))
    if (allowNone && n < 0) return -1
    return n >= 0 && n < typeCount ? n : allowNone ? -1 : 0
  }

  // The name is authoritative. A stored index can point anywhere after the
  // data is regenerated, so an unknown name becomes a custom Pokemon rather
  // than silently adopting whatever species now sits at that index.
  const dex = lookup.dexByName.get(name.toLowerCase()) ?? -1

  const moves = Array.isArray(o.mv) ? o.mv.slice(0, 4).map(str) : []
  while (moves.length < 4) moves.push('')

  let stats: number[] | null = null
  if (Array.isArray(o.st) && o.st.length === 6) {
    stats = o.st.map((v) => Math.max(1, Math.trunc(num(v, 1))))
  }

  return {
    n: name,
    a: clampType(o.a, false),
    b: clampType(o.b, true),
    ab: str(o.ab),
    nt: Math.min(Math.max(Math.trunc(num(o.nt, 0)), 0), Math.max(data.natures.length - 1, 0)),
    mv: moves,
    st: stats,
    d: dex,
  }
}

export function load(data: GameData, lookup: Lookup): SavedState {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    return { ...EMPTY_STATE }
  }
  if (!raw) return { ...EMPTY_STATE }

  let parsed: StoredShape
  try {
    parsed = JSON.parse(raw) as StoredShape
  } catch {
    return { ...EMPTY_STATE }
  }

  const roster = Array.isArray(parsed.r)
    ? parsed.r.map((e) => parseEntry(e, data, lookup)).filter((e): e is RosterEntry => e !== null)
    : []

  const team = Array.isArray(parsed.t)
    ? [...new Set(parsed.t.map((v) => Math.trunc(num(v, -1))))]
        .filter((i) => i >= 0 && i < roster.length)
        .slice(0, MAX_TEAM)
    : []

  let opponent: SavedState['opponent'] = null
  if (typeof parsed.o === 'object' && parsed.o !== null) {
    const o = parsed.o as Record<string, unknown>
    const name = str(o.name).trim()
    if (name) opponent = { name, ability: str(o.ability) }
  }

  return { roster, team, opponent, scope: parsed.s === 'all' ? 'all' : 'team' }
}

export function save(state: SavedState): void {
  const payload: StoredShape = {
    v: 1,
    r: state.roster,
    t: state.team,
    o: state.opponent,
    s: state.scope,
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(payload))
  } catch {
    // Private browsing or a full quota; the app still works for this session.
  }
}
