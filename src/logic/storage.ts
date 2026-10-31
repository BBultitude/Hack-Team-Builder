import type { GameData, RosterEntry } from '../types'
import type { Lookup } from './lookup'
import { MAX_TEAM } from './team'

/** Before game setups there was one save under this key; it migrates into the first setup. */
const LEGACY_KEY = 'ptb2'
const INDEX_KEY = 'ptb2:setups'
export const stateKey = (id: string): string => `ptb2:s:${id}`

export type RankScope = 'team' | 'all'

/** The opponent as picked: by hand (name, maybe ability, level, moves) or from a trainer's team (everything). */
export interface SavedOpponent {
  name: string
  ability: string
  lv?: number
  /** Up to four move names. */
  mv?: string[]
  item?: string
  /** Index into GameData.natures. */
  nt?: number
  /** Six values each. */
  ev?: number[]
  iv?: number[]
  /** Trainer it came from, for the heading. */
  trainer?: string
}

export interface SavedState {
  roster: RosterEntry[]
  team: number[]
  opponent: SavedOpponent | null
  scope: RankScope
}

export const EMPTY_STATE: SavedState = { roster: [], team: [], opponent: null, scope: 'team' }

export interface StoredShape {
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

const level = (v: unknown): number => Math.min(Math.max(Math.trunc(num(v, 50)), 1), 100)

const six = (v: unknown, max: number): number[] | undefined =>
  Array.isArray(v) && v.length === 6 ? v.map((x) => Math.min(Math.max(Math.trunc(num(x, 0)), 0), max)) : undefined

/** Optional fields only when present, so a hand-picked opponent stays as small as before. */
export function parseOpponent(raw: unknown, natureCount: number): SavedOpponent | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const name = str(o.name).trim()
  if (!name) return null
  const ev = six(o.ev, 255)
  const iv = six(o.iv, 31)
  const nt = Math.trunc(num(o.nt, -1))
  return {
    name,
    ability: str(o.ability),
    ...(o.lv === undefined ? {} : { lv: level(o.lv) }),
    ...(Array.isArray(o.mv) ? { mv: o.mv.slice(0, 4).map(str) } : {}),
    ...(str(o.item) ? { item: str(o.item) } : {}),
    ...(nt >= 0 && nt < natureCount ? { nt } : {}),
    ...(ev ? { ev } : {}),
    ...(iv ? { iv } : {}),
    ...(str(o.trainer) ? { trainer: str(o.trainer) } : {}),
  }
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
    ...(o.lv === undefined ? {} : { lv: level(o.lv) }),
  }
}

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    // Unavailable storage or corrupt JSON both mean "nothing saved".
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private browsing or a full quota; the app still works for this session.
  }
}

/** Validates a stored or downloaded save; anything unusable falls back to empty. */
export function parseState(raw: unknown, data: GameData, lookup: Lookup): SavedState {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_STATE }
  const parsed = raw as StoredShape

  const roster = Array.isArray(parsed.r)
    ? parsed.r.map((e) => parseEntry(e, data, lookup)).filter((e): e is RosterEntry => e !== null)
    : []

  const team = Array.isArray(parsed.t)
    ? [...new Set(parsed.t.map((v) => Math.trunc(num(v, -1))))]
        .filter((i) => i >= 0 && i < roster.length)
        .slice(0, MAX_TEAM)
    : []

  const opponent = parseOpponent(parsed.o, data.natures.length)

  return { roster, team, opponent, scope: parsed.s === 'all' ? 'all' : 'team' }
}

export function serialiseState(state: SavedState): StoredShape {
  return { v: 1, r: state.roster, t: state.team, o: state.opponent, s: state.scope }
}

export function load(data: GameData, lookup: Lookup, id: string): SavedState {
  return parseState(read(stateKey(id)), data, lookup)
}

export function save(id: string, state: SavedState): void {
  write(stateKey(id), serialiseState(state))
}

/** Raw stored blob for one setup, for syncing without re-parsing. */
export function loadRaw(id: string): unknown {
  return read(stateKey(id))
}

export function saveRaw(id: string, raw: unknown): void {
  write(stateKey(id), raw)
}

export function removeState(id: string): void {
  try {
    localStorage.removeItem(stateKey(id))
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

// ------------------------------------------------------------------ setups

export interface SetupMeta {
  id: string
  name: string
  /** Pokemon up to and including this generation. */
  gen: number
  /** ROM hack whose data pack applies; absent means vanilla. */
  hack?: Hack
  /** Trainer difficulty within the hack, when it has more than one. */
  difficulty?: string
  /** Milliseconds; the newer copy wins when syncing. */
  updatedAt: number
  /** Kept as a tombstone so a stale copy elsewhere can't bring it back. */
  deleted?: true
  /** The automatic first setup, never edited: dropped if the server already has games. */
  fresh?: true
}

export const HACKS = ['unbound', 'rogue'] as const
export type Hack = (typeof HACKS)[number]

export interface SetupIndex {
  active: string
  list: SetupMeta[]
}

export const SETUP_ID = /^[a-z0-9-]{1,40}$/

/** Lowercase and short enough for the server's id rule; randomUUID needs a secure context, which LAN http isn't. */
export function newSetupId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function parseSetupMeta(raw: unknown): SetupMeta | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const id = str(o.id)
  if (!SETUP_ID.test(id)) return null
  const gen = Math.trunc(num(o.gen, 9))
  return {
    id,
    name: str(o.name).trim().slice(0, 60) || 'Untitled game',
    gen: Math.min(Math.max(gen, 1), 9),
    ...(HACKS.includes(o.hack as Hack) ? { hack: o.hack as Hack } : {}),
    ...(/^[a-z]{1,20}$/.test(str(o.difficulty)) ? { difficulty: str(o.difficulty) } : {}),
    updatedAt: num(o.updatedAt, 0),
    ...(o.deleted === true ? { deleted: true as const } : {}),
    ...(o.fresh === true ? { fresh: true as const } : {}),
  }
}

export const liveSetups = (index: SetupIndex): SetupMeta[] => index.list.filter((s) => !s.deleted)

/**
 * The list of game setups. First run creates "My game"; an old single save
 * under the legacy key moves into it, so nobody loses their Pokedex.
 */
export function loadSetups(): SetupIndex {
  const raw = read(INDEX_KEY) as { active?: unknown; list?: unknown } | null
  const list = Array.isArray(raw?.list)
    ? raw.list.map(parseSetupMeta).filter((s): s is SetupMeta => s !== null)
    : []

  if (!list.some((s) => !s.deleted)) {
    const legacy = read(LEGACY_KEY)
    const first: SetupMeta = {
      id: newSetupId(),
      name: 'My game',
      gen: 9,
      updatedAt: Date.now(),
      ...(legacy === null ? { fresh: true as const } : {}),
    }
    if (legacy !== null) {
      write(stateKey(first.id), legacy)
      try {
        localStorage.removeItem(LEGACY_KEY)
      } catch {
        // Leaving the old key behind is harmless.
      }
    }
    list.push(first)
  }

  const live = list.filter((s) => !s.deleted)
  const active = live.some((s) => s.id === raw?.active) ? (raw!.active as string) : live[0]!.id
  const index = { active, list }
  saveSetups(index)
  return index
}

export function saveSetups(index: SetupIndex): void {
  write(INDEX_KEY, index)
}
