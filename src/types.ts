/** Shared domain types. Mirrors the JSON emitted by scripts/build-data.ts. */

export type DamageClass = 'physical' | 'special'

export interface DexEntry {
  /** Display name, unique across the dex. */
  n: string
  /** One or two type indices into TypeChart.types. */
  t: number[]
  /** Six base stats, in STAT order below. */
  s: number[]
  /** Regular abilities. */
  ab: string[]
  /** Hidden abilities. */
  hab: string[]
}

export interface Move {
  n: string
  /** Type index. */
  t: number
  /** Base power; 0 means variable or fixed damage. */
  p: number
  c: DamageClass
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
  natures: Nature[]
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
}
