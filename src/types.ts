/** Shared domain types. Mirrors the JSON emitted by scripts/build-data.ts. */

export type DamageClass = 'physical' | 'special'

export interface DexEntry {
  /** Display name, unique across the dex. */
  n: string
  /** PokeAPI pokemon id; also keys the sprite. */
  id: number
  /** Generation it was introduced in (a form's own debut for alternate forms). */
  g: number
  /** One or two type indices into TypeChart.types. */
  t: number[]
  /** Six base stats, in STAT order below. */
  s: number[]
  /** Regular abilities. */
  ab: string[]
  /** Hidden abilities. */
  hab: string[]
  /** Capture rate, 1-255. */
  cr: number
  /** Evolution family id; shared by every stage and form of one line. */
  fm: number
  /** Dex indices this entry evolves into. */
  ev?: number[]
  /** With ev: how to reach each evolution, in words, using the vanilla method. */
  eh?: string[]
  /** Set when realistically catchable: no legendaries, events or very rare lines. */
  ok?: 1
  /** With ok: the dex index to catch (this entry, or an easier earlier stage). */
  cf?: number
  /** Past types: [last generation they applied, types], oldest first. */
  pt?: [number, number[]][]
  /** Past ability slots: [last generation, slot 1-3 (3 is hidden), name or '' for empty]. */
  pa?: [number, number, string][]
}

export interface Move {
  n: string
  /** Type index. */
  t: number
  /** Base power; 0 means variable or fixed damage. */
  p: number
  c: DamageClass
  /** Generation it was introduced in. */
  g: number
}

export interface Nature {
  n: string
  /** Stat index raised 10%, or null for a neutral nature. */
  up: number | null
  /** Stat index lowered 10%, or null for a neutral nature. */
  down: number | null
}

export interface TypeChart {
  /** 18 type names in the order used by every type index in this app. */
  types: string[]
  /** matrix[attacking][defending] -> damage multiplier. */
  matrix: number[][]
}

export interface GameData {
  chart: TypeChart
  dex: DexEntry[]
  moves: Move[]
  /** learnsets[dexIndex] -> move indices. */
  learnsets: number[][]
  /** Parallel to learnsets: one digit per entry, the first generation it was learnable. */
  learnGens: string[]
  natures: Nature[]
  /** Catch-helper move name -> dex indices that can learn it. */
  catchMoves: Record<string, number[]>
  /** Parallel to catchMoves: one digit per learner, the first generation it could learn it. */
  catchGens: Record<string, string>
  /** How to get each species in the setup's hack, by dex index; absent means no location data (vanilla rules apply). */
  obtain?: Record<number, string>
  /** Newest generation in play; set by forSetup. Absent means every generation (9). */
  gen?: number
}

/** Stat slots, fixed by the data generator. */
export const STAT = {
  HP: 0,
  ATTACK: 1,
  DEFENSE: 2,
  SP_ATTACK: 3,
  SP_DEFENSE: 4,
  SPEED: 5,
} as const

/** Full names only — no abbreviations in user-facing text. */
export const STAT_NAMES = [
  'Hit Points',
  'Attack',
  'Defense',
  'Special Attack',
  'Special Defense',
  'Speed',
] as const

/**
 * One Pokemon the player owns. Persisted shape, kept terse because it
 * lives in localStorage. Design.md section 4.
 */
export interface RosterEntry {
  /** Name. */
  n: string
  /** Primary type index. */
  a: number
  /** Secondary type index, or -1 for none. */
  b: number
  /** Ability name; empty string when unset. */
  ab: string
  /** Index into GameData.natures. */
  nt: number
  /** Up to four move names; empty strings for blank slots. */
  mv: string[]
  /** Six base stat overrides, or null when unmodified from vanilla. */
  st: number[] | null
  /** Dex index, or -1 for a custom Pokemon with no vanilla counterpart. */
  d: number
  /** Level, 1-100; absent in saves from before levels, read as 50. */
  lv?: number
}

/** One Pokemon on a hack trainer's team, as data/hacks/<hack>.json stores it. */
export interface TrainerMon {
  /** Dex name (vanilla, or a form the pack adds). */
  n: string
  lv: number
  ab: string
  /** Held item, '' for none. */
  it: string
  /** Nature name, '' when unknown. */
  nt: string
  /** Six values each, in STAT order. */
  ev: number[]
  iv: number[]
  /** Move names as the hack's docs give them, status moves included. */
  mv: string[]
}

export interface Trainer {
  name: string
  team: TrainerMon[]
}

/**
 * A ROM hack's differences from vanilla, built by scripts/build-hacks.ts.
 * Keyed by name so it survives a regeneration of the vanilla data.
 */
export interface HackPack {
  name: string
  /** Where the data came from, for the footer. */
  source: string
  /** Newest generation the hack includes; suggested as the setup's cap. */
  gen: number
  /** Changed species by dex name. With `base`, a form the vanilla dex lacks, copied from that entry. */
  dex: Record<string, { t?: number[]; s?: number[]; ab?: string[]; hab?: string[]; cr?: number; base?: string }>
  /** Trainer difficulties in game order; `sets` names the trainers key holding that difficulty's teams. */
  difficulties?: { id: string; label: string; sets: string; note?: string }[]
  /** The game's own regional dex, as dex names in its order. */
  regional?: string[]
  /** How to get each obtainable species, by dex name; absent means it can't be got in this hack. */
  obtain?: Record<string, string>
  /** Level-up moves the hack adds, by dex name. */
  learn?: Record<string, string[]>
  /** Boss teams per difficulty. */
  trainers?: Record<string, Trainer[]>
  /** Names the build couldn't map, kept for review. */
  unmatched: string[]
}
